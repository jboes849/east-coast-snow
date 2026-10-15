(function () {
  const F = window.Forecast;
  const { MODELS, loadAll, consensus, hourly, storms, powderScore, forecastDates, median } = F;
  const RESORTS = window.RESORTS;
  const Icon = window.Icon;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  const state = {
    dates: forecastDates(),
    summit: null,
    rows: [],
    region: store.get("ups-region", "All"),
    search: "",
    sort: "7d",
    view: store.get("ups-view", "rows"),
    units: store.get("ups-units", "in"),
    favorites: new Set(store.get("ups-favs", [])),
    mapRange: "3",
    radar: false,
    selected: null,
    charts: [],
  };

  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);

  // ---------- units and formatting ----------
  const metric = () => state.units === "cm";
  const snowNum = (inches) => (metric() ? inches * 2.54 : inches);
  const snowUnit = () => (metric() ? "cm" : "in");
  function snowVal(inches) {
    const v = snowNum(inches);
    if (v < (metric() ? 1 : 0.5)) return "0";
    if (v < 10) return v.toFixed(metric() ? 0 : 1).replace(/\.0$/, "");
    return String(Math.round(v));
  }
  const snowTxt = (inches) => snowVal(inches) + (metric() ? " cm" : "″");
  const rangeTxt = (lo, hi) => `${snowVal(lo)}–${snowTxt(hi)}`;
  const rangeVal = (lo, hi) => `${snowVal(lo)}–${snowVal(hi)}`;
  const tempNum = (f) => (f == null ? null : metric() ? (f - 32) * 5 / 9 : f);
  const tempTxt = (f) => (f == null ? "–" : `${Math.round(tempNum(f))}°`);
  const windNum = (mph) => (mph == null ? null : metric() ? mph * 1.609 : mph);
  const windTxt = (mph) => (mph == null ? "–" : `${Math.round(windNum(mph))} ${metric() ? "km/h" : "mph"}`);
  const elevTxt = (ft) => (metric() ? `${Math.round(ft * 0.3048).toLocaleString()} m` : `${Math.round(ft).toLocaleString()} ft`);
  const WIND_HOLD = 45;

  // ---------- dates ----------
  const today = () => state.dates[0];
  const dateObj = (date) => new Date(date + "T12:00:00");
  const dayShort = (date) => (date === state.dates[0] ? "Today" : dateObj(date).toLocaleDateString("en-US", { weekday: "short" }));
  const dayInitial = (date) => dateObj(date).toLocaleDateString("en-US", { weekday: "narrow" });
  function dayLong(date) {
    if (date === state.dates[0]) return "today";
    if (date === state.dates[1]) return "tomorrow";
    return dateObj(date).toLocaleDateString("en-US", { weekday: "long" });
  }
  const dayNum = (date) => dateObj(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  function whenTxt(t) {
    const date = t.slice(0, 10);
    const h = Number(t.slice(11, 13));
    const d = dayLong(date);
    if (date === today()) return h < 12 ? "this morning" : h < 17 ? "this afternoon" : "tonight";
    if (h < 6) return `early ${d}`;
    if (h < 12) return `${d} morning`;
    if (h < 17) return `${d} afternoon`;
    return d === "tomorrow" ? "tomorrow night" : `${d} night`;
  }

  // ---------- colors ----------
  const SNOW_STEPS = [0.5, 3, 6, 12, 18];
  const SNOW_COLORS = ["#e5e7eb", "#c9d8f6", "#8fb0ec", "#4d82e6", "#0057ff", "#00238a"];
  const snowLevel = (x) => SNOW_STEPS.filter((s) => x >= s).length;
  const snowColor = (x) => SNOW_COLORS[snowLevel(x)];
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function dayIcon(d) {
    if (d.snow >= 3) return { icon: "heavySnow", label: "Heavy snow" };
    if (d.snow >= 0.5) return d.mix > 0.1 ? { icon: "mix", label: "Snow and rain" } : { icon: "snow", label: "Snow" };
    if (d.mix > 0.1) return { icon: "rain", label: "Rain" };
    if (d.cloud != null && d.cloud < 30) return { icon: "sun", label: "Sunny" };
    if (d.cloud != null && d.cloud < 70) return { icon: "partly", label: "Partly cloudy" };
    return { icon: "cloud", label: "Cloudy" };
  }
  const confTxt = (c) => (c === "high" ? "High agreement" : c === "medium" ? "Medium agreement" : "Low agreement");

  // ---------- data shaping ----------
  function buildRows() {
    state.rows = RESORTS.map((r, i) => {
      const perModel = state.summit.map((m) => m.locs[i]).filter(Boolean);
      const days = consensus(perModel, state.dates);
      const hc = hourly(perModel);
      const best = [1, 2, 3].map((k) => ({ k, score: powderScore(days[k]) })).sort((a, b) => b.score - a.score)[0];
      const totals = perModel.map((m) => sum(state.dates.map((d) => m.days[d]?.snow ?? 0)));
      return {
        resort: r,
        index: i,
        perModel,
        days,
        hc,
        storms: storms(hc, perModel),
        total3: sum(days.slice(0, 3).map((d) => d.snow)),
        total7: sum(days.map((d) => d.snow)),
        lo7: Math.min(...totals),
        hi7: Math.max(...totals),
        best,
        rainDay: days.find((d) => d.mix > 0.1),
        windDay: days.find((d) => d.gustMax >= WIND_HOLD),
        snowmaking: days.slice(0, 3).filter((d) => d.coldHours >= 6).length,
      };
    });
    state.sparkMax = Math.max(6, ...state.rows.flatMap((r) => r.days.map((d) => d.snow)));
  }

  // Plain-English summary for one resort.
  function describe(row) {
    const out = [];
    const big = [...row.storms].sort((a, b) => b.total - a.total)[0];
    if (!big) {
      out.push(`No meaningful snow in the next 7 days at ${row.resort.name}.`);
      if (row.snowmaking >= 2) out.push("Cold nights should keep the snow guns running.");
    } else {
      const start = whenTxt(big.startTime);
      const end = whenTxt(big.endTime);
      const when = start === end ? `Snow ${start}` : `Snow starts ${start} and wraps up ${end}`;
      out.push(`${when}, with about ${snowTxt(big.total)} up top (models range ${rangeTxt(big.lo, big.hi)}).`);
      if (big.quality) out.push(`Expect ${big.quality.blurb} snow.`);
      const others = row.storms.filter((s) => s !== big);
      if (others.length) out.push(`${others.length === 1 ? "Another round adds" : "More rounds add"} ${snowTxt(sum(others.map((s) => s.total)))} later in the week.`);
    }
    if (row.rainDay) {
      const summitMix = row.rainDay.tMax != null && row.rainDay.tMax > 34;
      out.push(`Rain or ice is likely ${dayLong(row.rainDay.date)}${summitMix ? ", even at the summit" : ", mainly lower down"}.`);
    }
    if (row.windDay) out.push(`Gusts near ${windTxt(row.windDay.gustMax)} ${dayLong(row.windDay.date)} could put upper lifts on wind hold.`);
    if (row.best.score >= 40) out.push(`Best powder morning: ${dayLong(row.days[row.best.k].date)} (score ${row.best.score}).`);
    return out.join(" ");
  }

  const listTxt = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

  // Region-level headline for the hero.
  function headline() {
    const byRegion = {};
    state.rows.forEach((r) => (byRegion[r.resort.region] ||= []).push(r));
    const regions = Object.entries(byRegion)
      .map(([name, rows]) => ({ name, top: [...rows].sort((a, b) => b.total7 - a.total7)[0] }))
      .sort((a, b) => b.top.total7 - a.top.total7);
    const lead = regions[0];
    if (!lead || lead.top.total7 < 1) {
      const cold = state.rows.filter((r) => r.snowmaking >= 2).length;
      return {
        title: "A quiet week across the East.",
        text: `No meaningful natural snow in the next 7 days.${cold ? ` Cold nights mean good snowmaking weather at ${cold} of ${state.rows.length} resorts.` : ""}`,
      };
    }
    const big = [...lead.top.storms].sort((a, b) => b.total - a.total)[0];
    const when = big ? ` The main round arrives ${whenTxt(big.startTime)}.` : "";
    const second = regions[1] && regions[1].top.total7 >= 2 ? ` ${regions[1].name} follows with up to ${snowTxt(regions[1].top.total7)} at ${regions[1].top.resort.name}.` : "";
    const quiet = regions.filter((r) => r.top.total7 < 2).map((r) => r.name);
    return {
      title: `${lead.name} leads the week.`,
      text: `Up to ${snowTxt(lead.top.total7)} at ${lead.top.resort.name} over the next 7 days (models range ${rangeTxt(lead.top.lo7, lead.top.hi7)}).${when}${second}${quiet.length && quiet.length < regions.length ? ` Little to nothing for ${listTxt(quiet.slice(0, 3))}.` : ""}`,
    };
  }

  // ---------- hero ----------
  function renderHero() {
    const h = headline();
    $("#headline").innerHTML = `<h1>${esc(h.title)}</h1><p>${esc(h.text)}</p>`;
    const biggest = [...state.rows].sort((a, b) => b.total7 - a.total7)[0];
    const powder = [...state.rows].sort((a, b) => b.best.score - a.best.score || b.total3 - a.total3)[0];
    const coldest = [...state.rows].sort((a, b) => (a.days[1].tMin ?? 99) - (b.days[1].tMin ?? 99))[0];
    const stats = [
      { label: "Most snow · 7d", value: `${snowVal(biggest.total7)}<i>${snowUnit()}</i>`, sub: biggest.resort.name, id: biggest.resort.id },
      powder.best.score > 0
        ? { label: "Best first chair", value: dayShort(powder.days[powder.best.k].date), sub: `${powder.resort.name} · ${powder.best.score}`, id: powder.resort.id }
        : { label: "Best first chair", value: "–", sub: "None in 3 days" },
      { label: "Coldest summit", value: `${Math.round(tempNum(coldest.days[1].tMin))}<i>${metric() ? "°C" : "°F"}</i>`, sub: `${coldest.resort.name} · tmrw`, id: coldest.resort.id },
    ];
    $("#stats").innerHTML = stats
      .map((s) => `<button class="kpi" ${s.id ? `data-open="${s.id}"` : "disabled"}><span class="label">${s.label}</span><span class="kpi-value">${s.value}</span><span class="kpi-sub">${esc(s.sub)}</span></button>`)
      .join("");
  }

  // ---------- powder picks ----------
  function renderPicks() {
    const top = state.rows.filter((r) => r.best.score > 0).sort((a, b) => b.best.score - a.best.score || b.total3 - a.total3).slice(0, 4);
    const el = $("#picks");
    if (!top.length) {
      el.innerHTML = `<p class="empty">No powder mornings in the next three days.</p>`;
      return;
    }
    el.innerHTML = top
      .map((row) => {
        const d = row.days[row.best.k];
        const bits = [`${dayShort(d.date)} 06:00`, `${snowTxt(d.overnight)} overnight`];
        if (d.ratio) bits.push(`SLR ${Math.round(d.ratio)}:1`);
        bits.push(confTxt(d.confidence));
        return `<button class="pick" data-open="${row.resort.id}">
          <span class="score" data-tier="${row.best.score >= 75 ? 3 : 1}">${row.best.score}</span>
          <span><b>${esc(row.resort.name)}</b><br><span class="detail-line">${bits.join(" · ")}</span></span>
          <span class="meter-line"><i style="width:${row.best.score}%"></i></span>
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
      // The page may have reflowed since the map was created; re-measure once.
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
  function filteredRows() {
    const q = state.search.trim().toLowerCase();
    let rows = state.rows.filter((r) => {
      if (state.region === "★") return state.favorites.has(r.resort.id);
      return state.region === "All" || r.resort.state === state.region;
    });
    if (q) rows = rows.filter((r) => `${r.resort.name} ${r.resort.region} ${r.resort.state}`.toLowerCase().includes(q));
    if (state.sort === "3d") rows.sort((a, b) => b.total3 - a.total3);
    else if (state.sort === "7d") rows.sort((a, b) => b.total7 - a.total7);
    else if (state.sort === "powder") rows.sort((a, b) => b.best.score - a.best.score || b.total3 - a.total3);
    else rows.sort((a, b) => a.resort.name.localeCompare(b.resort.name));
    // Favorites float to the top.
    rows.sort((a, b) => state.favorites.has(b.resort.id) - state.favorites.has(a.resort.id));
    return rows;
  }

  function favButton(id, cls = "fav") {
    const on = state.favorites.has(id);
    return `<button class="${cls}" data-fav="${id}" aria-pressed="${on}" aria-label="${on ? "Remove from" : "Add to"} my mountains">${Icon(on ? "starFill" : "star")}</button>`;
  }

  function flags(row) {
    const f = [];
    if (row.best.score >= 40) f.push(`<span class="f-powder">Pwdr ${dayShort(row.days[row.best.k].date)}</span>`);
    if (row.days.some((d) => d.quality && d.quality.key === "blower" && d.snow >= 2)) f.push(`<span class="f-powder">Blower</span>`);
    if (row.rainDay) f.push(`<span class="f-rain">Rain ${dayShort(row.rainDay.date)}</span>`);
    if (row.windDay) f.push(`<span class="f-wind">Wind ${dayShort(row.windDay.date)}</span>`);
    if (row.snowmaking >= 2 && row.total7 < 2) f.push(`<span class="f-cold">Snowmaking</span>`);
    return f.join("");
  }

  // Bars share one scale across resorts so they can be compared at a glance.
  function spark(row) {
    const peak = Math.max(...row.days.map((d) => d.snow));
    return `<div class="spark" role="img" aria-label="Daily snow: ${row.days.map((d) => `${dayShort(d.date)} ${snowTxt(d.snow)}`).join(", ")}">${row.days
      .map((d) => {
        if (d.snow < 0.5 && d.mix > 0.1) return `<i class="rain" style="height:${Math.min(30, 8 + d.mix * 40)}%" title="${dayShort(d.date)}: rain"></i>`;
        const h = d.snow < 0.5 ? 0 : Math.max(4, (d.snow / state.sparkMax) * 100);
        const cls = [d.snow >= 0.5 && d.snow === peak ? "peak" : "", d.mix > 0.1 && d.snow >= 0.5 ? "mixed" : ""].join(" ").trim();
        return `<i class="${cls}" style="height:${h}%" title="${dayShort(d.date)}: ${snowTxt(d.snow)}"></i>`;
      })
      .join("")}</div>`;
  }

  function renderRowsView(rows) {
    return `<div class="rows-head label"><span>Resort</span><span class="r-num">7d</span><span class="day-axis">${state.dates.map((d) => `<span>${dayInitial(d)}</span>`).join("")}</span><span></span></div>
      ${rows
        .map(
          (row) => `<div class="row" data-open="${row.resort.id}" tabindex="0">
          <div class="r-name"><b>${esc(row.resort.name)}</b><small>${esc(row.resort.region)} · ${elevTxt(row.resort.summit)}</small></div>
          <div class="r-num"><b>${snowVal(row.total7)}</b><small>${rangeVal(row.lo7, row.hi7)}</small></div>
          <div>${spark(row)}<div class="flags">${flags(row)}</div></div>
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
              (d) => `<td class="cell" data-conf="${d.confidence}" style="--c:${d.snow >= 0.5 ? snowColor(d.snow) : "transparent"}">
              <span class="amt">${d.snow >= 0.5 ? snowVal(d.snow) : "–"}</span>
              ${d.hi >= 1 ? `<span class="range">${rangeVal(d.lo, d.hi)}</span>` : ""}
              ${d.mix > 0.1 ? `<span class="rain-mark">RAIN</span>` : ""}</td>`
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
        legend: { position: "bottom", align: "start", labels: { color: muted, boxWidth: 14, boxHeight: 2, padding: 14, font: mono } },
        tooltip: {
          backgroundColor: "#0b0d10",
          cornerRadius: 0,
          titleFont: { family: "Geist Mono", size: 11 },
          bodyFont: { family: "Geist Mono", size: 11 },
          callbacks: {
            title: (items) => {
              const t = times[items[0].dataIndex];
              return `${dayShort(t.slice(0, 10))} ${t.slice(11, 13)}:00`;
            },
          },
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

  function drawCharts(row, baseHc) {
    if (!window.Chart) return;
    destroyCharts();
    const times = row.hc.time;
    const fg = css("--fg");
    const accent = css("--accent");
    const warn = css("--warn");

    // Snow accumulation: each model's running total plus the consensus.
    let run = 0;
    const consensusCum = row.hc.snow.map((s) => (run += s));
    const snowDs = state.summit.map((m, k) => ({
      label: m.model.label,
      data: row.hc.cumulative[k].map((v) => (v == null ? null : +snowNum(v).toFixed(1))),
      borderColor: m.model.color,
      backgroundColor: m.model.color,
      borderWidth: 1.25,
      pointRadius: 0,
      tension: 0.2,
    }));
    snowDs.push({ label: "Upslope", data: consensusCum.map((v) => +snowNum(v).toFixed(1)), borderColor: fg, backgroundColor: fg, borderWidth: 2.5, pointRadius: 0, tension: 0.2 });
    state.charts.push(new Chart($("#chart-snow"), { type: "line", data: { labels: times, datasets: snowDs }, options: chartOptions(times, snowUnit()) }));

    // Temperature at summit and base, with the freezing line.
    const freeze = metric() ? 0 : 32;
    const temps = (arr) => arr.map((t) => (t == null ? null : +tempNum(t).toFixed(1)));
    const tempDs = [
      { label: "Summit", data: temps(row.hc.temp), borderColor: accent, backgroundColor: accent, borderWidth: 1.75, pointRadius: 0, tension: 0.2 },
      { label: "Freezing", data: times.map(() => freeze), borderColor: warn, backgroundColor: warn, borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
    ];
    if (baseHc) tempDs.splice(1, 0, { label: "Base", data: temps(baseHc.temp), borderColor: fg, backgroundColor: fg, borderWidth: 1.25, pointRadius: 0, tension: 0.2 });
    const o2 = chartOptions(times, metric() ? "°C" : "°F");
    o2.scales.y.beginAtZero = false;
    state.charts.push(new Chart($("#chart-temp"), { type: "line", data: { labels: times, datasets: tempDs }, options: o2 }));

    // Summit gusts against the lift-hold line.
    const hold = +windNum(WIND_HOLD).toFixed(0);
    state.charts.push(
      new Chart($("#chart-wind"), {
        type: "bar",
        data: {
          labels: times,
          datasets: [
            { type: "line", label: "Wind hold", data: times.map(() => hold), borderColor: warn, backgroundColor: warn, borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
            { label: "Summit gusts", data: row.hc.gust.map((g) => (g == null ? null : +windNum(g).toFixed(0))), backgroundColor: row.hc.gust.map((g) => (g >= WIND_HOLD ? warn : "#a9c1ee")), barPercentage: 1, categoryPercentage: 1 },
          ],
        },
        options: chartOptions(times, metric() ? "km/h" : "mph"),
      })
    );
  }

  const QUALITY_KEYS = ["wet", "packing", "powder", "blower"];
  const QUALITY_SHORT = { wet: "Wet", packing: "Dense", powder: "Powder", blower: "Blower" };

  function qualityBlock(q, ratio) {
    if (!q) return "";
    const idx = QUALITY_KEYS.indexOf(q.key);
    return `<section class="panel">
      <div class="block-head"><h3>Snow quality</h3><span class="label">SLR ${Math.round(ratio)}:1</span></div>
      <p class="hint"><strong style="color:var(--fg)">${q.label}.</strong> About ${Math.round(ratio)} inches of snow for every inch of water.</p>
      <div class="scale">${QUALITY_KEYS.map((k, i) => `<span class="${i <= idx ? "on" : ""}"></span>`).join("")}</div>
      <div class="scale-labels label">${QUALITY_KEYS.map((k) => `<span>${QUALITY_SHORT[k]}</span>`).join("")}</div>
    </section>`;
  }

  async function openDetail(id) {
    const row = state.rows.find((r) => r.resort.id === id);
    if (!row) return;
    const r = row.resort;
    state.selected = id;
    const dlg = $("#detail");
    const days = row.days;
    const peakGust = Math.max(...days.map((d) => d.gustMax ?? 0));
    const snowy = days.filter((d) => d.quality);
    const ratio = snowy.length ? median(snowy.map((d) => d.ratio)) : null;
    const q = ratio ? F.quality(ratio) : null;
    $("#detail-body").innerHTML = `
      <header class="detail-head">
        <span class="label">${esc(r.region)} · ${r.state}</span>
        <div class="detail-actions">${favButton(id, "sq fav")}<button class="sq" data-close aria-label="Close">${Icon("close")}</button></div>
      </header>
      <div class="d-body">
        <div class="d-title"><h2>${esc(r.name)}</h2><p class="mono">SUMMIT ${elevTxt(r.summit).toUpperCase()} · BASE ${elevTxt(r.base).toUpperCase()}</p></div>
        <p class="summary">${esc(describe(row))}</p>
        <div class="d-kpis">
          <div><span class="label">Snow · 7d</span><b>${snowTxt(row.total7)}</b><span>${rangeTxt(row.lo7, row.hi7)} range</span></div>
          <div><span class="label">Powder score</span><b>${row.best.score || "–"}</b><span>${row.best.score ? `${dayShort(days[row.best.k].date)} morning` : "Next 3 days"}</span></div>
          <div><span class="label">Snow quality</span><b>${q ? QUALITY_SHORT[q.key] : "–"}</b><span>${q ? `SLR ${Math.round(ratio)}:1` : "No snow"}</span></div>
          <div><span class="label">Peak gust</span><b>${Math.round(windNum(peakGust))}</b><span>${metric() ? "km/h" : "mph"} at summit</span></div>
        </div>
        <div class="days">${days
          .map((d) => {
            const ic = dayIcon(d);
            const flag =
              d.gustMax >= WIND_HOLD
                ? `<span class="day-flag wind">Wind ${Math.round(windNum(d.gustMax))}</span>`
                : d.mix > 0.1
                  ? `<span class="day-flag rain">Rain</span>`
                  : `<span class="day-flag conf-${d.confidence}">${d.confidence === "high" ? "Sure" : d.confidence === "medium" ? "Likely" : "Unsure"}</span>`;
            return `<div class="day${d.snow >= 0.5 ? " snowy" : ""}" style="--c:${snowColor(d.snow)}">
              <span class="label">${dayShort(d.date)}</span>
              <span title="${ic.label}">${Icon(ic.icon)}</span>
              <span class="day-snow">${d.snow >= 0.5 ? snowTxt(d.snow) : "–"}</span>
              <span class="day-range">${d.hi >= 1 ? rangeTxt(d.lo, d.hi) : "&nbsp;"}</span>
              <span class="day-temp"><b>${tempTxt(d.tMax)}</b> / ${tempTxt(d.tMin)}</span>
              ${flag}
            </div>`;
          })
          .join("")}</div>
        <section class="panel">
          <div class="block-head"><h3>Snow accumulation, summit</h3><span class="label">${snowUnit()} · running total</span></div>
          <p class="hint">Each thin line is one weather model. The black line is the Upslope forecast, the middle of the pack. The wider the lines spread, the less certain the forecast.</p>
          <div class="chart"><canvas id="chart-snow"></canvas></div>
        </section>
        ${qualityBlock(q, ratio)}
        <section class="panel">
          <div class="block-head"><h3>Temperature, summit vs base</h3><span class="label">${metric() ? "°C" : "°F"} · hourly</span></div>
          <p class="hint">Above the dashed freezing line, snow turns to rain or melts. Base above and summit below means snow up top and slush at the bottom.</p>
          <div class="chart"><canvas id="chart-temp"></canvas></div>
        </section>
        <section class="panel">
          <div class="block-head"><h3>Wind gusts, summit</h3><span class="label">${metric() ? "km/h" : "mph"} · hourly</span></div>
          <p class="hint">Gusts above ${windTxt(WIND_HOLD)} often close upper lifts.</p>
          <div class="chart short"><canvas id="chart-wind"></canvas></div>
        </section>
        <section class="panel">
          <div class="block-head"><h3>Model by model</h3><span class="label">Summit snow · ${snowUnit()}</span></div>
          <div class="scroll"><table class="models">
            <thead><tr><th style="text-align:left;padding-left:0">Model</th>${state.dates.map((d) => `<th>${dayShort(d)}</th>`).join("")}<th>Total</th></tr></thead>
            <tbody>${state.summit
              .map((m) => {
                const loc = m.locs[row.index];
                const vals = state.dates.map((d) => loc.days[d]?.snow ?? 0);
                return `<tr><th scope="row"><span class="swatch" style="background:${m.model.color}"></span>${esc(m.model.label)}</th>${vals
                  .map((v) => `<td style="--c:${v >= 0.5 ? snowColor(v) : "transparent"}">${v >= 0.5 ? snowVal(v) : "–"}</td>`)
                  .join("")}<td class="strong">${snowVal(sum(vals))}</td></tr>`;
              })
              .join("")}</tbody>
          </table></div>
        </section>
      </div>`;
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    history.replaceState(null, "", `#${id}`);

    drawCharts(row, null);
    const base = await loadAll([r], [r.base]);
    if (state.selected !== id || !base.length) return;
    drawCharts(row, hourly(base.map((m) => m.locs[0])));
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
    state.summit = await loadAll(RESORTS, RESORTS.map((r) => r.summit));
    if (!state.summit.length) {
      $("#status").textContent = "Forecast service unreachable · retry in a few minutes";
      $("#headline").innerHTML = `<h1>Forecast unavailable.</h1><p>The weather service didn't respond. Refresh in a few minutes.</p>`;
      return;
    }
    buildRows();
    const now = new Date();
    $("#asof").textContent = `${now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" })} · ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" })} ET`;
    $("#status").textContent = `${state.summit.length} of ${MODELS.length} models · ${state.summit.map((m) => m.model.label).join(" · ")}`;
    renderAll();
    const hash = location.hash.slice(1);
    if (hash && RESORTS.some((r) => r.id === hash)) openDetail(hash);
  }

  init();
})();
