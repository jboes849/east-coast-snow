(function () {
  const RESORTS = window.RESORTS;
  const GUIDES = window.GUIDES || {};
  const SETUPS = window.SETUPS || {};
  const Icon = window.Icon;
  const DATA_URL = "data/forecast.json";

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  const state = {
    data: null,
    dates: [],
    rows: [],
    open: false,
    region: store.get("ups-region", "All"),
    search: "",
    sort: "7d",
    view: store.get("ups-view", "rows"),
    units: store.get("ups-units", "in"),
    favorites: new Set(store.get("ups-favs", [])),
    mapRange: "3",
    radar: false,
    selected: null,
    details: {},
    charts: [],
  };

  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const sum = (xs) => xs.reduce((a, b) => a + (b || 0), 0);
  const median = (xs) => {
    const v = xs.filter((x) => x != null).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };

  // ---------- units and formatting ----------
  const metric = () => state.units === "cm";
  const snowNum = (inches) => (metric() ? inches * 2.54 : inches);
  const snowUnit = () => (metric() ? "cm" : "in");
  function snowVal(inches) {
    const v = snowNum(inches || 0);
    if (v < (metric() ? 1 : 0.5)) return "0";
    if (v < 10) return v.toFixed(metric() ? 0 : 1).replace(/\.0$/, "");
    return String(Math.round(v));
  }
  const snowTxt = (inches) => snowVal(inches) + (metric() ? " cm" : "″");
  const rangeTxt = (lo, hi) => `${snowVal(lo)}–${snowTxt(hi)}`;
  const rangeVal = (lo, hi) => `${snowVal(lo)}–${snowVal(hi)}`;
  const tempNum = (f) => (f == null ? null : metric() ? (f - 32) * 5 / 9 : f);
  const tempTxt = (f) => (f == null ? "–" : `${Math.round(tempNum(f))}°`);
  const tempTxtU = (f) => (f == null ? "–" : `${Math.round(tempNum(f))}°${metric() ? "C" : "F"}`);
  const windNum = (mph) => (mph == null ? null : metric() ? mph * 1.609 : mph);
  const windTxt = (mph) => (mph == null ? "–" : `${Math.round(windNum(mph))} ${metric() ? "km/h" : "mph"}`);
  const elevTxt = (ft) => (metric() ? `${Math.round(ft * 0.3048).toLocaleString()} m` : `${Math.round(ft).toLocaleString()} ft`);
  const liqTxt = (inch) => (metric() ? `${Math.round(inch * 25.4)} mm` : `${inch.toFixed(2)}″`);

  // Engine text carries unit tokens like {{s:4.2}}; render them in the reader's units.
  function fmt(text) {
    return esc(text || "").replace(/\{\{(\w):([^}]+)\}\}/g, (_, k, v) => {
      const n = v.split(",").map(Number);
      if (k === "s") return snowTxt(n[0]);
      if (k === "r") return rangeTxt(n[0], n[1]);
      if (k === "t") return tempTxtU(n[0]);
      if (k === "w") return windTxt(n[0]);
      if (k === "e") return elevTxt(n[0]);
      if (k === "l") return liqTxt(n[0]);
      return v;
    });
  }

  // ---------- dates ----------
  const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const dateObj = (date) => new Date(date + "T12:00:00");
  const dayShort = (date) => (date === nyToday() ? "Today" : dateObj(date).toLocaleDateString("en-US", { weekday: "short" }));
  const dayInitial = (date) => dateObj(date).toLocaleDateString("en-US", { weekday: "narrow" });
  const dayNum = (date) => dateObj(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const dayLong = (date) => dateObj(date).toLocaleDateString("en-US", { weekday: "long" });
  function whenTxt(t) {
    const d = dayLong(t.slice(0, 10));
    const h = Number(t.slice(11, 13));
    if (h < 5) return `early ${d}`;
    if (h < 12) return `${d} morning`;
    if (h < 17) return `${d} afternoon`;
    return `${d} night`;
  }
  const spanTxt = (a, b) => (whenTxt(a) === whenTxt(b) ? whenTxt(a) : `${whenTxt(a)} – ${whenTxt(b)}`);
  const hourLabel = (t) => {
    const h = Number(t.slice(11, 13));
    return h === 0 ? "12a" : h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`;
  };

  // ---------- colors ----------
  const SNOW_STEPS = [0.5, 3, 6, 12, 18];
  const SNOW_COLORS = ["#e5e7eb", "#c9d8f6", "#8fb0ec", "#4d82e6", "#0057ff", "#00238a"];
  const snowLevel = (x) => SNOW_STEPS.filter((s) => x >= s).length;
  const snowColor = (x) => SNOW_COLORS[snowLevel(x)];
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function dayIcon(d) {
    const wet = (d.rain || 0) + (d.ice || 0);
    if (d.snow >= 3) return { icon: "heavySnow", label: "Heavy snow" };
    if (d.snow >= 0.5) return wet > 0.1 ? { icon: "mix", label: "Snow and rain" } : { icon: "snow", label: "Snow" };
    if (wet > 0.1) return { icon: d.ice > 0.05 ? "mix" : "rain", label: d.ice > 0.05 ? "Sleet or freezing rain" : "Rain" };
    if (d.cloud != null && d.cloud < 30) return { icon: "sun", label: "Sunny" };
    if (d.cloud != null && d.cloud < 70) return { icon: "partly", label: "Partly cloudy" };
    return { icon: "cloud", label: "Cloudy" };
  }

  // ---------- wind ----------
  const inArc = (dir, arc) => !!arc && dir != null && (arc[0] <= arc[1] ? dir >= arc[0] && dir <= arc[1] : dir >= arc[0] || dir <= arc[1]);
  const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const compass = (dir) => (dir == null ? "–" : COMPASS[Math.round(dir / 45) % 8]);
  const guideFor = (r) => GUIDES[r.id] || { setups: [], hold: 45, exposed: [250, 340], notes: [] };
  const holdFor = (row, dir) => guideFor(row.resort).hold - (inArc(dir, guideFor(row.resort).exposed) ? 5 : 0);
  function windRisk(row, gust, dir) {
    if (gust == null) return "none";
    const hold = holdFor(row, dir);
    if (gust >= hold) return "high";
    if (gust >= hold - 10) return "moderate";
    return "low";
  }

  const confTxt = (c) => (c === "high" ? "High agreement" : c === "medium" ? "Medium agreement" : "Low agreement");
  const operating = (row) => row.season.operating;
  const SETUP_SHORT = { noreaster: "Nor'easter", lake: "Lake effect", upslope: "Upslope", southern: "Southerly", west: "Clipper" };

  // ---------- data ----------
  function buildRows() {
    const byId = Object.fromEntries(RESORTS.map((r) => [r.id, r]));
    state.rows = state.data.resorts.filter((r) => byId[r.id]).map((r) => ({ ...r, resort: byId[r.id] }));
    state.dates = state.data.dates;
    state.open = state.rows.some(operating);
    state.sparkMax = Math.max(6, ...state.rows.flatMap((r) => r.days.map((d) => d.snow)));
  }

  // ---------- hero ----------
  function renderHero() {
    const h = state.data.headline;
    $("#headline").innerHTML = `<h1>${fmt(h.title)}</h1><p>${fmt(h.text)}</p>`;
    const biggest = [...state.rows].sort((a, b) => b.total7 - a.total7)[0];
    const stats = [{ label: "Most snow · 7d", value: `${snowVal(biggest.total7)}<i>${snowUnit()}</i>`, sub: biggest.resort.name, id: biggest.resort.id }];
    if (state.open) {
      const open = state.rows.filter(operating);
      const powder = [...open].sort((a, b) => b.best.score - a.best.score || b.total3 - a.total3)[0];
      const bestSki = [...open].sort((a, b) => b.bestDay.score - a.bestDay.score || b.total3 - a.total3)[0];
      stats.push(
        powder.best.score > 0
          ? { label: "Best first chair", value: dayShort(powder.days[powder.best.k].date), sub: `${powder.resort.name} · ${powder.best.score}`, id: powder.resort.id }
          : { label: "Best first chair", value: "–", sub: "None in 3 days" },
        { label: "Best ski day", value: `${dayShort(bestSki.days[bestSki.bestDay.k].date)}<i>${bestSki.bestDay.letter}</i>`, sub: bestSki.resort.name, id: bestSki.resort.id }
      );
    } else {
      const sm = [...state.rows].sort((a, b) => b.snowmaking.hours7 - a.snowmaking.hours7)[0];
      const first = [...state.rows].filter((r) => r.season.phase === "preseason").sort((a, b) => a.season.daysToOpen - b.season.daysToOpen)[0];
      stats.push(
        sm.snowmaking.hours7 > 0
          ? { label: "Snowmaking hours · 7d", value: `${sm.snowmaking.hours7}<i>h</i>`, sub: sm.resort.name, id: sm.resort.id }
          : { label: "Snowmaking hours · 7d", value: "0", sub: "Too warm everywhere" },
        first
          ? { label: "Typically opens first", value: dayNum(first.season.open), sub: `${first.resort.name} · ${first.season.daysToOpen} days`, id: first.resort.id }
          : { label: "Season", value: "–", sub: "Closed" }
      );
    }
    $("#stats").innerHTML = stats
      .map((s) => `<button class="kpi" ${s.id ? `data-open="${s.id}"` : "disabled"}><span class="label">${s.label}</span><span class="kpi-value">${s.value}</span><span class="kpi-sub">${esc(s.sub)}</span></button>`)
      .join("");
  }

  // ---------- picks: powder mornings in season, snowmaking windows before ----------
  function renderPicks() {
    const el = $("#picks");
    const head = $("#picks-block .block-head");
    if (state.open) {
      head.innerHTML = `<h2>Powder mornings</h2><span class="label">Next 72 h · score 0–100</span>`;
      $('.navlinks a[href="#picks-block"]').textContent = "Powder";
      const top = state.rows.filter((r) => operating(r) && r.best.score > 0).sort((a, b) => b.best.score - a.best.score || b.total3 - a.total3).slice(0, 4);
      if (!top.length) {
        el.innerHTML = `<p class="empty">No powder mornings in the next three days.</p>`;
        return;
      }
      el.innerHTML = top
        .map((row) => {
          const d = row.days[row.best.k];
          const bits = [`${dayShort(d.date)} 06:00`, `${snowTxt(d.overnight)} overnight`];
          if (d.slr) bits.push(`SLR ${d.slr}:1`);
          bits.push(confTxt(d.conf));
          return `<button class="pick" data-open="${row.resort.id}">
            <span class="score" data-tier="${row.best.score >= 75 ? 3 : 1}">${row.best.score}</span>
            <span><b>${esc(row.resort.name)}</b><br><span class="detail-line">${bits.join(" · ")}</span></span>
            <span class="meter-line"><i style="width:${row.best.score}%"></i></span>
          </button>`;
        })
        .join("");
      return;
    }
    head.innerHTML = `<h2>Snowmaking windows</h2><span class="label">Pre-season · summit wet bulb ≤ ${tempTxtU(27)}</span>`;
    $('.navlinks a[href="#picks-block"]').textContent = "Snowmaking";
    const wins = state.rows
      .flatMap((r) => r.snowmaking.windows.map((w) => ({ ...w, row: r })))
      .sort((a, b) => b.hours - a.hours || a.minTw - b.minTw)
      .filter((w, i, all) => all.findIndex((x) => x.row === w.row) === i)
      .slice(0, 4);
    if (!wins.length) {
      el.innerHTML = `<p class="empty">No resort gets cold enough for snowmaking this week.</p>`;
      return;
    }
    const maxH = Math.max(...wins.map((w) => w.hours));
    el.innerHTML = wins
      .map((w) => {
        const bits = [spanTxt(w.start, w.end), `low ${tempTxtU(w.minTw)} wet bulb`, w.baseHours >= 3 ? `base ${w.baseHours}h` : "base too warm"];
        return `<button class="pick" data-open="${w.row.resort.id}">
          <span class="score" data-tier="${w.good >= 6 ? 3 : 1}">${w.hours}h</span>
          <span><b>${esc(w.row.resort.name)}</b><br><span class="detail-line">${esc(bits.join(" · "))}</span></span>
          <span class="meter-line"><i style="width:${Math.round((w.hours / maxH) * 100)}%"></i></span>
        </button>`;
      })
      .join("");
  }

  // ---------- map ----------
  let map, markerLayer, radarLayer;
  let mapFitted = false;
  const resortBounds = () => L.latLngBounds(RESORTS.map((r) => [r.lat, r.lon])).pad(0.08);
  function initMap() {
    if (!window.L) {
      $("#map").innerHTML = `<p class="map-fallback label">Map unavailable</p>`;
      return;
    }
    map = L.map("map", { scrollWheelZoom: false, zoomSnap: 0.25, zoomControl: true });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 12,
    }).addTo(map);
    radarLayer = L.tileLayer("https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png", {
      opacity: 0.55,
      attribution: 'Radar: <a href="https://mesonet.agron.iastate.edu/">IEM</a>',
    });
    markerLayer = L.layerGroup().addTo(map);
    map.fitBounds(resortBounds());
  }

  function renderMap() {
    if (!map) return;
    if (!mapFitted) {
      map.invalidateSize();
      map.fitBounds(resortBounds());
      mapFitted = true;
    }
    markerLayer.clearLayers();
    state.rows.forEach((row) => {
      const v = state.mapRange === "3" ? row.total3 : row.total7;
      const icon = L.divIcon({
        className: "pin-wrap",
        html: `<span class="pin" data-level="${snowLevel(v)}" style="--c:${snowColor(v)}">${snowVal(v)}</span>`,
        iconSize: [32, 20],
        iconAnchor: [16, 10],
      });
      L.marker([row.resort.lat, row.resort.lon], { icon, title: row.resort.name, riseOnHover: true, zIndexOffset: Math.round(v * 10) })
        .bindTooltip(`<strong>${esc(row.resort.name)}</strong> · ${snowTxt(v)} in ${state.mapRange} days`, { direction: "top", offset: [0, -10] })
        .on("click", () => openDetail(row.resort.id))
        .addTo(markerLayer);
    });
    $("#map-legend").innerHTML =
      SNOW_COLORS.map((c, i) => {
        const lo = i === 0 ? 0 : SNOW_STEPS[i - 1];
        const label = i === 0 ? "0" : i === SNOW_COLORS.length - 1 ? `${snowVal(lo)}+` : `${snowVal(lo)}–${snowVal(SNOW_STEPS[i])}`;
        return `<span><i style="background:${c}"></i>${label}</span>`;
      }).join("") + `<span class="unit">${metric() ? "Centimeters" : "Inches"} · summit</span>`;
  }

  // ---------- resort list ----------
  function renderSortOptions() {
    const opts = state.open
      ? [["7d", "Most snow · 7d"], ["3d", "Most snow · 3d"], ["odds", "Odds of 6″+"], ["powder", "Powder score"], ["grade", "Best ski day"], ["az", "A–Z"]]
      : [["7d", "Most snow · 7d"], ["3d", "Most snow · 3d"], ["sm", "Snowmaking hours"], ["opens", "Typical opening"], ["az", "A–Z"]];
    if (!opts.some(([v]) => v === state.sort)) state.sort = "7d";
    $("#sort").innerHTML = opts.map(([v, l]) => `<option value="${v}"${v === state.sort ? " selected" : ""}>${l}</option>`).join("");
  }

  function filteredRows() {
    const q = state.search.trim().toLowerCase();
    let rows = state.rows.filter((r) => {
      if (state.region === "★") return state.favorites.has(r.resort.id);
      return state.region === "All" || r.resort.state === state.region;
    });
    if (q) rows = rows.filter((r) => `${r.resort.name} ${r.resort.region} ${r.resort.state}`.toLowerCase().includes(q));
    const by = {
      "3d": (a, b) => b.total3 - a.total3,
      "7d": (a, b) => b.total7 - a.total7,
      odds: (a, b) => (b.prob7?.[6] ?? 0) - (a.prob7?.[6] ?? 0) || b.total7 - a.total7,
      powder: (a, b) => (b.best?.score ?? -1) - (a.best?.score ?? -1) || b.total3 - a.total3,
      grade: (a, b) => (b.bestDay?.score ?? -1) - (a.bestDay?.score ?? -1) || b.total7 - a.total7,
      sm: (a, b) => b.snowmaking.hours7 - a.snowmaking.hours7,
      opens: (a, b) => a.season.open.localeCompare(b.season.open),
      az: (a, b) => a.resort.name.localeCompare(b.resort.name),
    }[state.sort];
    rows.sort(by || ((a, b) => b.total7 - a.total7));
    rows.sort((a, b) => state.favorites.has(b.resort.id) - state.favorites.has(a.resort.id));
    return rows;
  }

  function favButton(id, cls = "fav") {
    const on = state.favorites.has(id);
    return `<button class="${cls}" data-fav="${id}" aria-pressed="${on}" aria-label="${on ? "Remove from" : "Add to"} my mountains">${Icon(on ? "starFill" : "star")}</button>`;
  }

  const flags = (row) => row.flags.slice(0, 3).map((f) => `<span class="f-${f.cls}">${fmt(f.text)}</span>`).join("");

  function spark(row) {
    const peak = Math.max(...row.days.map((d) => d.snow));
    return `<div class="spark" role="img" aria-label="Daily snow: ${row.days.map((d) => `${dayShort(d.date)} ${snowTxt(d.snow)}`).join(", ")}">${row.days
      .map((d) => {
        const wet = d.rain + d.ice;
        if (d.snow < 0.5 && wet > 0.1) return `<i class="rain" style="height:${Math.min(30, 8 + wet * 40)}%" title="${dayShort(d.date)}: ${d.ice > 0.05 ? "ice" : "rain"}"></i>`;
        const h = d.snow < 0.5 ? 0 : Math.max(4, (d.snow / state.sparkMax) * 100);
        const cls = [d.snow >= 0.5 && d.snow === peak ? "peak" : "", wet > 0.1 && d.snow >= 0.5 ? "mixed" : ""].join(" ").trim();
        return `<i class="${cls}" style="height:${h}%" title="${dayShort(d.date)}: ${snowTxt(d.snow)}"></i>`;
      })
      .join("")}</div>`;
  }

  // Under the bars: day grades in season, snowmaking hours before it.
  function dayStrip(row) {
    if (operating(row)) {
      return `<div class="grades">${row.days.map((d) => `<span class="g-${d.grade.letter}" title="${dayShort(d.date)}: ${d.grade.letter} · ${fmt(d.grade.why.join(", ") || "typical day")}">${d.grade.letter}</span>`).join("")}</div>`;
    }
    return `<div class="grades sm">${row.days.map((d) => `<span class="sm-${d.smHours >= 10 ? 3 : d.smHours >= 5 ? 2 : d.smHours > 0 ? 1 : 0}" title="${dayShort(d.date)}: ${d.smHours} snowmaking hours at the summit">${d.smHours ? d.smHours + "h" : "·"}</span>`).join("")}</div>`;
  }

  function renderRowsView(rows) {
    return `<div class="rows-head label"><span>Resort</span><span class="r-num">7d</span><span class="day-axis">${state.dates.map((d) => `<span>${dayInitial(d)}</span>`).join("")}</span><span></span></div>
      ${rows
        .map(
          (row) => `<div class="row" data-open="${row.resort.id}" tabindex="0">
          <div class="r-name"><b>${esc(row.resort.name)}</b><small>${esc(row.resort.region)} · ${elevTxt(row.resort.summit)}</small></div>
          <div class="r-num"><b>${snowVal(row.total7)}</b><small>${rangeVal(row.lo7, row.hi7)}</small></div>
          <div>${spark(row)}${dayStrip(row)}<div class="flags">${flags(row)}</div></div>
          ${favButton(row.resort.id)}
        </div>`
        )
        .join("")}`;
  }

  function renderTableView(rows) {
    return `<div class="scroll"><table class="grid">
      <thead><tr><th class="resort-col">Resort</th><th>7d</th>${state.dates.map((d) => `<th>${dayShort(d)}<span class="sub">${dayNum(d)}</span></th>`).join("")}</tr></thead>
      <tbody>${rows
        .map(
          (row) => `<tr data-open="${row.resort.id}" tabindex="0">
          <th class="resort-col" scope="row"><span class="name">${esc(row.resort.name)}</span><span class="sub">${row.resort.state} · ${elevTxt(row.resort.summit)}</span></th>
          <td class="total">${snowVal(row.total7)}</td>
          ${row.days
            .map(
              (d) => `<td class="cell" data-conf="${d.conf}" style="--c:${d.snow >= 0.5 ? snowColor(d.snow) : "transparent"}">
              <span class="amt">${d.snow >= 0.5 ? snowVal(d.snow) : "–"}</span>
              ${d.hi >= 1 ? `<span class="range">${rangeVal(d.lo, d.hi)}</span>` : ""}
              ${d.rain + d.ice > 0.1 ? `<span class="rain-mark">${d.ice > 0.05 ? "ICE" : "RAIN"}</span>` : ""}${
                d.grade ? `<span class="cell-grade g-${d.grade.letter}">${d.grade.letter}</span>` : d.smHours ? `<span class="cell-grade sm-cell">${d.smHours}h</span>` : ""
              }</td>`
            )
            .join("")}</tr>`
        )
        .join("")}</tbody></table></div>`;
  }

  function renderList() {
    const rows = filteredRows();
    const el = $("#list");
    if (!rows.length) {
      el.innerHTML = `<p class="empty">${state.region === "★" ? "Tap the star on any resort to add it to your mountains." : "No resorts match."}</p>`;
      return;
    }
    el.innerHTML = state.view === "table" ? renderTableView(rows) : renderRowsView(rows);
  }

  function renderFilters() {
    const states = ["All", "★", ...new Set(RESORTS.map((r) => r.state))];
    $("#filters").innerHTML = states
      .map((s) => `<button class="chip" aria-pressed="${s === state.region}" data-region="${s}">${s === "★" ? `${Icon("starFill")}Mine` : s}</button>`)
      .join("");
    document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
    document.querySelectorAll("[data-units]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.units === state.units)));
    document.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === state.mapRange)));
  }

  // ---------- detail ----------
  function destroyCharts() {
    state.charts.forEach((c) => c.destroy());
    state.charts = [];
  }

  function chartOptions(times, yTitle) {
    const muted = css("--muted");
    const line = css("--line");
    const mono = { family: "Geist Mono", size: 10.5 };
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", align: "start", labels: { color: muted, boxWidth: 14, boxHeight: 2, padding: 14, font: mono, filter: (item) => !item.text.startsWith("_") } },
        tooltip: {
          backgroundColor: "#0b0d10",
          cornerRadius: 0,
          titleFont: { family: "Geist Mono", size: 11 },
          bodyFont: { family: "Geist Mono", size: 11 },
          filter: (item) => !item.dataset.label.startsWith("_"),
          callbacks: { title: (items) => `${dayShort(times[items[0].dataIndex].slice(0, 10))} ${hourLabel(times[items[0].dataIndex])}` },
        },
      },
      scales: {
        x: {
          ticks: { color: muted, autoSkip: false, maxRotation: 0, font: mono, callback: (v, i) => (times[i]?.slice(11, 13) === "12" ? dayShort(times[i].slice(0, 10)).toUpperCase() : "") },
          grid: { color: (c) => (times[c.index]?.slice(11, 13) === "00" ? line : "transparent"), drawTicks: false },
          border: { color: "#0b0d10" },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: yTitle, color: muted, font: mono },
          ticks: { color: muted, font: mono },
          grid: { color: line },
          border: { display: false },
        },
      },
    };
  }

  function drawCharts(row, det) {
    if (!window.Chart || !det) return;
    destroyCharts();
    const n = Math.min(det.time.length, 24 * state.dates.length);
    const times = det.time.slice(0, n);
    const fg = css("--fg");
    const accent = css("--accent");
    const warn = css("--warn");
    const cut = (a) => a.slice(0, n);
    const sv = (v) => (v == null ? null : +snowNum(v).toFixed(1));

    // Snow accumulation: ensemble 10–90% band, each model, and the blend.
    const ds = [];
    if (det.ens) {
      ds.push({ label: "_p90", data: cut(det.ens.p90).map(sv), borderWidth: 0, pointRadius: 0, backgroundColor: "rgba(0,87,255,0.08)", fill: "+1" });
      ds.push({ label: "_p10", data: cut(det.ens.p10).map(sv), borderWidth: 0, pointRadius: 0, fill: false });
    }
    det.models.forEach((m) => {
      const meta = state.data.models.find((x) => x.id === m.id) || { label: m.id, color: "#999" };
      ds.push({ label: meta.label, data: cut(m.cum).map(sv), borderColor: meta.color, backgroundColor: meta.color, borderWidth: 1.1, pointRadius: 0, tension: 0.2 });
    });
    let run = 0;
    ds.push({ label: "Upslope blend", data: cut(det.summit.snow).map((s) => +snowNum((run += s || 0)).toFixed(1)), borderColor: fg, backgroundColor: fg, borderWidth: 2.5, pointRadius: 0, tension: 0.2 });
    state.charts.push(new Chart($("#chart-snow"), { type: "line", data: { labels: times, datasets: ds }, options: chartOptions(times, snowUnit()) }));

    // Temperatures at summit and base, with the freezing and snowmaking lines.
    const temps = (arr) => cut(arr).map((t) => (t == null ? null : +tempNum(t).toFixed(1)));
    const flat = (f) => times.map(() => +tempNum(f).toFixed(1));
    const tds = [
      { label: "Summit", data: temps(det.summit.t), borderColor: accent, backgroundColor: accent, borderWidth: 1.75, pointRadius: 0, tension: 0.2 },
      { label: "Base", data: temps(det.base.t), borderColor: fg, backgroundColor: fg, borderWidth: 1.25, pointRadius: 0, tension: 0.2 },
      { label: "Freezing", data: flat(32), borderColor: warn, backgroundColor: warn, borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
    ];
    if (!operating(row)) {
      tds.splice(2, 0, { label: "Summit wet bulb", data: temps(det.summit.tw), borderColor: "#0aa2c0", backgroundColor: "#0aa2c0", borderWidth: 1.25, borderDash: [2, 2], pointRadius: 0, tension: 0.2 });
      tds.push({ label: "Snowmaking", data: flat(27), borderColor: "#6b7280", backgroundColor: "#6b7280", borderDash: [1, 3], borderWidth: 1, pointRadius: 0 });
    }
    const o2 = chartOptions(times, metric() ? "°C" : "°F");
    o2.scales.y.beginAtZero = false;
    state.charts.push(new Chart($("#chart-temp"), { type: "line", data: { labels: times, datasets: tds }, options: o2 }));
  }

  // Hour-by-hour precipitation type at summit and base.
  const PTYPE = { sn: "Snow", mx: "Rain/snow", ra: "Rain", pl: "Sleet", zr: "Freezing rain" };
  function ptypePanel(row, det) {
    if (!det) return "";
    const n = Math.min(det.time.length, 24 * state.dates.length);
    const any = det.summit.type.slice(0, n).some(Boolean) || det.base.type.slice(0, n).some(Boolean);
    if (!any) return "";
    const strip = (types, amt) =>
      types
        .slice(0, n)
        .map((t, i) => `<i class="pt-${t || "none"}" title="${dayShort(det.time[i].slice(0, 10))} ${hourLabel(det.time[i])}: ${t ? PTYPE[t] : "Dry"}"></i>`)
        .join("");
    return `<section class="panel">
      <div class="block-head"><h3>Precipitation type</h3><span class="label">Hour by hour</span></div>
      <p class="hint">Uses the wet-bulb temperature at each elevation and the warm layer near 5,000 ft, so it catches sleet and freezing rain that a surface temperature alone misses.</p>
      <div class="ptype"><span class="label">Summit</span><div class="pt-strip" style="--n:${n}">${strip(det.summit.type)}</div>
      <span class="label">Base</span><div class="pt-strip" style="--n:${n}">${strip(det.base.type)}</div>
      <span></span><div class="pt-axis" style="--n:${state.dates.length}">${state.dates.map((d) => `<span>${dayShort(d)}</span>`).join("")}</div></div>
      <div class="legend label">${Object.entries(PTYPE).map(([k, v]) => `<span><i class="pt-${k}"></i>${v}</span>`).join("")}</div>
    </section>`;
  }

  const QUALITY = (slr) => (slr == null ? null : slr >= 15 ? { key: "blower", label: "Blower powder" } : slr >= 11 ? { key: "powder", label: "Classic powder" } : slr >= 8 ? { key: "packing", label: "Dense snow" } : { key: "wet", label: "Heavy, wet snow" });
  const QUALITY_KEYS = ["wet", "packing", "powder", "blower"];
  const QUALITY_SHORT = { wet: "Wet", packing: "Dense", powder: "Powder", blower: "Blower" };

  function qualityBlock(q, ratio) {
    if (!q) return "";
    const idx = QUALITY_KEYS.indexOf(q.key);
    return `<section class="panel">
      <div class="block-head"><h3>Snow quality</h3><span class="label">SLR ${Math.round(ratio)}:1</span></div>
      <p class="hint"><strong style="color:var(--fg)">${q.label}.</strong> About ${Math.round(ratio)} inches of snow for every inch of water, from the warmest temperature between the summit and 10,000 ft and the wind.</p>
      <div class="scale">${QUALITY_KEYS.map((k, i) => `<span class="${i <= idx ? "on" : ""}"></span>`).join("")}</div>
      <div class="scale-labels label">${QUALITY_KEYS.map((k) => `<span>${QUALITY_SHORT[k]}</span>`).join("")}</div>
    </section>`;
  }

  const setupName = (key) => (SETUPS[key] ? SETUPS[key].label : key);

  function guidePanel(row) {
    const g = guideFor(row.resort);
    const thisWeek = row.storms.filter((s) => s.total >= 1).length
      ? row.storms
          .filter((s) => s.total >= 1)
          .map((s) => {
            const tag = s.setup.best ? `<span class="tag on">Best setup</span>` : s.setup.favored ? `<span class="tag on">Good setup</span>` : `<span class="tag">Not its best setup</span>`;
            const odds = s.prob && s.prob[6] != null ? ` · ${s.prob[6]}% odds of ${snowTxt(6)}+` : "";
            return `<li><span class="mono">${dayShort(s.start.slice(0, 10)).toUpperCase()} ${hourLabel(s.start)}</span><span>${setupName(s.setup.key)} · ${compass(s.setup.dir)} flow · ${snowTxt(s.total)}${odds}</span>${tag}</li>`;
          })
          .join("")
      : `<li><span class="mono">7 DAYS</span><span>No snow events in the forecast.</span></li>`;
    return `<section class="panel">
      <div class="block-head"><h3>Local knowledge</h3><span class="label">What works here</span></div>
      <ul class="notes">${(g.notes || []).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
      <div class="setups">${(g.setups || []).map((k, i) => `<div class="setup"><span class="label">${i === 0 ? "Best setup" : "Also works"}</span><b>${setupName(k)}</b><p>${esc(SETUPS[k].blurb)}</p></div>`).join("")}</div>
      <div class="label week-label">This week's storms</div>
      <ul class="storm-list">${thisWeek}</ul>
    </section>`;
  }

  function arrow(dir) {
    if (dir == null) return "";
    return `<svg class="arrow" viewBox="0 0 12 12" style="transform:rotate(${Math.round(dir + 180)}deg)" aria-hidden="true"><path d="M6 1v10M2.5 7.5 6 11l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
  }

  function windPanel(row, det) {
    if (!det || !operating(row)) return "";
    const g = guideFor(row.resort);
    const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16];
    const label = (h) => (h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`);
    const rowsHtml = row.days
      .map((d) => {
        const cells = hours
          .map((h) => {
            const i = det.time.findIndex((t) => t.startsWith(d.date) && Number(t.slice(11, 13)) === h);
            if (i < 0) return `<td class="w-none"></td>`;
            const gust = det.summit.gust[i];
            const dir = det.summit.dir[i];
            const risk = windRisk(row, gust, dir);
            return `<td class="w-${risk}" title="${label(h)} · gusts ${windTxt(gust)} from ${compass(dir)}">${gust != null ? Math.round(windNum(gust)) : "–"}${arrow(dir)}</td>`;
          })
          .join("");
        return `<tr><th scope="row">${dayShort(d.date)}</th>${cells}</tr>`;
      })
      .join("");
    const mid = (g.exposed[0] + ((g.exposed[1] - g.exposed[0] + 360) % 360) / 2) % 360;
    return `<section class="panel">
      <div class="block-head"><h3>Lift wind, 8am–4pm</h3><span class="label">Summit gusts · ${metric() ? "km/h" : "mph"}</span></div>
      <p class="guide-text">${esc(g.wind || "")} Holds get likely here around ${windTxt(g.hold)}, a bit lower when wind comes from the ${compass(mid)}.</p>
      <div class="scroll"><table class="windgrid">
        <thead><tr><th></th>${hours.map((h) => `<th>${label(h)}</th>`).join("")}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table></div>
      <div class="legend label"><span><i class="w-low"></i>Running</span><span><i class="w-moderate"></i>Slowdowns possible</span><span><i class="w-high"></i>Holds likely</span><span>Arrows show where the wind blows</span></div>
    </section>`;
  }

  function modelTable(row, det) {
    if (!det) return "";
    return `<section class="panel">
      <div class="block-head"><h3>Model by model</h3><span class="label">Summit snow · ${snowUnit()}</span></div>
      <p class="hint">High-resolution models (HRRR, NAM, HRDPS) run about two days out and get extra weight while they last. Blank cells are past a model's range.</p>
      <div class="scroll"><table class="models">
        <thead><tr><th style="text-align:left;padding-left:0">Model</th>${state.dates.map((d) => `<th>${dayShort(d)}</th>`).join("")}<th>Total</th></tr></thead>
        <tbody>${det.modelDays
          .map((m) => {
            const meta = state.data.models.find((x) => x.id === m.id) || { label: m.id, color: "#999" };
            const full = m.days.every((v) => v != null);
            return `<tr><th scope="row"><span class="swatch" style="background:${meta.color}"></span>${esc(meta.label)}</th>${m.days
              .map((v) => (v == null ? `<td class="na"></td>` : `<td style="--c:${v >= 0.5 ? snowColor(v) : "transparent"}">${v >= 0.5 ? snowVal(v) : "–"}</td>`))
              .join("")}<td class="strong">${full ? snowVal(sum(m.days)) : "–"}</td></tr>`;
          })
          .join("")}</tbody>
      </table></div>
    </section>`;
  }

  function oddsPanel(row) {
    if (!row.prob7) return "";
    const ths = [1, 3, 6, 12, 18];
    const p = (o) => ths.map((t) => `<td><span class="odds" style="--p:${o[t]}%">${o[t]}%</span></td>`).join("");
    return `<section class="panel">
      <div class="block-head"><h3>Odds of snow</h3><span class="label">${state.data.ensembles.members} ensemble runs</span></div>
      <p class="hint">The GFS and European ensembles each rerun their model dozens of times with small tweaks. The share of runs reaching each total is a fair read on the odds.${row.ens7 ? ` Middle 80% of runs: ${rangeTxt(row.ens7.p10, row.ens7.p90)} over 7 days.` : ""}</p>
      <div class="scroll"><table class="models odds-table">
        <thead><tr><th style="text-align:left;padding-left:0">At least</th>${ths.map((t) => `<th>${snowTxt(t)}</th>`).join("")}</tr></thead>
        <tbody><tr><th scope="row">Next 3 days</th>${p(row.prob3)}</tr><tr><th scope="row">Next 7 days</th>${p(row.prob7)}</tr></tbody>
      </table></div>
    </section>`;
  }

  function seasonLine(row) {
    const s = row.season;
    if (s.phase === "preseason") return `Pre-season · typically opens ${dayNum(s.open)}`;
    if (s.phase === "closed") return "Closed for the season";
    if (s.phase === "early") return "Early season";
    if (s.phase === "spring") return "Spring skiing";
    return "In season";
  }

  async function loadDetail(id) {
    if (state.details[id]) return state.details[id];
    try {
      const res = await fetch(`data/r/${id}.json?v=${encodeURIComponent(state.data.generated)}`);
      if (!res.ok) return null;
      return (state.details[id] = await res.json());
    } catch (e) {
      return null;
    }
  }

  function kpis(row) {
    const days = row.days;
    const snowy = days.filter((d) => d.slr && d.snow >= 0.5);
    const ratio = snowy.length ? median(snowy.map((d) => d.slr)) : null;
    const q = QUALITY(ratio);
    const k = [`<div><span class="label">Snow · 7d</span><b>${snowTxt(row.total7)}</b><span>${rangeTxt(row.lo7, row.hi7)} range</span></div>`];
    if (operating(row)) {
      k.push(`<div><span class="label">Odds of ${snowTxt(6)}+</span><b>${row.prob7 ? row.prob7[6] + "%" : "–"}</b><span>Next 7 days</span></div>`);
      k.push(`<div><span class="label">Snow quality</span><b>${q ? QUALITY_SHORT[q.key] : "–"}</b><span>${q ? `SLR ${Math.round(ratio)}:1` : "No snow"}</span></div>`);
      k.push(`<div><span class="label">Best ski day</span><b>${dayShort(days[row.bestDay.k].date)} · ${row.bestDay.letter}</b><span>${fmt(days[row.bestDay.k].grade.why.slice(0, 2).join(", ") || "typical day")}</span></div>`);
    } else {
      const best = [...row.snowmaking.windows].sort((a, b) => b.hours - a.hours)[0];
      k.push(`<div><span class="label">Snowmaking · 7d</span><b>${row.snowmaking.hours7}h</b><span>${best ? `Best ${dayShort(best.start.slice(0, 10))}, low ${tempTxtU(best.minTw)}` : "Too warm"}</span></div>`);
      k.push(`<div><span class="label">Odds of ${snowTxt(1)}+</span><b>${row.prob7 ? row.prob7[1] + "%" : "–"}</b><span>Next 7 days</span></div>`);
      k.push(`<div><span class="label">Typically opens</span><b>${row.season.phase === "preseason" ? dayNum(row.season.open) : "–"}</b><span>${row.season.phase === "preseason" ? `${row.season.daysToOpen} days out` : "Closed"}</span></div>`);
    }
    return { html: k.join(""), q, ratio };
  }

  async function openDetail(id) {
    const row = state.rows.find((r) => r.resort.id === id);
    if (!row) return;
    const r = row.resort;
    state.selected = id;
    const dlg = $("#detail");
    const det = state.details[id];
    const days = row.days;
    const { html: kpiHtml, q, ratio } = kpis(row);
    const lead = row.insights.slice(0, 2);
    const rest = row.insights.slice(2);
    $("#detail-body").innerHTML = `
      <header class="detail-head">
        <span class="label">${esc(r.region)} · ${r.state} · ${seasonLine(row)}</span>
        <div class="detail-actions">${favButton(id, "sq fav")}<button class="sq" data-close aria-label="Close">${Icon("close")}</button></div>
      </header>
      <div class="d-body">
        <div class="d-title"><h2>${esc(r.name)}</h2><p class="mono">SUMMIT ${elevTxt(r.summit).toUpperCase()} · BASE ${elevTxt(r.base).toUpperCase()}</p></div>
        <p class="summary">${lead.map((x) => fmt(x.text)).join(" ")}</p>
        ${rest.length ? `<ul class="insights">${rest.map((x) => `<li data-kind="${x.kind}">${fmt(x.text)}</li>`).join("")}</ul>` : ""}
        <div class="d-kpis">${kpiHtml}</div>
        <div class="days">${days
          .map((d) => {
            const ic = dayIcon(d);
            const wet = d.rain + d.ice;
            const flag = d.windHold
              ? `<span class="day-flag wind">Wind ${Math.round(windNum(d.skiGust))}</span>`
              : wet > 0.1
                ? `<span class="day-flag rain">${d.ice > 0.05 ? "Ice" : "Rain"}</span>`
                : d.snow >= 0.5 || d.hi >= 1
                  ? `<span class="day-flag conf-${d.conf}">${d.conf === "high" ? "Sure" : d.conf === "medium" ? "Likely" : "Unsure"}</span>`
                  : !operating(row) && d.smHours
                    ? `<span class="day-flag cold">Guns ${d.smHours}h</span>`
                    : `<span class="day-flag">&nbsp;</span>`;
            const badge = d.grade ? `<span class="grade g-${d.grade.letter}">${d.grade.letter}</span>` : "";
            const title = d.grade ? `${d.grade.letter}: ${fmt(d.grade.why.join(", ") || "typical day")}` : `${d.smHours} snowmaking hours at the summit, ${d.smBase} at the base`;
            return `<div class="day${d.snow >= 0.5 ? " snowy" : ""}" style="--c:${snowColor(d.snow)}" title="${title}">
              <span class="day-top"><span class="label">${dayShort(d.date)}</span>${badge}</span>
              <span title="${ic.label}">${Icon(ic.icon)}</span>
              <span class="day-snow">${d.snow >= 0.5 ? snowTxt(d.snow) : "–"}</span>
              <span class="day-range">${d.hi >= 1 ? rangeTxt(d.lo, d.hi) : "&nbsp;"}</span>
              <span class="day-temp"><b>${tempTxt(d.tMax)}</b> / ${tempTxt(d.tMin)}</span>
              ${flag}
            </div>`;
          })
          .join("")}</div>
        <p class="hint grade-key">${
          operating(row)
            ? "Day grades A–F weigh fresh snow, rain, refrozen surfaces, lift-closing wind and cold. Tap or hover a day for the reasons."
            : "Pre-season: no day grades until the lifts turn. Days show snowmaking hours, when the summit wet-bulb temperature is at or below " + tempTxtU(27) + "."
        }</p>
        <div id="detail-hourly">${detailHourly(row, det)}</div>
        ${guidePanel(row)}
        ${oddsPanel(row)}
        ${qualityBlock(q, ratio)}
      </div>`;
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    history.replaceState(null, "", `#${id}`);
    if (det) return drawCharts(row, det);
    const loaded = await loadDetail(id);
    if (state.selected !== id || !loaded) return;
    $("#detail-hourly").innerHTML = detailHourly(row, loaded);
    drawCharts(row, loaded);
  }

  function detailHourly(row, det) {
    if (!det) return `<div class="skeleton sk-row"></div><div class="skeleton sk-row"></div>`;
    return `${windPanel(row, det)}
      <section class="panel">
        <div class="block-head"><h3>Snow accumulation, summit</h3><span class="label">${snowUnit()} · running total</span></div>
        <p class="hint">Thin lines are individual models. The black line is the Upslope blend. The shaded band holds the middle 80% of ${state.data.ensembles.members} ensemble runs: the wider it is, the less certain the forecast.</p>
        <div class="chart"><canvas id="chart-snow"></canvas></div>
      </section>
      ${ptypePanel(row, det)}
      <section class="panel">
        <div class="block-head"><h3>Temperature, summit vs base</h3><span class="label">${metric() ? "°C" : "°F"} · hourly</span></div>
        <p class="hint">${
          operating(row)
            ? "Above the dashed freezing line, snow turns to rain or melts. Base above and summit below means snow up top and slush at the bottom."
            : "Snow guns need the wet-bulb temperature (air temperature adjusted for humidity) at or below the dotted snowmaking line. Dry air lets them run above freezing."
        }</p>
        <div class="chart"><canvas id="chart-temp"></canvas></div>
      </section>
      ${modelTable(row, det)}`;
  }

  function closeDetail() {
    state.selected = null;
    destroyCharts();
    const dlg = $("#detail");
    if (dlg.open) dlg.close();
    history.replaceState(null, "", location.pathname + location.search);
  }

  function toggleFav(id) {
    if (state.favorites.has(id)) state.favorites.delete(id);
    else state.favorites.add(id);
    store.set("ups-favs", [...state.favorites]);
    const on = state.favorites.has(id);
    document.querySelectorAll(`[data-fav="${id}"]`).forEach((b) => {
      b.setAttribute("aria-pressed", String(on));
      b.innerHTML = Icon(on ? "starFill" : "star");
    });
    renderList();
  }

  function renderAll() {
    renderFilters();
    renderHero();
    renderPicks();
    renderMap();
    renderList();
  }

  // ---------- events ----------
  function bind() {
    document.addEventListener("click", (e) => {
      const fav = e.target.closest("[data-fav]");
      if (fav) {
        e.stopPropagation();
        return toggleFav(fav.dataset.fav);
      }
      if (e.target.closest("[data-close]")) return closeDetail();
      const reg = e.target.closest("[data-region]");
      if (reg) {
        state.region = reg.dataset.region;
        store.set("ups-region", state.region);
        renderFilters();
        return renderList();
      }
      const view = e.target.closest("[data-view]");
      if (view) {
        state.view = view.dataset.view;
        store.set("ups-view", state.view);
        renderFilters();
        return renderList();
      }
      const units = e.target.closest("[data-units]");
      if (units) {
        state.units = units.dataset.units;
        store.set("ups-units", state.units);
        if (!state.rows.length) return renderFilters();
        renderAll();
        if (state.selected) openDetail(state.selected);
        return;
      }
      const range = e.target.closest("[data-range]");
      if (range) {
        state.mapRange = range.dataset.range;
        renderFilters();
        return renderMap();
      }
      if (e.target.closest("#radar-toggle")) {
        state.radar = !state.radar;
        $("#radar-toggle").setAttribute("aria-pressed", String(state.radar));
        if (map) state.radar ? radarLayer.addTo(map) : map.removeLayer(radarLayer);
        return;
      }
      const open = e.target.closest("[data-open]");
      if (open && state.rows.length) openDetail(open.dataset.open);
    });
    document.addEventListener("keydown", (e) => {
      const open = e.target.closest?.("[data-open]");
      if (open && (e.key === "Enter" || e.key === " ") && open.tagName !== "BUTTON") {
        e.preventDefault();
        openDetail(open.dataset.open);
      }
    });
    $("#detail").addEventListener("close", () => state.selected && closeDetail());
    $("#detail").addEventListener("click", (e) => {
      if (e.target === $("#detail")) closeDetail();
    });
    $("#search").addEventListener("input", (e) => {
      state.search = e.target.value;
      renderList();
    });
    $("#sort").addEventListener("change", (e) => {
      state.sort = e.target.value;
      renderList();
    });
  }

  async function init() {
    if (window.Chart) Chart.defaults.font.family = "Geist, system-ui, sans-serif";
    renderFilters();
    bind();
    initMap();
    try {
      const res = await fetch(`${DATA_URL}?t=${Math.floor(Date.now() / 600000)}`);
      if (!res.ok) throw new Error(res.status);
      state.data = await res.json();
    } catch (e) {
      $("#status").textContent = "Forecast unavailable · retry in a few minutes";
      $("#headline").innerHTML = `<h1>Forecast unavailable.</h1><p>The forecast file didn't load. Refresh in a few minutes.</p>`;
      return;
    }
    buildRows();
    renderSortOptions();
    const gen = new Date(state.data.generated);
    const ageH = (Date.now() - gen) / 3600000;
    $("#asof").textContent = `Updated ${gen.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" })} · ${gen.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`;
    const ok = state.data.models.filter((m) => m.ok);
    $("#status").textContent = `${ok.length} models${state.data.ensembles.members ? ` + ${state.data.ensembles.members} ensemble runs` : ""} · ${ok.map((m) => m.label).join(" · ")}${ageH > 12 ? " · forecast is more than 12 hours old" : ""}`;
    renderAll();
    const hash = location.hash.slice(1);
    if (hash && RESORTS.some((r) => r.id === hash)) openDetail(hash);
  }

  init();
})();
