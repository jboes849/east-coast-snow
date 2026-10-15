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
    region: store.get("ecs-region", "All"),
    search: "",
    sort: "7d",
    view: store.get("ecs-view", "cards"),
    units: store.get("ecs-units", "in"),
    favorites: new Set(store.get("ecs-favs", [])),
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
  function snowTxt(inches, unit = true) {
    const v = snowNum(inches);
    const min = metric() ? 1 : 0.5;
    let s;
    if (v < min) s = "0";
    else if (v < 10) s = v.toFixed(metric() ? 0 : 1).replace(/\.0$/, "");
    else s = String(Math.round(v));
    return unit ? s + (metric() ? " cm" : "″") : s;
  }
  const rangeTxt = (lo, hi) => `${snowTxt(lo, false)}–${snowTxt(hi)}`;
  const tempTxt = (f) => (f == null ? "–" : metric() ? `${Math.round((f - 32) * 5 / 9)}°` : `${Math.round(f)}°`);
  const tempNum = (f) => (f == null ? null : metric() ? (f - 32) * 5 / 9 : f);
  const windTxt = (mph) => (mph == null ? "–" : metric() ? `${Math.round(mph * 1.609)} km/h` : `${Math.round(mph)} mph`);
  const windNum = (mph) => (mph == null ? null : metric() ? mph * 1.609 : mph);
  const elevTxt = (ft) => (metric() ? `${Math.round(ft * 0.3048).toLocaleString()} m` : `${Math.round(ft).toLocaleString()} ft`);
  const WIND_HOLD = 45;

  // ---------- dates ----------
  const today = () => state.dates[0];
  const dateObj = (date) => new Date(date + "T12:00:00");
  function dayShort(date) {
    if (date === state.dates[0]) return "Today";
    return dateObj(date).toLocaleDateString("en-US", { weekday: "short" });
  }
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
    if (date === today()) {
      if (h < 12) return "this morning";
      if (h < 17) return "this afternoon";
      return "tonight";
    }
    if (h < 6) return d === "tomorrow" ? "early tomorrow" : `early ${d}`;
    if (h < 12) return `${d} morning`;
    if (h < 17) return `${d} afternoon`;
    return d === "tomorrow" ? "tomorrow night" : `${d} night`;
  }

  // ---------- colors ----------
  const SNOW_STEPS = [0.5, 3, 6, 12, 18];
  const snowLevel = (x) => SNOW_STEPS.filter((s) => x >= s).length;
  const SNOW_COLORS = ["#cbd5e1", "#bfdbfe", "#60a5fa", "#2563eb", "#7c3aed", "#db2777"];
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

  // ---------- data shaping ----------
  function buildRows() {
    state.rows = RESORTS.map((r, i) => {
      const perModel = state.summit.map((m) => m.locs[i]).filter(Boolean);
      const days = consensus(perModel, state.dates);
      const hc = hourly(perModel);
      const best = [1, 2, 3].map((k) => ({ k, score: powderScore(days[k]) })).sort((a, b) => b.score - a.score)[0];
      return {
        resort: r,
        index: i,
        perModel,
        days,
        hc,
        storms: storms(hc, perModel),
        total3: sum(days.slice(0, 3).map((d) => d.snow)),
        total7: sum(days.map((d) => d.snow)),
        lo7: Math.min(...perModel.map((m) => sum(state.dates.map((d) => m.days[d]?.snow ?? 0)))),
        hi7: Math.max(...perModel.map((m) => sum(state.dates.map((d) => m.days[d]?.snow ?? 0)))),
        best,
        rainDay: days.find((d) => d.mix > 0.1),
        windDay: days.find((d) => d.gustMax >= WIND_HOLD),
        snowmaking: days.slice(0, 3).filter((d) => d.coldHours >= 6).length,
      };
    });
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
      if (others.length) out.push(`${others.length === 1 ? "Another round" : "More rounds"} adds ${snowTxt(sum(others.map((s) => s.total)))} later in the week.`);
    }
    if (row.rainDay) {
      const summitMix = row.rainDay.tMax != null && row.rainDay.tMax > 34;
      out.push(`Rain or ice is likely ${dayLong(row.rainDay.date)}${summitMix ? ", even at the summit" : ", mainly lower down"}.`);
    }
    if (row.windDay) out.push(`Gusts near ${windTxt(row.windDay.gustMax)} ${dayLong(row.windDay.date)} could put upper lifts on wind hold.`);
    if (row.best.score >= 40) out.push(`Best powder morning: ${dayLong(row.days[row.best.k].date)} (score ${row.best.score}).`);
    return out.join(" ");
  }

  // Region-level headline for the hero.
  function headline() {
    const byRegion = {};
    state.rows.forEach((r) => (byRegion[r.resort.region] ||= []).push(r));
    const regions = Object.entries(byRegion)
      .map(([name, rows]) => ({ name, top: [...rows].sort((a, b) => b.total7 - a.total7)[0], avg: sum(rows.map((r) => r.total7)) / rows.length }))
      .sort((a, b) => b.top.total7 - a.top.total7);
    const lead = regions[0];
    if (!lead || lead.top.total7 < 1) {
      const cold = state.rows.filter((r) => r.snowmaking >= 2).length;
      return {
        title: "A quiet week across the East",
        text: `No meaningful natural snow in the next 7 days.${cold ? ` Cold nights mean good snowmaking weather at ${cold} of ${state.rows.length} resorts.` : ""}`,
      };
    }
    const big = [...lead.top.storms].sort((a, b) => b.total - a.total)[0];
    const when = big ? ` ${whenTxt(big.startTime).replace(/^./, (c) => c.toUpperCase())} brings the main round.` : "";
    const quiet = regions.filter((r) => r.top.total7 < 2).map((r) => r.name);
    const second = regions[1] && regions[1].top.total7 >= 2 ? ` ${regions[1].name} follows with up to ${snowTxt(regions[1].top.total7)} at ${regions[1].top.resort.name}.` : "";
    return {
      title: `${lead.name} leads the week`,
      text: `Up to ${snowTxt(lead.top.total7)} at ${lead.top.resort.name} over the next 7 days (models range ${rangeTxt(lead.top.lo7, lead.top.hi7)}).${when}${second}${quiet.length && quiet.length < regions.length ? ` Little to nothing for ${listTxt(quiet.slice(0, 3))}.` : ""}`,
    };
  }
  const listTxt = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

  // ---------- hero ----------
  function renderHero() {
    const h = headline();
    $("#headline").innerHTML = `<h2>${esc(h.title)}</h2><p>${esc(h.text)}</p>`;
    const biggest = [...state.rows].sort((a, b) => b.total7 - a.total7)[0];
    const powder = [...state.rows].sort((a, b) => b.best.score - a.best.score || b.total3 - a.total3)[0];
    const coldest = [...state.rows].sort((a, b) => (a.days[1].tMin ?? 99) - (b.days[1].tMin ?? 99))[0];
    const stats = [
      { icon: "heavySnow", label: "Most snow, 7 days", value: snowTxt(biggest.total7), sub: biggest.resort.name, id: biggest.resort.id },
      powder.best.score > 0
        ? { icon: "flake", label: "Best powder morning", value: `${powder.best.score}`, sub: `${powder.resort.name}, ${dayShort(powder.days[powder.best.k].date)}`, id: powder.resort.id }
        : { icon: "flake", label: "Best powder morning", value: "–", sub: "None in the next 3 days" },
      { icon: "thermo", label: "Coldest summit tomorrow", value: tempTxt(coldest.days[1].tMin), sub: coldest.resort.name, id: coldest.resort.id },
    ];
    $("#stats").innerHTML = stats
      .map((s) => `<button class="stat" ${s.id ? `data-open="${s.id}"` : "disabled"}>${Icon(s.icon)}<span class="stat-label">${s.label}</span><span class="stat-value">${s.value}</span><span class="stat-sub">${esc(s.sub)}</span></button>`)
      .join("");
  }

  // ---------- powder picks ----------
  function gauge(score) {
    const r = 22;
    const c = 2 * Math.PI * r;
    const color = score >= 75 ? "#7c3aed" : score >= 50 ? "#2563eb" : score >= 25 ? "#60a5fa" : "#94a3b8";
    return `<svg class="gauge" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="${r}" class="gauge-track"/><circle cx="28" cy="28" r="${r}" stroke="${color}" stroke-dasharray="${(score / 100) * c} ${c}" transform="rotate(-90 28 28)" class="gauge-fill"/></svg><span class="gauge-num">${score}</span>`;
  }

  function renderPicks() {
    const top = state.rows.filter((r) => r.best.score > 0).sort((a, b) => b.best.score - a.best.score || b.total3 - a.total3).slice(0, 4);
    const el = $("#picks");
    if (!top.length) {
      el.innerHTML = `<div class="empty">${Icon("sun")}<p>No powder mornings in the next three days. Good time for groomers and spring-like turns.</p></div>`;
      return;
    }
    el.innerHTML = top
      .map((row) => {
        const d = row.days[row.best.k];
        return `<button class="pick" data-open="${row.resort.id}">
          <span class="gauge-wrap">${gauge(row.best.score)}</span>
          <span class="pick-body">
            <strong>${esc(row.resort.name)}</strong>
            <span>${dayShort(d.date)} morning</span>
            <span class="pick-amt">${snowTxt(d.overnight)} overnight${d.quality ? ` · ${d.quality.label}` : ""}</span>
          </span>
        </button>`;
      })
      .join("");
  }

  // ---------- map ----------
  let map, markerLayer, radarLayer, baseLayer;
  function initMap() {
    if (!window.L) {
      $("#map").innerHTML = `<p class="map-fallback">Map unavailable.</p>`;
      return;
    }
    map = L.map("map", { scrollWheelZoom: false, zoomSnap: 0.25, zoomControl: true, attributionControl: true });
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    baseLayer = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png`, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 12,
    }).addTo(map);
    radarLayer = L.tileLayer("https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png", {
      opacity: 0.55,
      attribution: 'Radar: <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a>',
    });
    markerLayer = L.layerGroup().addTo(map);
    map.fitBounds(L.latLngBounds(RESORTS.map((r) => [r.lat, r.lon])).pad(0.08));
  }

  let mapFitted = false;
  function renderMap() {
    if (!map) return;
    if (!mapFitted) {
      // The hero may have reflowed since the map was created; re-measure once.
      map.invalidateSize();
      map.fitBounds(L.latLngBounds(RESORTS.map((r) => [r.lat, r.lon])).pad(0.08));
      mapFitted = true;
    }
    markerLayer.clearLayers();
    state.rows.forEach((row) => {
      const v = state.mapRange === "3" ? row.total3 : row.total7;
      const lvl = snowLevel(v);
      const icon = L.divIcon({
        className: "pin-wrap",
        html: `<span class="pin" data-level="${lvl}" style="--c:${snowColor(v)}">${snowTxt(v, false)}</span>`,
        iconSize: [36, 24],
        iconAnchor: [18, 12],
      });
      L.marker([row.resort.lat, row.resort.lon], { icon, title: row.resort.name, riseOnHover: true, zIndexOffset: Math.round(v * 10) })
        .bindTooltip(`<strong>${esc(row.resort.name)}</strong><br>${snowTxt(v)} in ${state.mapRange} days`, { direction: "top", offset: [0, -10] })
        .on("click", () => openDetail(row.resort.id))
        .addTo(markerLayer);
    });
    $("#map-legend").innerHTML = SNOW_COLORS.map((c, i) => {
      const lo = i === 0 ? 0 : SNOW_STEPS[i - 1];
      const label = i === 0 ? "0" : i === SNOW_COLORS.length - 1 ? `${snowTxt(lo, false)}+` : `${snowTxt(lo, false)}–${snowTxt(SNOW_STEPS[i], false)}`;
      return `<span><i style="background:${c}"></i>${label}</span>`;
    }).join("") + `<span class="unit">${metric() ? "cm" : "inches"}</span>`;
  }

  // ---------- resort list ----------
  function filteredRows() {
    const q = state.search.trim().toLowerCase();
    let rows = state.rows.filter((r) => {
      if (state.region === "★") return state.favorites.has(r.resort.id);
      if (state.region !== "All" && r.resort.state !== state.region) return false;
      return true;
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

  function favButton(id) {
    const on = state.favorites.has(id);
    return `<button class="fav" data-fav="${id}" aria-pressed="${on}" aria-label="${on ? "Remove from" : "Add to"} my mountains">${Icon(on ? "starFill" : "star")}</button>`;
  }

  function badges(row) {
    const b = [];
    if (row.best.score >= 40) b.push(`<span class="badge powder">${Icon("flake")}Powder ${dayShort(row.days[row.best.k].date)}</span>`);
    const q = row.days.find((d) => d.quality && d.snow >= 2);
    if (q && q.quality.key === "blower") b.push(`<span class="badge powder">${Icon("flake")}Blower</span>`);
    if (row.rainDay) b.push(`<span class="badge rain">${Icon("rain")}Rain ${dayShort(row.rainDay.date)}</span>`);
    if (row.windDay) b.push(`<span class="badge wind">${Icon("wind")}Wind ${dayShort(row.windDay.date)}</span>`);
    if (row.snowmaking >= 2 && row.total7 < 2) b.push(`<span class="badge cold">${Icon("gun")}Snowmaking</span>`);
    return b.join("");
  }

  function miniBars(row) {
    const max = Math.max(6, ...row.days.map((d) => d.hi));
    return `<div class="mini" role="img" aria-label="Daily snow: ${row.days.map((d) => `${dayShort(d.date)} ${snowTxt(d.snow)}`).join(", ")}">${row.days
      .map((d) => {
        const h = Math.max(3, (d.snow / max) * 100);
        const rangeH = (d.hi / max) * 100;
        return `<div class="mini-col${d.mix > 0.1 ? " has-mix" : ""}">
          <span class="mini-val">${d.snow >= 0.5 ? snowTxt(d.snow, false) : ""}</span>
          <span class="mini-track"><span class="mini-range" style="height:${rangeH}%"></span><span class="mini-bar" style="height:${h}%;background:${d.snow >= 0.5 ? snowColor(d.snow) : "var(--muted-bar)"}"></span></span>
          <span class="mini-day">${dayShort(d.date).slice(0, 2)}</span>
        </div>`;
      })
      .join("")}</div>`;
  }

  function renderCards(rows) {
    return `<div class="cards">${rows
      .map(
        (row) => `<article class="card" data-open="${row.resort.id}" tabindex="0">
        <header>
          <div><h3>${esc(row.resort.name)}</h3><p>${esc(row.resort.region)} · ${elevTxt(row.resort.summit)}</p></div>
          ${favButton(row.resort.id)}
        </header>
        <div class="card-total">
          <span class="big" style="--c:${snowColor(row.total7)}">${snowTxt(row.total7)}</span>
          <span class="card-total-sub">next 7 days<br><span class="muted">${rangeTxt(row.lo7, row.hi7)} across models</span></span>
        </div>
        ${miniBars(row)}
        <div class="badges">${badges(row)}</div>
      </article>`
      )
      .join("")}</div>`;
  }

  function renderTable(rows) {
    return `<div class="scroll"><table class="grid">
      <thead><tr><th class="resort-col">Resort</th><th>7 day</th>${state.dates.map((d) => `<th>${dayShort(d)}<span class="sub">${dayNum(d)}</span></th>`).join("")}</tr></thead>
      <tbody>${rows
        .map(
          (row) => `<tr data-open="${row.resort.id}" tabindex="0">
          <th class="resort-col" scope="row"><span class="name">${state.favorites.has(row.resort.id) ? `<span class="star-mark">${Icon("starFill")}</span>` : ""}${esc(row.resort.name)}</span><span class="sub">${row.resort.state} · ${elevTxt(row.resort.summit)}</span></th>
          <td class="total"><span class="dot" style="background:${snowColor(row.total7)}"></span>${snowTxt(row.total7)}</td>
          ${row.days
            .map((d) => {
              const ic = dayIcon(d);
              return `<td class="cell" data-conf="${d.confidence}" style="--c:${d.snow >= 0.5 ? snowColor(d.snow) : "transparent"}" data-level="${snowLevel(d.snow)}">
              <span class="cell-icon" title="${ic.label}">${Icon(ic.icon)}</span>
              <span class="amt">${d.snow >= 0.5 ? snowTxt(d.snow) : "–"}</span>
              ${d.hi >= 1 ? `<span class="range">${rangeTxt(d.lo, d.hi)}</span>` : ""}</td>`;
            })
            .join("")}</tr>`
        )
        .join("")}</tbody></table></div>`;
  }

  function renderList() {
    const rows = filteredRows();
    const el = $("#list");
    if (!rows.length) {
      el.innerHTML = `<div class="empty">${Icon(state.region === "★" ? "star" : "search")}<p>${state.region === "★" ? "Tap the star on any resort to add it to My mountains." : "No resorts match."}</p></div>`;
      return;
    }
    el.innerHTML = state.view === "cards" ? renderCards(rows) : renderTable(rows);
  }

  function renderFilters() {
    const states = ["All", "★", ...new Set(RESORTS.map((r) => r.state))];
    $("#filters").innerHTML = states
      .map((s) => `<button class="chip" aria-pressed="${s === state.region}" data-region="${s}">${s === "★" ? `${Icon("starFill")}My mountains` : s}</button>`)
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

  function chartTheme() {
    return { text: css("--muted"), grid: css("--border"), strong: css("--text"), accent: css("--accent"), warn: css("--warn") };
  }

  function dayTicks(times) {
    // Label only midnight hours with the day name.
    return (value, i) => {
      const t = times[i];
      return t && t.slice(11, 13) === "12" ? dayShort(t.slice(0, 10)) : "";
    };
  }

  function baseChartOptions(times, yTitle, th) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: th.text, boxWidth: 12, boxHeight: 2, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            title: (items) => {
              const t = times[items[0].dataIndex];
              return `${dayShort(t.slice(0, 10))} ${Number(t.slice(11, 13)) % 12 || 12}${Number(t.slice(11, 13)) < 12 ? "am" : "pm"}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: th.text, autoSkip: false, maxRotation: 0, callback: dayTicks(times) }, grid: { color: (c) => (times[c.index]?.slice(11, 13) === "00" ? th.grid : "transparent") } },
        y: { beginAtZero: true, title: { display: true, text: yTitle, color: th.text }, ticks: { color: th.text }, grid: { color: th.grid } },
      },
    };
  }

  function drawCharts(row, baseHc) {
    if (!window.Chart) return;
    destroyCharts();
    const th = chartTheme();
    const times = row.hc.time;
    const labels = times.map((t) => t);

    // 1. Snow piling up: every model's running total plus the consensus.
    let run = 0;
    const consensusCum = row.hc.snow.map((s) => (run += s));
    const snowDs = state.summit.map((m, k) => ({
      label: m.model.label,
      data: row.hc.cumulative[k].map((v) => (v == null ? null : snowNum(v))),
      borderColor: m.model.color,
      backgroundColor: m.model.color,
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.3,
    }));
    snowDs.push({ label: "Our forecast", data: consensusCum.map(snowNum), borderColor: th.strong, backgroundColor: "rgba(96,165,250,0.18)", fill: "origin", borderWidth: 3, pointRadius: 0, tension: 0.3 });
    const o1 = baseChartOptions(times, metric() ? "cm" : "inches", th);
    state.charts.push(new Chart($("#chart-snow"), { type: "line", data: { labels, datasets: snowDs }, options: o1 }));

    // 2. Temperature at summit and base, with the freezing line.
    const freeze = metric() ? 0 : 32;
    const tempDs = [
      { label: "Summit", data: row.hc.temp.map(tempNum), borderColor: th.accent, backgroundColor: th.accent, borderWidth: 2, pointRadius: 0, tension: 0.3 },
      { label: "Freezing", data: times.map(() => freeze), borderColor: th.warn, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 },
    ];
    if (baseHc) tempDs.splice(1, 0, { label: "Base", data: baseHc.temp.map(tempNum), borderColor: "#f97316", backgroundColor: "#f97316", borderWidth: 2, pointRadius: 0, tension: 0.3 });
    const o2 = baseChartOptions(times, metric() ? "°C" : "°F", th);
    o2.scales.y.beginAtZero = false;
    state.charts.push(new Chart($("#chart-temp"), { type: "line", data: { labels, datasets: tempDs }, options: o2 }));

    // 3. Summit wind gusts with the lift-hold line.
    const hold = windNum(WIND_HOLD);
    const o3 = baseChartOptions(times, metric() ? "km/h" : "mph", th);
    state.charts.push(
      new Chart($("#chart-wind"), {
        type: "bar",
        data: {
          labels,
          datasets: [
            { type: "line", label: "Wind hold risk", data: times.map(() => hold), borderColor: th.warn, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 },
            { label: "Summit gusts", data: row.hc.gust.map(windNum), backgroundColor: row.hc.gust.map((g) => (g >= WIND_HOLD ? th.warn : "rgba(96,165,250,0.6)")), barPercentage: 1, categoryPercentage: 1 },
          ],
        },
        options: o3,
      })
    );
  }

  function qualityMeter(row) {
    const snowy = row.days.filter((d) => d.quality);
    if (!snowy.length) return "";
    const ratio = median(snowy.map((d) => d.ratio));
    const q = F.quality(ratio);
    const pos = Math.max(0, Math.min(100, ((ratio - 5) / 15) * 100));
    return `<section class="panel">
      <h3>${Icon("flake")}Snow quality</h3>
      <p class="quality-label"><strong>${q.label}</strong> · about ${Math.round(ratio)} inches of snow per inch of water</p>
      <div class="meter"><span class="meter-dot" style="left:${pos}%"></span></div>
      <div class="meter-labels"><span>Heavy, wet</span><span>Dense</span><span>Powder</span><span>Blower</span></div>
    </section>`;
  }

  async function openDetail(id) {
    const row = state.rows.find((r) => r.resort.id === id);
    if (!row) return;
    const r = row.resort;
    state.selected = id;
    const dlg = $("#detail");
    const days = row.days;
    $("#detail-body").innerHTML = `
      <header class="detail-head">
        <div>
          <p class="eyebrow">${esc(r.region)}, ${r.state}</p>
          <h2>${esc(r.name)}</h2>
          <p class="muted">${Icon("mountain")}Summit ${elevTxt(r.summit)} · Base ${elevTxt(r.base)}</p>
        </div>
        <div class="detail-actions">${favButton(id)}<button class="icon-btn" data-close aria-label="Close">${Icon("close")}</button></div>
      </header>
      <p class="summary">${esc(describe(row))}</p>
      <div class="daystrip">${days
        .map((d) => {
          const ic = dayIcon(d);
          return `<div class="daytile${d.snow >= 0.5 ? " snowy" : ""}" style="--c:${snowColor(d.snow)}">
            <span class="dt-day">${dayShort(d.date)}</span>
            <span class="dt-icon" title="${ic.label}">${Icon(ic.icon)}</span>
            <span class="dt-snow">${d.snow >= 0.5 ? snowTxt(d.snow) : "–"}</span>
            <span class="dt-range">${d.hi >= 1 ? rangeTxt(d.lo, d.hi) : "&nbsp;"}</span>
            <span class="dt-temp">${tempTxt(d.tMax)} <span class="muted">${tempTxt(d.tMin)}</span></span>
            ${d.gustMax >= WIND_HOLD ? `<span class="dt-flag wind">${Icon("wind")}${windTxt(d.gustMax)}</span>` : d.mix > 0.1 ? `<span class="dt-flag rain">${Icon("rain")}Rain</span>` : `<span class="dt-flag conf-${d.confidence}">${d.confidence === "high" ? "Sure" : d.confidence === "medium" ? "Likely" : "Unsure"}</span>`}
          </div>`;
        })
        .join("")}</div>
      <section class="panel">
        <h3>${Icon("heavySnow")}Snow piling up at the summit</h3>
        <p class="hint">Each thin line is one weather model. The thick line is our forecast, the middle of the pack. Lines spread apart means less certainty.</p>
        <div class="chart"><canvas id="chart-snow"></canvas></div>
      </section>
      ${qualityMeter(row)}
      <section class="panel">
        <h3>${Icon("thermo")}Temperature, summit vs base</h3>
        <p class="hint">Above the dashed freezing line, snow turns to rain or melts. When the base is above and the summit below, expect snow up top and slush at the bottom.</p>
        <div class="chart"><canvas id="chart-temp"></canvas></div>
      </section>
      <section class="panel">
        <h3>${Icon("wind")}Summit wind gusts</h3>
        <p class="hint">Gusts above ${windTxt(WIND_HOLD)} often close upper lifts.</p>
        <div class="chart short"><canvas id="chart-wind"></canvas></div>
      </section>
      <section class="panel">
        <h3>${Icon("layers")}Model by model</h3>
        <div class="scroll"><table class="models">
          <thead><tr><th>Model</th>${state.dates.map((d) => `<th>${dayShort(d)}</th>`).join("")}<th>Total</th></tr></thead>
          <tbody>${state.summit
            .map((m, k) => {
              const loc = m.locs[row.index];
              const vals = state.dates.map((d) => loc.days[d]?.snow ?? 0);
              return `<tr><th scope="row"><span class="swatch" style="background:${m.model.color}"></span>${esc(m.model.label)}</th>${vals
                .map((v) => `<td style="--c:${v >= 0.5 ? snowColor(v) : "transparent"}" data-level="${snowLevel(v)}">${v >= 0.5 ? snowTxt(v, false) : "–"}</td>`)
                .join("")}<td class="strong">${snowTxt(sum(vals))}</td></tr>`;
            })
            .join("")}</tbody>
        </table></div>
      </section>`;
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
    store.set("ecs-favs", [...state.favorites]);
    document.querySelectorAll(`[data-fav="${id}"]`).forEach((b) => (b.outerHTML = favButton(id)));
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
        store.set("ecs-region", state.region);
        renderFilters();
        return renderList();
      }
      const view = e.target.closest("[data-view]");
      if (view) {
        state.view = view.dataset.view;
        store.set("ecs-view", state.view);
        renderFilters();
        return renderList();
      }
      const units = e.target.closest("[data-units]");
      if (units) {
        state.units = units.dataset.units;
        store.set("ecs-units", state.units);
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
    renderFilters();
    bind();
    initMap();
    state.summit = await loadAll(RESORTS, RESORTS.map((r) => r.summit));
    if (!state.summit.length) {
      $("#status").textContent = "Couldn't reach the forecast service. Try again in a few minutes.";
      $("#headline").innerHTML = `<h2>Forecast unavailable</h2><p>The weather service didn't respond. Refresh in a few minutes.</p>`;
      return;
    }
    buildRows();
    document.body.classList.remove("loading");
    $("#status").textContent = `Updated ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · ${state.summit.length} of ${MODELS.length} weather models`;
    renderAll();
    const hash = location.hash.slice(1);
    if (hash && RESORTS.some((r) => r.id === hash)) openDetail(hash);
  }

  init();
})();
