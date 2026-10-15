(function () {
  const { MODELS, loadAll, consensus, powderScore, forecastDates } = window.Forecast;
  const RESORTS = window.RESORTS;

  const state = {
    dates: forecastDates(),
    summit: null, // [{ model, locs: [...] }] in RESORTS order
    rows: [], // per-resort consensus at summit
    filter: "All",
    sort: "72h",
    selected: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const fmtIn = (x) => (x < 0.5 ? "0" : x < 10 ? x.toFixed(1).replace(/\.0$/, "") : Math.round(x).toString());
  const dayName = (date, i) => {
    if (i === 0) return "Today";
    const d = new Date(date + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short" });
  };
  const dayNum = (date) => {
    const d = new Date(date + "T12:00:00");
    return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
  };
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function snowLevel(x) {
    if (x < 0.5) return 0;
    if (x < 2) return 1;
    if (x < 5) return 2;
    if (x < 10) return 3;
    return 4;
  }

  function buildRows() {
    state.rows = RESORTS.map((r, i) => {
      const perModel = state.summit.map((m) => m.locs[i]).filter(Boolean);
      const days = consensus(perModel, state.dates);
      return {
        resort: r,
        days,
        total72: sum(days.slice(0, 3).map((d) => d.snow)),
        total7: sum(days.map((d) => d.snow)),
        best: [1, 2, 3]
          .map((k) => ({ k, score: powderScore(days[k]) }))
          .sort((x, y) => y.score - x.score)[0],
      };
    });
  }

  function renderBestBets() {
    const top = [...state.rows]
      .filter((row) => row.best.score > 0)
      .sort((a, b) => b.best.score - a.best.score || b.total72 - a.total72)
      .slice(0, 3);
    const el = $("#best");
    if (!top.length) {
      el.innerHTML = `<p class="quiet">No powder mornings in sight for the next three days.</p>`;
      return;
    }
    el.innerHTML = top
      .map((row) => {
        const d = row.days[row.best.k];
        return `<button class="bet" data-id="${row.resort.id}">
          <span class="bet-score" data-level="${Math.min(4, Math.floor(row.best.score / 25))}">${row.best.score}</span>
          <span class="bet-body">
            <strong>${esc(row.resort.name)}</strong>
            <span>${dayName(d.date, row.best.k)} morning · ${fmtIn(d.overnight)}″ overnight</span>
          </span>
        </button>`;
      })
      .join("");
  }

  function renderTable() {
    const head = $("#grid thead");
    head.innerHTML = `<tr><th class="resort-col">Resort</th><th>3 day</th>${state.dates
      .map((d, i) => `<th>${dayName(d, i)}<span class="sub">${dayNum(d)}</span></th>`)
      .join("")}</tr>`;

    let rows = state.rows.filter((r) => state.filter === "All" || r.resort.state === state.filter);
    if (state.sort === "72h") rows.sort((a, b) => b.total72 - a.total72);
    else if (state.sort === "7d") rows.sort((a, b) => b.total7 - a.total7);
    else rows.sort((a, b) => a.resort.name.localeCompare(b.resort.name));

    $("#grid tbody").innerHTML = rows
      .map((row) => {
        const cells = row.days
          .map((d) => {
            const mix = d.mix > 0.1 ? `<span class="mix" title="Rain or ice likely">mix</span>` : "";
            const range = d.hi >= 1 ? `<span class="range">${fmtIn(d.lo)}–${fmtIn(d.hi)}</span>` : "";
            return `<td class="snow" data-level="${snowLevel(d.snow)}" data-conf="${d.confidence}">
              <span class="amt">${fmtIn(d.snow)}″</span>${range}${mix}</td>`;
          })
          .join("");
        return `<tr data-id="${row.resort.id}" tabindex="0">
          <th class="resort-col" scope="row"><span class="name">${esc(row.resort.name)}</span><span class="sub">${row.resort.state} · ${row.resort.summit.toLocaleString()} ft</span></th>
          <td class="total" data-level="${snowLevel(row.total72 / 1.5)}">${fmtIn(row.total72)}″</td>
          ${cells}</tr>`;
      })
      .join("");
  }

  async function openDetail(id) {
    const i = RESORTS.findIndex((r) => r.id === id);
    if (i < 0) return;
    const r = RESORTS[i];
    state.selected = id;
    const panel = $("#detail");
    panel.hidden = false;
    panel.innerHTML = `<div class="detail-head"><h2>${esc(r.name)}, ${r.state}</h2><button class="close" aria-label="Close">×</button></div><p class="quiet">Loading base elevation forecast…</p>`;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);

    const base = await loadAll([r], [r.base]);
    if (state.selected !== id) return;

    const summitModels = state.summit.map((m) => ({ model: m.model, loc: m.locs[i] }));
    const summitDays = state.rows.find((row) => row.resort.id === id).days;
    const baseDays = consensus(base.map((m) => m.locs[0]), state.dates);
    const maxSnow = Math.max(4, ...summitModels.flatMap((m) => state.dates.map((d) => m.loc.days[d]?.snow ?? 0)));

    const modelRows = summitModels
      .map(({ model, loc }) => {
        const bars = state.dates
          .map((d) => {
            const v = loc.days[d]?.snow ?? 0;
            return `<td><span class="bar" style="--h:${Math.round((v / maxSnow) * 100)}"></span><span class="bar-label">${fmtIn(v)}</span></td>`;
          })
          .join("");
        return `<tr><th scope="row">${esc(model.label)}</th>${bars}</tr>`;
      })
      .join("");

    const dayRows = state.dates
      .map((d, k) => {
        const s = summitDays[k];
        const b = baseDays[k];
        const snowLine = s.fzlMin ? Math.max(0, Math.round((s.fzlMin - 1000) / 100) * 100) : null;
        const wind = s.gustMax >= 45 ? `<span class="warn">${Math.round(s.gustMax)} mph</span>` : s.gustMax ? `${Math.round(s.gustMax)} mph` : "–";
        const rain = s.mix > 0.1 || b.mix > 0.1 ? `<span class="warn">${b.mix > 0.1 && s.mix <= 0.1 ? "at base" : "yes"}</span>` : "no";
        return `<tr>
          <th scope="row">${dayName(d, k)} <span class="sub">${dayNum(d)}</span></th>
          <td><strong>${fmtIn(s.snow)}″</strong> <span class="sub">${fmtIn(s.lo)}–${fmtIn(s.hi)}</span></td>
          <td>${fmtIn(b.snow)}″</td>
          <td>${rain}</td>
          <td>${snowLine != null ? snowLine.toLocaleString() + " ft" : "–"}</td>
          <td>${s.tMin != null ? Math.round(s.tMin) + "° / " + Math.round(s.tMax) + "°" : "–"}</td>
          <td>${wind}</td>
          <td><span class="conf" data-conf="${s.confidence}">${s.confidence}</span></td>
        </tr>`;
      })
      .join("");

    panel.innerHTML = `
      <div class="detail-head">
        <h2>${esc(r.name)}, ${r.state}</h2>
        <button class="close" aria-label="Close">×</button>
      </div>
      <p class="quiet">Summit ${r.summit.toLocaleString()} ft · Base ${r.base.toLocaleString()} ft · Powder score tomorrow <strong>${powderScore(summitDays[1])}</strong> of 100</p>
      <div class="scroll">
        <table class="days">
          <thead><tr><th>Day</th><th>Summit snow</th><th>Base snow</th><th>Rain/ice</th><th>Snow level</th><th>Summit low/high</th><th>Summit gusts</th><th>Models agree</th></tr></thead>
          <tbody>${dayRows}</tbody>
        </table>
      </div>
      <h3>Each model's summit snow (inches)</h3>
      <div class="scroll">
        <table class="models">
          <thead><tr><th></th>${state.dates.map((d, k) => `<th>${dayName(d, k)}</th>`).join("")}</tr></thead>
          <tbody>${modelRows}</tbody>
        </table>
      </div>
      <p class="quiet small">Snow level is roughly 1,000 ft below the lowest freezing level of the day. Gusts of 45 mph or more often put upper lifts on wind hold.</p>`;
  }

  function closeDetail() {
    state.selected = null;
    $("#detail").hidden = true;
    history.replaceState(null, "", location.pathname);
  }

  function renderFilters() {
    const states = ["All", ...new Set(RESORTS.map((r) => r.state))];
    $("#filters").innerHTML = states
      .map((s) => `<button class="chip" aria-pressed="${s === state.filter}" data-state="${s}">${s}</button>`)
      .join("");
  }

  function bind() {
    $("#filters").addEventListener("click", (e) => {
      const b = e.target.closest("[data-state]");
      if (!b) return;
      state.filter = b.dataset.state;
      try { localStorage.setItem("ecs-filter", state.filter); } catch (err) {}
      renderFilters();
      renderTable();
    });
    $("#sort").addEventListener("change", (e) => {
      state.sort = e.target.value;
      renderTable();
    });
    document.addEventListener("click", (e) => {
      if (e.target.closest(".close")) return closeDetail();
      const row = e.target.closest("[data-id]");
      if (row) openDetail(row.dataset.id);
    });
    $("#grid tbody").addEventListener("keydown", (e) => {
      const row = e.target.closest("[data-id]");
      if (row && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        openDetail(row.dataset.id);
      }
    });
  }

  async function init() {
    try { state.filter = localStorage.getItem("ecs-filter") || "All"; } catch (err) {}
    renderFilters();
    bind();
    state.summit = await loadAll(RESORTS, RESORTS.map((r) => r.summit));
    if (!state.summit.length) {
      $("#status").textContent = "Couldn't reach the forecast service. Try again in a few minutes.";
      return;
    }
    buildRows();
    $("#status").textContent = `Updated ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · ${state.summit.length} of ${MODELS.length} models · ${state.summit.map((m) => m.model.label).join(", ")}`;
    renderBestBets();
    renderTable();
    const hash = location.hash.slice(1);
    if (hash) openDetail(hash);
  }

  init();
})();
