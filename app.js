(function () {
  const RESORTS = window.RESORTS;
  const GUIDES = window.GUIDES || {};
  const SETUPS = window.SETUPS || {};
  const Icon = window.Icon;
  const DATA_URL = "data/forecast.json";
  // Set on generated resort pages (resorts/<id>/), which show one resort full-page.
  const PAGE = document.body.dataset.resort || null;
  const CONFIG = window.UPSLOPE_CONFIG || {};

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
          ? { label: "Best first chair", value: dayShort(powder.days[powder.best.k].date), sub: `${powder.resort.name} · powder score ${powder.best.score}`, id: powder.resort.id }
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
          const fq = QUALITY(d.slr);
          if (fq) bits.push(fq.label);
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
    head.innerHTML = `<h2>Snowmaking windows</h2><span class="label">Pre-season · hours cold enough for snow guns</span>`;
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
        const bits = [spanTxt(w.start, w.end), `as cold as ${tempTxtU(w.minTw)}`, w.baseHours >= 3 ? `base ${w.baseHours}h` : "base too warm"];
        return `<button class="pick" data-open="${w.row.resort.id}">
          <span class="score" data-tier="${w.good >= 6 ? 3 : 1}">${w.hours}h</span>
          <span><b>${esc(w.row.resort.name)}</b><br><span class="detail-line">${esc(bits.join(" · "))}</span></span>
          <span class="meter-line"><i style="width:${Math.round((w.hours / maxH) * 100)}%"></i></span>
        </button>`;
      })
      .join("");
  }

  // ---------- weekend outlook (in season) ----------
  function renderWeekend() {
    const el = $("#weekend-block");
    const wk = state.dates.map((d, k) => ({ d, k })).filter((x) => [0, 6].includes(dateObj(x.d).getDay()));
    const open = state.rows.filter(operating);
    if (!state.open || !wk.length || !open.length) {
      el.hidden = true;
      return;
    }
    const picks = open
      .map((row) => {
        const best = wk.map((x) => ({ ...x, day: row.days[x.k] })).sort((a, b) => b.day.grade.score - a.day.grade.score || b.day.overnight - a.day.overnight)[0];
        return { row, ...best };
      })
      .sort((a, b) => b.day.grade.score - a.day.grade.score || b.day.overnight - a.day.overnight)
      .slice(0, 3);
    el.hidden = false;
    el.innerHTML = `<div class="block-head"><h2>This weekend</h2><span class="label">Best bets · ${wk.map((x) => dayLong(x.d)).join(" and ")}</span></div>
      ${picks[0].day.grade.score < 58 ? `<p class="hint">A rough weekend across the East. These are the least bad options.</p>` : ""}
      <div class="weekend">${picks
        .map((p) => {
          const why = whyList(p.day.grade.why).slice(0, 2).join(", ") || "a solid day";
          return `<button class="wk" data-open="${p.row.resort.id}">
            <span class="grade g-${p.day.grade.letter}">${p.day.grade.letter}</span>
            <span><b>${esc(p.row.resort.name)}</b><span class="wk-day">${dayLong(p.d)}</span></span>
            <span class="wk-why">${fmt(cap(why))}.</span>
          </button>`;
        })
        .join("")}</div>`;
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
          <div class="r-name"><a class="r-link" href="resorts/${row.resort.id}/"><b>${esc(row.resort.name)}</b></a><small>${esc(row.resort.region)} · ${elevTxt(row.resort.summit)}</small></div>
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
          <th class="resort-col" scope="row"><a class="r-link name" href="resorts/${row.resort.id}/">${esc(row.resort.name)}</a><span class="sub">${row.resort.state} · ${elevTxt(row.resort.summit)}</span></th>
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
    const legend = state.open
      ? `<b>Number</b>: snow at the summit over 7 days, with the range across models under it. <b>Bars</b>: snow each day. <b>Letters</b>: ski grade for each day, A is best. Tap a resort for details.`
      : `<b>Number</b>: snow at the summit over 7 days. <b>Bars</b>: snow each day. <b>Hours</b>: time cold enough for snow guns each day (pre-season). Tap a resort for details.`;
    el.innerHTML = `<p class="list-legend">${legend}</p>` + (state.view === "table" ? renderTableView(rows) : renderRowsView(rows));
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

  // Current hour in New York as the forecast's "YYYY-MM-DDTHH:00".
  function nyHour() {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
  }

  // Weekend shading, a "now" line and a shared crosshair, drawn on every chart.
  const decor = {
    id: "upslopeDecor",
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea: a, scales } = chart;
      const times = chart.data.labels;
      ctx.save();
      ctx.fillStyle = "rgba(11,13,16,0.035)";
      times.forEach((t, i) => {
        const wd = dateObj(t.slice(0, 10)).getDay();
        if ((wd === 0 || wd === 6) && t.slice(11, 13) === "00") {
          const x0 = scales.x.getPixelForValue(i);
          const x1 = scales.x.getPixelForValue(Math.min(times.length - 1, i + 24));
          ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
        }
      });
      ctx.restore();
    },
    afterDatasetsDraw(chart) {
      const { ctx, chartArea: a, scales } = chart;
      const times = chart.data.labels;
      const now = times.indexOf(nyHour());
      ctx.save();
      if (now >= 0) {
        const x = scales.x.getPixelForValue(now);
        ctx.strokeStyle = css("--warn");
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, a.top);
        ctx.lineTo(x, a.bottom);
        ctx.stroke();
        ctx.fillStyle = css("--warn");
        ctx.font = "500 10px Geist Mono, monospace";
        ctx.fillText("NOW", x + 4, a.top + 10);
      }
      if (state.hoverIdx != null && state.hoverIdx < times.length) {
        const x = scales.x.getPixelForValue(state.hoverIdx);
        ctx.strokeStyle = "rgba(11,13,16,0.55)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, a.top);
        ctx.lineTo(x, a.bottom);
        ctx.stroke();
      }
      ctx.restore();
    },
  };

  function chartOptions(times, yTitle) {
    const muted = css("--muted");
    const line = css("--line");
    const mono = { family: "Geist Mono", size: 10.5 };
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      events: ["mousemove", "mouseout", "click", "touchstart", "touchmove"],
      onHover: (e, els, chart) => setHover(e.type === "mouseout" ? null : chart.scales.x.getValueForPixel(e.x)),
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
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

  // One readout for the hour under the finger or cursor, shared by both charts.
  function setHover(i) {
    const det = state.details[state.selected];
    if (!det) return;
    const n = state.charts[0]?.data.labels.length ?? 0;
    const idx = i == null ? null : Math.max(0, Math.min(n - 1, Math.round(i)));
    if (idx === state.hoverIdx) return;
    state.hoverIdx = idx;
    state.charts.forEach((c) => c.draw());
    renderReadout(det, idx);
  }

  function renderReadout(det, idx) {
    const el = $("#chart-readout");
    if (!el) return;
    const now = det.time.indexOf(nyHour());
    const i = idx ?? (now >= 0 ? now : 0);
    const t = det.time[i];
    let run = 0;
    for (let k = 0; k <= i; k++) run += det.summit.snow[k] || 0;
    const type = det.summit.type[i];
    const bits = [
      `<b>${dayShort(t.slice(0, 10))} ${hourLabel(t)}${idx == null ? " · now" : ""}</b>`,
      `${snowTxt(run)} since ${dayShort(det.time[0].slice(0, 10))}`,
      `summit ${tempTxtU(det.summit.t[i])}, base ${tempTxtU(det.base.t[i])}`,
      `gusts ${windTxt(det.summit.gust[i])} ${compass(det.summit.dir[i])}`,
      type ? PTYPE[type] : "dry",
    ];
    el.innerHTML = bits.join(" · ");
  }

  // Which models show on the snow chart. Saved per browser.
  const MODEL_SETS = {
    all: () => [],
    short: () => state.data.models.filter((m) => !m.hires).map((m) => m.id),
    global: () => state.data.models.filter((m) => m.hires).map((m) => m.id),
    none: () => state.data.models.map((m) => m.id),
  };
  const hiddenModels = () => new Set(store.get("ups-hidden-models", []));

  function modelChips() {
    const hidden = hiddenModels();
    const chips = state.data.models
      .filter((m) => m.ok)
      .map((m) => `<button class="mchip" data-model="${m.id}" aria-pressed="${!hidden.has(m.id)}"><i style="background:${m.color}"></i>${esc(m.label)}</button>`)
      .join("");
    return `<div class="mchips">
      <div class="seg mini" role="group" aria-label="Model groups"><button data-mset="all">All</button><button data-mset="short">Short-range</button><button data-mset="global">Global</button><button data-mset="none">Blend only</button></div>
      <div class="mchip-row">${chips}</div>
    </div>`;
  }

  function applyModelVisibility() {
    const c = state.charts.find((x) => x.canvas.id === "chart-snow");
    const hidden = hiddenModels();
    if (c) {
      c.data.datasets.forEach((d) => d.modelId && (d.hidden = hidden.has(d.modelId)));
      c.update("none");
    }
    document.querySelectorAll("[data-model]").forEach((b) => b.setAttribute("aria-pressed", String(!hidden.has(b.dataset.model))));
  }

  function drawCharts(row, det) {
    if (!window.Chart || !det) return;
    destroyCharts();
    state.hoverIdx = null;
    const n = Math.min(det.time.length, 24 * state.dates.length);
    const times = det.time.slice(0, n);
    const fg = css("--fg");
    const accent = css("--accent");
    const warn = css("--warn");
    const cut = (a) => a.slice(0, n);
    const sv = (v) => (v == null ? null : +snowNum(v).toFixed(1));
    const hidden = hiddenModels();

    // Snow accumulation: ensemble 10–90% band, each model, and the blend.
    const ds = [];
    if (det.ens) {
      ds.push({ label: "_p90", data: cut(det.ens.p90).map(sv), borderWidth: 0, pointRadius: 0, backgroundColor: "rgba(0,87,255,0.08)", fill: "+1" });
      ds.push({ label: "_p10", data: cut(det.ens.p10).map(sv), borderWidth: 0, pointRadius: 0, fill: false });
    }
    det.models.forEach((m) => {
      const meta = state.data.models.find((x) => x.id === m.id) || { label: m.id, color: "#999" };
      ds.push({ label: meta.label, modelId: m.id, hidden: hidden.has(m.id), data: cut(m.cum).map(sv), borderColor: meta.color, backgroundColor: meta.color, borderWidth: 1.2, pointRadius: 0, tension: 0.2 });
    });
    let run = 0;
    ds.push({ label: "Upslope blend", data: cut(det.summit.snow).map((s) => +snowNum((run += s || 0)).toFixed(1)), borderColor: fg, backgroundColor: fg, borderWidth: 2.75, pointRadius: 0, tension: 0.2 });
    state.charts.push(new Chart($("#chart-snow"), { type: "line", data: { labels: times, datasets: ds }, options: chartOptions(times, snowUnit()), plugins: [decor] }));

    // Temperatures at summit and base, with the freezing and snowmaking lines.
    const temps = (arr) => cut(arr).map((t) => (t == null ? null : +tempNum(t).toFixed(1)));
    const flat = (f) => times.map(() => +tempNum(f).toFixed(1));
    const tds = [
      { label: "Summit", data: temps(det.summit.t), borderColor: accent, backgroundColor: accent, borderWidth: 1.75, pointRadius: 0, tension: 0.2 },
      { label: "Base", data: temps(det.base.t), borderColor: fg, backgroundColor: fg, borderWidth: 1.25, pointRadius: 0, tension: 0.2 },
      { label: "Freezing", data: flat(32), borderColor: warn, backgroundColor: warn, borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
    ];
    if (!operating(row)) {
      tds.splice(2, 0, { label: "Snowmaking temp", data: temps(det.summit.tw), borderColor: "#0aa2c0", backgroundColor: "#0aa2c0", borderWidth: 1.25, borderDash: [2, 2], pointRadius: 0, tension: 0.2 });
      tds.push({ label: "Snowmaking line", data: flat(27), borderColor: "#6b7280", backgroundColor: "#6b7280", borderDash: [1, 3], borderWidth: 1, pointRadius: 0 });
    }
    const o2 = chartOptions(times, metric() ? "°C" : "°F");
    o2.scales.y.beginAtZero = false;
    state.charts.push(new Chart($("#chart-temp"), { type: "line", data: { labels: times, datasets: tds }, options: o2, plugins: [decor] }));
    $("#temp-legend").innerHTML = tds.map((d) => `<span><i style="background:${d.borderColor}${d.borderDash ? ";opacity:.7" : ""}"></i>${d.label}</span>`).join("");
    renderReadout(det, null);
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
      <p class="hint">Based on humidity-adjusted temperature at the summit and base, plus the air about a mile up. A warm layer up there is what turns snow into sleet or freezing rain.</p>
      <div class="ptype"><span class="label">Summit</span><div class="pt-strip" style="--n:${n}">${strip(det.summit.type)}</div>
      <span class="label">Base</span><div class="pt-strip" style="--n:${n}">${strip(det.base.type)}</div>
      <span></span><div class="pt-axis" style="--n:${state.dates.length}">${state.dates.map((d) => `<span>${dayShort(d)}</span>`).join("")}</div></div>
      <div class="legend label">${Object.entries(PTYPE).map(([k, v]) => `<span><i class="pt-${k}"></i>${v}</span>`).join("")}</div>
    </section>`;
  }

  // How the snow will feel to ski, from the snow-to-water ratio (kept off the page).
  const FEELS = [
    { key: "wet", min: 0, label: "Heavy & wet", short: "Like wet cement", blurb: "Sticks to everything. Great for building a base, tiring to ski." },
    { key: "packing", min: 8, label: "Dense", short: "Packs down firm", blurb: "Covers well and holds up, but you won't float in it." },
    { key: "powder", min: 11, label: "Soft powder", short: "Classic powder", blurb: "The everyday powder-day snow. Soft, forgiving, fun." },
    { key: "blower", min: 15, label: "Light & fluffy", short: "Skis deep", blurb: "Cold, dry \"blower\" powder. Feels bottomless, but blows around in wind." },
  ];
  const QUALITY = (slr) => (slr == null ? null : [...FEELS].reverse().find((f) => slr >= f.min));

  function qualityBlock(q, ratio) {
    if (!q) return "";
    const deep = Math.round(ratio);
    return `<section class="panel">
      <div class="block-head"><h3>How the snow will feel</h3><span class="label">This week's storms</span></div>
      <div class="feel">${FEELS.map((f) => `<div class="feel-step${f.key === q.key ? " on" : ""}"><b>${f.label}</b><span>${f.blurb}</span></div>`).join("")}</div>
      <p class="hint">Colder air makes lighter, fluffier flakes. This week's snow should come out about ${deep} times as deep as the water in it. A typical East Coast storm is about 10 times, so higher means fluffier.</p>
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
      k.push(`<div><span class="label">Snow feel</span><b>${q ? q.label : "–"}</b><span>${q ? q.short : "No snow"}</span></div>`);
      k.push(`<div><span class="label">Best ski day</span><b>${dayShort(days[row.bestDay.k].date)} · ${row.bestDay.letter}</b><span>${fmt(days[row.bestDay.k].grade.why.slice(0, 2).join(", ") || "typical day")}</span></div>`);
    } else {
      const best = [...row.snowmaking.windows].sort((a, b) => b.hours - a.hours)[0];
      k.push(`<div><span class="label">Snowmaking · 7d</span><b>${row.snowmaking.hours7}h</b><span>${best ? `Best ${dayShort(best.start.slice(0, 10))}, low ${tempTxtU(best.minTw)}` : "Too warm"}</span></div>`);
      k.push(`<div><span class="label">Odds of ${snowTxt(1)}+</span><b>${row.prob7 ? row.prob7[1] + "%" : "–"}</b><span>Next 7 days</span></div>`);
      k.push(`<div><span class="label">Typically opens</span><b>${row.season.phase === "preseason" ? dayNum(row.season.open) : "–"}</b><span>${row.season.phase === "preseason" ? `${row.season.daysToOpen} days out` : "Closed"}</span></div>`);
    }
    return { html: k.join(""), q, ratio };
  }

  // ---------- plain-language day reasons and the verdict ----------
  const WHY_PLAIN = {
    snowing: "snowing during the day",
    rain: "rain",
    "rain lower down": "rain at the base",
    "rain later": "rain later in the day",
    "refrozen, firm": "firm, icy surfaces",
    "firm early, softens": "firm early, softening by midday",
    "firm lower mountain": "firm on the lower mountain",
    "lift holds likely": "wind may stop upper lifts",
    breezy: "breezy up top",
    "brutal wind chill": "dangerous wind chill",
    "very cold": "very cold",
    bluebird: "sunny and calm",
  };
  const whyList = (why) => why.map((w) => WHY_PLAIN[w] || w);
  const GRADE_WORD = { A: "Great day", B: "Good day", C: "Average day", D: "Below average", F: "Skip it" };

  function verdict(row) {
    const s = row.season;
    const first = row.insights[0] ? row.insights[0].text : "";
    if (!operating(row)) {
      if (s.phase === "closed") return { title: "Closed for the season.", sub: first };
      const w = [...row.snowmaking.windows].sort((a, b) => b.hours - a.hours)[0];
      const opens = `Not open yet (usually opens around ${dayNum(s.open)}).`;
      return {
        title: w ? `${opens} Snow guns get their best run ${whenTxt(w.start)}.` : `${opens} Too warm for snowmaking this week.`,
        sub: row.insights.find((x) => x.kind === "storm")?.text || "",
      };
    }
    const k = row.bestDay.k;
    const d = row.days[k];
    const day = k === 0 ? "today" : dayLong(d.date);
    const feel = QUALITY(d.slr);
    const reasons = whyList(d.grade.why.filter((w) => !/fresh/.test(w))).slice(0, 2);
    let title;
    if (d.overnight >= 1 && "AB".includes(d.grade.letter)) title = `Go ${day}: about {{s:${d.overnight}}} of ${feel ? feel.label.toLowerCase() : "new"} snow overnight.`;
    else if ("AB".includes(d.grade.letter)) title = `${cap(day)} is the pick: ${reasons.join(" and ") || "a solid day"}.`;
    else if (d.grade.letter === "C") title = `An ordinary week. ${cap(day)} is the best of it${reasons.length ? `: ${reasons.join(" and ")}` : ""}.`;
    else title = `A rough week. If you go, ${day} is the least bad.`;
    // A deeper powder day that lost points to wind or cold is worth a mention.
    const deep = row.days
      .map((x, i) => ({ x, i }))
      .filter(({ x, i }) => i !== k && x.overnight >= Math.max(4, d.overnight * 2) && x.grade.score >= 58)
      .sort((a, b) => b.x.overnight - a.x.overnight)[0];
    if (deep) {
      const catchy = whyList(deep.x.grade.why.filter((w) => /hold|cold|chill|breezy|rain/.test(w)));
      title += ` ${cap(deep.i === 0 ? "today" : dayLong(deep.x.date))} morning has more fresh snow ({{s:${deep.x.overnight}}} overnight)${catchy.length ? `, but ${catchy.join(" and ")}` : ""}.`;
    }
    return { title, sub: first };
  }
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);

  function dayWhy(row, k) {
    const d = row.days[k];
    const bits = [];
    const name = k === 0 ? "Today" : dayLong(d.date);
    if (d.grade) {
      bits.push(`<b>${name}: ${d.grade.letter} · ${GRADE_WORD[d.grade.letter]}.</b>`);
      const why = whyList(d.grade.why);
      bits.push(why.length ? cap(why.join(", ")) + "." : "Nothing special either way.");
    } else {
      bits.push(`<b>${name}.</b>`);
      bits.push(d.smHours ? `${d.smHours} hours cold enough for snow guns at the summit${d.smBase ? `, ${d.smBase} at the base` : ""}.` : "Too warm for snowmaking.");
    }
    if (d.snow >= 0.5) bits.push(`Snow ${snowTxt(d.snow)} at the summit (models ${rangeTxt(d.lo, d.hi)}).`);
    if (d.rain + d.ice > 0.05) bits.push(`${d.ice > 0.05 ? "Sleet or freezing rain" : "Rain"} at the summit.`);
    else if (d.baseRain > 0.1) bits.push("Rain at the base.");
    bits.push(`High ${tempTxtU(d.tMax)}, low ${tempTxtU(d.tMin)} up top${d.gustMax != null ? `, gusts to ${windTxt(d.gustMax)}` : ""}.`);
    return fmt(bits.join(" ")).replace(/&lt;(\/?)b&gt;/g, "<$1b>");
  }

  function dayCards(row, sel) {
    return row.days
      .map((d, k) => {
        const ic = dayIcon(d);
        const wet = d.rain + d.ice;
        const flag = d.windHold
          ? `<span class="day-flag wind">Windy</span>`
          : wet > 0.1
            ? `<span class="day-flag rain">${d.ice > 0.05 ? "Ice" : "Rain"}</span>`
            : !operating(row) && d.smHours
              ? `<span class="day-flag cold">Guns ${d.smHours}h</span>`
              : `<span class="day-flag">&nbsp;</span>`;
        const badge = d.grade ? `<span class="grade g-${d.grade.letter}">${d.grade.letter}</span>` : "";
        return `<button class="day${d.snow >= 0.5 ? " snowy" : ""}" data-day="${k}" aria-pressed="${k === sel}" style="--c:${snowColor(d.snow)}">
          <span class="day-top"><span class="label">${dayShort(d.date)}</span>${badge}</span>
          <span title="${ic.label}">${Icon(ic.icon)}</span>
          <span class="day-snow">${d.snow >= 0.5 ? snowTxt(d.snow) : "–"}</span>
          <span class="day-temp"><b>${tempTxt(d.tMax)}</b> / ${tempTxt(d.tMin)}</span>
          ${flag}
        </button>`;
      })
      .join("");
  }

  function defaultDay(row) {
    if (operating(row)) return row.bestDay.k;
    const best = row.days.map((d, k) => ({ k, h: d.smHours })).sort((a, b) => b.h - a.h)[0];
    return best && best.h ? best.k : 0;
  }

  function selectDay(row, k) {
    document.querySelectorAll(".days [data-day]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.day) === k)));
    const el = $("#day-why");
    if (el) el.innerHTML = dayWhy(row, k);
  }

  async function openDetail(id) {
    const row = state.rows.find((r) => r.resort.id === id);
    if (!row) return;
    const r = row.resort;
    if (state.selected !== id) state.moreOpen = false;
    state.selected = id;
    const dlg = $("#detail");
    const page = PAGE === id;
    const target = page ? $("#resort-page") : $("#detail-body");
    const det = state.details[id];
    const { html: kpiHtml, q, ratio } = kpis(row);
    const v = verdict(row);
    const notes = row.insights.filter((x) => x.text !== v.sub && x.kind !== "best" && x.kind !== "season");
    const top = notes.slice(0, 3);
    const more = notes.slice(3);
    const sel = defaultDay(row);
    const actions = page
      ? `${favButton(id, "sq fav")}<a class="sq wide" href="./">All resorts</a>`
      : `<a class="sq wide" href="resorts/${id}/">Full page</a>${favButton(id, "sq fav")}<button class="sq" data-close aria-label="Close">${Icon("close")}</button>`;
    target.innerHTML = `
      <header class="detail-head">
        <span class="label">${esc(r.region)} · ${r.state} · ${seasonLine(row)}</span>
        <div class="detail-actions">${actions}</div>
      </header>
      <div class="d-body">
        <div class="d-title"><h2>${esc(r.name)}</h2><p class="mono">SUMMIT ${elevTxt(r.summit).toUpperCase()} · BASE ${elevTxt(r.base).toUpperCase()}</p></div>
        <section class="verdict">
          <span class="label">This week</span>
          <p class="verdict-title">${fmt(v.title)}</p>
          ${v.sub ? `<p class="verdict-sub">${fmt(v.sub)}</p>` : ""}
        </section>
        <div class="days">${dayCards(row, sel)}</div>
        <p class="day-why" id="day-why" aria-live="polite">${dayWhy(row, sel)}</p>
        ${top.length ? `<h3 class="sub-h">What to know</h3><ul class="insights">${top.map((x) => `<li data-kind="${x.kind}">${fmt(x.text)}</li>`).join("")}</ul>` : ""}
        <div class="d-kpis">${kpiHtml}</div>
        ${qualityBlock(q, ratio)}
        <details class="more" id="more"${state.moreOpen ? " open" : ""}>
          <summary><span><b>Forecast details</b><span class="hint">Hour-by-hour charts, lift wind, every model and the odds</span></span><span class="more-icon" aria-hidden="true"></span></summary>
          ${more.length ? `<ul class="insights">${more.map((x) => `<li data-kind="${x.kind}">${fmt(x.text)}</li>`).join("")}</ul>` : ""}
          <div id="detail-hourly">${detailHourly(row, det)}</div>
          ${oddsPanel(row)}
        </details>
        ${guidePanel(row)}
        ${signupBlock(row)}
      </div>`;
    $("#more").addEventListener("toggle", (e) => {
      state.moreOpen = e.target.open;
      if (e.target.open && state.details[id]) drawCharts(row, state.details[id]);
    });
    if (!page) {
      if (!dlg.open) dlg.showModal();
      dlg.scrollTop = 0;
      history.replaceState(null, "", `#${id}`);
    }
    if (det) return state.moreOpen && drawCharts(row, det);
    const loaded = await loadDetail(id);
    if (state.selected !== id || !loaded) return;
    $("#detail-hourly").innerHTML = detailHourly(row, loaded);
    if (state.moreOpen) drawCharts(row, loaded);
  }

  function detailHourly(row, det) {
    if (!det) return `<div class="skeleton sk-row"></div><div class="skeleton sk-row"></div>`;
    return `${windPanel(row, det)}
      <section class="panel">
        <div class="block-head"><h3>Snow piling up at the summit</h3><span class="label">${snowUnit()} · running total</span></div>
        <p class="hint">The thick black line is the Upslope blend. Thin lines are single models; tap a name to hide or show it. The blue band is where 80% of ${state.data.ensembles.members} ensemble runs land: the wider it is, the less certain the forecast. Weekends are shaded.</p>
        ${modelChips()}
        <p class="readout" id="chart-readout"></p>
        <div class="chart"><canvas id="chart-snow"></canvas></div>
      </section>
      ${ptypePanel(row, det)}
      <section class="panel">
        <div class="block-head"><h3>Temperature, summit vs base</h3><span class="label">${metric() ? "°C" : "°F"} · hourly</span></div>
        <p class="hint">${
          operating(row)
            ? "Above the dashed freezing line, snow turns to rain or melts. Base above and summit below means snow up top and slush at the bottom."
            : "Snow guns go by the snowmaking temp (dotted blue): air temperature adjusted for humidity. Below the gray line, guns can run. Dry air helps, which is why they can sometimes run above freezing."
        }</p>
        <div class="chart"><canvas id="chart-temp"></canvas></div>
        <div class="legend label" id="temp-legend"></div>
      </section>
      ${modelTable(row, det)}`;
  }

  // ---------- email alerts (Kit form; hidden until a form id is configured) ----------
  function signupForm(ids, heading, text) {
    if (!CONFIG.kitFormId) return "";
    return `<form class="signup" data-signup data-resorts="${ids.join(",")}">
      <div><h3>${heading}</h3><p class="hint">${text}</p></div>
      <div class="signup-row"><input type="email" name="email" required placeholder="you@email.com" aria-label="Email address"><button type="submit" class="btn">Sign up</button></div>
      <p class="signup-msg label" aria-live="polite"></p>
    </form>`;
  }
  const signupBlock = (row) =>
    signupForm([row.resort.id], `Get ${esc(row.resort.name)} alerts`, `An email when 6″ or more looks likely, when snowmaking weather lines up before opening, and a Thursday weekend outlook. Free, unsubscribe anytime.`);
  function renderSignupHome() {
    const el = $("#signup-home");
    if (!el) return;
    const favs = [...state.favorites];
    el.innerHTML = signupForm(favs, "Storm alerts for your mountains", favs.length ? `Alerts for your ${favs.length} starred mountain${favs.length > 1 ? "s" : ""}, plus a Thursday weekend outlook.` : "Star your mountains below to choose which alerts you get. Plus a Thursday weekend outlook. Free.");
    el.hidden = !el.innerHTML;
  }
  async function submitSignup(form) {
    const msg = $(".signup-msg", form);
    const email = form.email.value.trim();
    const ids = (form.dataset.resorts || "").split(",").filter(Boolean);
    const body = new FormData();
    body.append("email_address", email);
    body.append("fields[resorts]", ids.join(","));
    msg.textContent = "Signing you up…";
    try {
      const res = await fetch(`https://app.kit.com/forms/${CONFIG.kitFormId}/subscriptions`, { method: "POST", body, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(res.status);
      msg.textContent = "Check your inbox to confirm.";
      form.reset();
    } catch (e) {
      msg.textContent = "That didn't go through. Try again in a minute.";
    }
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
    if (!PAGE) renderSignupHome();
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
    renderWeekend();
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
      const rlink = e.target.closest(".r-link");
      if (rlink && !(e.metaKey || e.ctrlKey || e.shiftKey)) e.preventDefault();
      const signup = e.target.closest("[data-signup]");
      if (signup) return;
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
        if (PAGE) return openDetail(PAGE);
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
      const mchip = e.target.closest("[data-model]");
      if (mchip) {
        const h = hiddenModels();
        h.has(mchip.dataset.model) ? h.delete(mchip.dataset.model) : h.add(mchip.dataset.model);
        store.set("ups-hidden-models", [...h]);
        return applyModelVisibility();
      }
      const mset = e.target.closest("[data-mset]");
      if (mset) {
        store.set("ups-hidden-models", MODEL_SETS[mset.dataset.mset]());
        return applyModelVisibility();
      }
      const dayBtn = e.target.closest("[data-day]");
      if (dayBtn && state.selected) return selectDay(state.rows.find((x) => x.resort.id === state.selected), Number(dayBtn.dataset.day));
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
    document.addEventListener("submit", (e) => {
      const form = e.target.closest("[data-signup]");
      if (!form) return;
      e.preventDefault();
      submitSignup(form);
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
    if (PAGE) document.body.classList.add("page-mode");
    else initMap();
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
    if (PAGE) {
      document.querySelectorAll("[data-units]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.units === state.units)));
      return openDetail(PAGE);
    }
    renderAll();
    renderSignupHome();
    const hash = location.hash.slice(1);
    if (hash && RESORTS.some((r) => r.id === hash)) openDetail(hash);
  }

  init();
})();
