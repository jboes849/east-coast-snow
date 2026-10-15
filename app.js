(function () {
  const F = window.Forecast;
  const { MODELS, loadAll, consensus, hourly, storms, powderScore, forecastDates, median } = F;
  const RESORTS = window.RESORTS;
  const GUIDES = window.GUIDES || {};
  const SETUPS = window.SETUPS || {};
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
  // ---------- storm setups, ski hours, grades ----------
  const inArc = (dir, [a, b]) => (a <= b ? dir >= a && dir <= b : dir >= a || dir <= b);
  const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const compass = (dir) => (dir == null ? "–" : COMPASS[Math.round(dir / 45) % 8]);
  const guideFor = (r) => GUIDES[r.id] || { setups: [], hold: WIND_HOLD, exposed: [250, 340] };

  // Classify a storm by its snow-weighted wind direction.
  function classifyStorm(row, s) {
    const g = guideFor(row.resort);
    const items = [];
    let tSum = 0;
    let n = 0;
    for (let i = s.start; i <= s.end; i++) {
      if (row.hc.dir[i] != null) items.push({ dir: row.hc.dir[i], w: Math.max(0.01, row.hc.snow[i]) });
      if (row.hc.temp[i] != null) { tSum += row.hc.temp[i]; n++; }
    }
    const dir = F.meanDir(items);
    const temp = n ? tSum / n : null;
    let key = "west";
    if (dir == null) key = "west";
    else if (g.lake && inArc(dir, g.lake) && (temp == null || temp <= 32)) key = "lake";
    else if (dir >= 280 || dir < 10) key = "upslope";
    else if (dir < 130) key = "noreaster";
    else if (dir < 240) key = "southern";
    return { key, dir, favored: g.setups.includes(key), best: g.setups[0] === key };
  }

  // Lift-hours (8am-4pm) weather for one day.
  function skiHours(row, date) {
    const idx = [];
    row.hc.time.forEach((t, i) => {
      const h = Number(t.slice(11, 13));
      if (t.startsWith(date) && h >= 8 && h <= 16) idx.push(i);
    });
    const pick = (arr) => idx.map((i) => arr[i]).filter((v) => v != null);
    const temps = pick(row.hc.temp);
    const gusts = pick(row.hc.gust);
    const chills = idx.map((i) => windChill(row.hc.temp[i], row.hc.wind[i])).filter((v) => v != null);
    return {
      idx,
      snow: sum(pick(row.hc.snow)),
      mix: sum(pick(row.hc.mix)),
      tMax: temps.length ? Math.max(...temps) : null,
      tMin: temps.length ? Math.min(...temps) : null,
      gustMax: gusts.length ? Math.max(...gusts) : null,
      chillMin: chills.length ? Math.min(...chills) : null,
      dir: F.meanDir(idx.map((i) => (row.hc.dir[i] != null ? { dir: row.hc.dir[i], w: row.hc.wind[i] || 1 } : null))),
    };
  }

  function windChill(t, v) {
    if (t == null || v == null) return null;
    if (t > 50 || v < 3) return t;
    const p = Math.pow(v, 0.16);
    return 35.74 + 0.6215 * t - 35.75 * p + 0.4275 * t * p;
  }

  // Wind-hold threshold for a resort, a little lower when the wind hits its exposed side.
  function holdFor(row, dir) {
    const g = guideFor(row.resort);
    return g.hold - (dir != null && inArc(dir, g.exposed) ? 5 : 0);
  }

  function windRisk(row, gust, dir) {
    if (gust == null) return "none";
    const hold = holdFor(row, dir);
    if (gust >= hold) return "high";
    if (gust >= hold - 10) return "moderate";
    return "low";
  }

  // A-F ski grade for a day: fresh snow and bluebird calm push it up; rain,
  // refreeze ice, lift-closing wind and brutal cold pull it down.
  function gradeDay(row, k) {
    const d = row.days[k];
    const prev = row.days[k - 1];
    const ski = skiHours(row, d.date);
    let score = 66;
    const why = [];
    if (d.overnight >= 1) { score += Math.min(30, d.overnight * 4); why.push(`${snowTxt(d.overnight)} fresh`); }
    if (ski.snow >= 1) { score += Math.min(10, ski.snow * 1.5); why.push("snowing"); }
    let ice = false;
    if (ski.mix > 0.05) { score -= 35; why.push("rain"); }
    else if (d.mix > 0.1) { score -= 12; why.push("rain later"); }
    if (prev && (prev.mix > 0.1 || (prev.tMax ?? 0) > 38) && ski.tMax != null && ski.tMax <= 30 && d.overnight < 2) {
      score -= 20;
      ice = true;
      why.push("icy refreeze");
    }
    if (!ice && ski.tMax != null && ski.tMax >= 36 && ski.tMax <= 50 && ski.mix < 0.02 && (d.tMin ?? 99) <= 30) { score += 4; why.push("softening"); }
    const hold = holdFor(row, ski.dir);
    if (ski.gustMax != null && ski.gustMax >= hold) { score -= 15; why.push("lift holds likely"); }
    else if (ski.gustMax != null && ski.gustMax >= hold - 10) { score -= 5; why.push("breezy"); }
    if (ski.chillMin != null && ski.chillMin <= -20) { score -= 15; why.push("brutal wind chill"); }
    else if (ski.chillMin != null && ski.chillMin <= -5) { score -= 7; why.push("very cold"); }
    if (d.cloud != null && d.cloud < 40 && (ski.gustMax ?? 0) < 25 && ski.mix < 0.02 && !ice) { score += 6; why.push("bluebird"); }
    score = Math.max(0, Math.min(100, Math.round(score)));
    const letter = score >= 85 ? "A" : score >= 72 ? "B" : score >= 58 ? "C" : score >= 45 ? "D" : "F";
    return { score, letter, why, ice, ski };
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
    state.rows.forEach((row) => {
      row.storms.forEach((s) => (s.setup = classifyStorm(row, s)));
      row.grades = row.days.map((d, k) => gradeDay(row, k));
      row.bestDay = row.grades.map((g, k) => ({ ...g, k })).sort((a, b) => b.score - a.score || a.k - b.k)[0];
      row.iceDay = row.grades.find((g) => g.ice) ? row.days[row.grades.findIndex((g) => g.ice)] : null;
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
      if (big.setup) {
        const s = SETUPS[big.setup.key];
        if (big.setup.best) out.push(`It's a ${s.label.toLowerCase()} setup, this mountain's specialty.`);
        else if (big.setup.favored) out.push(`It's a ${s.label.toLowerCase()} setup, which usually works well here.`);
      }
      const others = row.storms.filter((s) => s !== big);
      if (others.length) out.push(`${others.length === 1 ? "Another round adds" : "More rounds add"} ${snowTxt(sum(others.map((s) => s.total)))} later in the week.`);
    }
    if (row.rainDay) {
      const summitMix = row.rainDay.tMax != null && row.rainDay.tMax > 34;
      out.push(`Rain or ice is likely ${dayLong(row.rainDay.date)}${summitMix ? ", even at the summit" : ", mainly lower down"}.`);
    }
    if (row.windDay) out.push(`Gusts near ${windTxt(row.windDay.gustMax)} ${dayLong(row.windDay.date)} could put upper lifts on wind hold.`);
    if (row.iceDay) out.push(`Expect firm, icy snow ${dayLong(row.iceDay.date)} after the refreeze.`);
    if (row.best.score >= 40) out.push(`Best powder morning: ${dayLong(row.days[row.best.k].date)} (score ${row.best.score}).`);
    out.push(`Best day to ski: ${dayLong(row.days[row.bestDay.k].date)} (${row.bestDay.letter}).`);
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
    const bestSki = [...state.rows].sort((a, b) => b.bestDay.score - a.bestDay.score || b.total3 - a.total3)[0];
    const stats = [
      { label: "Most snow · 7d", value: `${snowVal(biggest.total7)}<i>${snowUnit()}</i>`, sub: biggest.resort.name, id: biggest.resort.id },
      powder.best.score > 0
        ? { label: "Best first chair", value: dayShort(powder.days[powder.best.k].date), sub: `${powder.resort.name} · ${powder.best.score}`, id: powder.resort.id }
        : { label: "Best first chair", value: "–", sub: "None in 3 days" },
      { label: "Best ski day", value: `${dayShort(bestSki.days[bestSki.bestDay.k].date)}<i>${bestSki.bestDay.letter}</i>`, sub: bestSki.resort.name, id: bestSki.resort.id },
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
    else if (state.sort === "grade") rows.sort((a, b) => b.bestDay.score - a.bestDay.score || b.total7 - a.total7);
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
    const fav = row.storms.find((s) => s.setup && s.setup.favored);
    if (fav) f.push(`<span class="f-setup">${fav.setup.key === "noreaster" ? "Nor'easter" : fav.setup.key === "lake" ? "Lake effect" : fav.setup.key === "upslope" ? "Upslope" : SETUPS[fav.setup.key].label} ${dayShort(fav.startTime.slice(0, 10))}</span>`);
    if (row.days.some((d) => d.quality && d.quality.key === "blower" && d.snow >= 2)) f.push(`<span class="f-powder">Blower</span>`);
    if (row.rainDay) f.push(`<span class="f-rain">Rain ${dayShort(row.rainDay.date)}</span>`);
    if (row.windDay) f.push(`<span class="f-wind">Wind ${dayShort(row.windDay.date)}</span>`);
    if (row.iceDay) f.push(`<span class="f-rain">Icy ${dayShort(row.iceDay.date)}</span>`);
    if (row.snowmaking >= 2 && row.total7 < 2) f.push(`<span class="f-cold">Snowmaking</span>`);
    return f.slice(0, 3).join("");
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
          <div>${spark(row)}<div class="grades">${row.grades.map((g) => `<span class="g-${g.letter}" title="${dayShort(row.days[row.grades.indexOf(g)].date)}: ${g.letter} · ${g.why.join(", ") || "typical day"}">${g.letter}</span>`).join("")}</div><div class="flags">${flags(row)}</div></div>
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
              ${d.mix > 0.1 ? `<span class="rain-mark">RAIN</span>` : ""}<span class="cell-grade g-${row.grades[row.days.indexOf(d)].letter}">${row.grades[row.days.indexOf(d)].letter}</span></td>`
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

  function setupName(key) {
    return SETUPS[key] ? SETUPS[key].label : key;
  }

  function guidePanel(row) {
    const g = guideFor(row.resort);
    if (!g.storms) return "";
    const thisWeek = row.storms.length
      ? row.storms
          .map((s) => {
            const tag = s.setup.best ? `<span class="tag on">Best setup</span>` : s.setup.favored ? `<span class="tag on">Good setup</span>` : `<span class="tag">Not its best setup</span>`;
            return `<li><span class="mono">${dayShort(s.startTime.slice(0, 10)).toUpperCase()} ${s.startTime.slice(11, 13)}:00</span><span>${setupName(s.setup.key)} · ${compass(s.setup.dir)} winds · ${snowTxt(s.total)}</span>${tag}</li>`;
          })
          .join("")
      : `<li><span class="mono">7 DAYS</span><span>No snow events in the forecast.</span></li>`;
    return `<section class="panel">
      <div class="block-head"><h3>Storm guide</h3><span class="label">What works here</span></div>
      <p class="guide-text">${esc(g.storms)}</p>
      <div class="setups">${g.setups.map((k, i) => `<div class="setup"><span class="label">${i === 0 ? "Best setup" : "Also works"}</span><b>${setupName(k)}</b><p>${esc(SETUPS[k].blurb)}</p></div>`).join("")}</div>
      <div class="label week-label">This week's storms</div>
      <ul class="storm-list">${thisWeek}</ul>
    </section>`;
  }

  function arrow(dir) {
    if (dir == null) return "";
    // Arrow points where the wind is blowing to.
    return `<svg class="arrow" viewBox="0 0 12 12" style="transform:rotate(${Math.round(dir + 180)}deg)" aria-hidden="true"><path d="M6 1v10M2.5 7.5 6 11l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
  }

  function windPanel(row) {
    const g = guideFor(row.resort);
    const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16];
    const label = (h) => (h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`);
    const rowsHtml = row.days
      .map((d) => {
        const cells = hours
          .map((h) => {
            const i = row.hc.time.findIndex((t) => t.startsWith(d.date) && Number(t.slice(11, 13)) === h);
            if (i < 0) return `<td class="w-none"></td>`;
            const gust = row.hc.gust[i];
            const dir = row.hc.dir[i];
            const risk = windRisk(row, gust, dir);
            return `<td class="w-${risk}" title="${label(h)} · gusts ${windTxt(gust)} from ${compass(dir)}">${gust != null ? Math.round(windNum(gust)) : "–"}${arrow(dir)}</td>`;
          })
          .join("");
        return `<tr><th scope="row">${dayShort(d.date)}</th>${cells}</tr>`;
      })
      .join("");
    return `<section class="panel">
      <div class="block-head"><h3>Lift wind, 8am–4pm</h3><span class="label">Summit gusts · ${metric() ? "km/h" : "mph"}</span></div>
      <p class="guide-text">${esc(g.wind || "")} Holds get likely here around ${windTxt(g.hold)}, a bit lower when wind comes from the ${compass((g.exposed[0] + ((g.exposed[1] - g.exposed[0] + 360) % 360) / 2) % 360)}.</p>
      <div class="scroll"><table class="windgrid">
        <thead><tr><th></th>${hours.map((h) => `<th>${label(h)}</th>`).join("")}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table></div>
      <div class="legend label"><span><i class="w-low"></i>Running</span><span><i class="w-moderate"></i>Slowdowns possible</span><span><i class="w-high"></i>Holds likely</span><span>Arrows show where the wind blows</span></div>
    </section>`;
  }

  async function openDetail(id) {
    const row = state.rows.find((r) => r.resort.id === id);
    if (!row) return;
    const r = row.resort;
    state.selected = id;
    const dlg = $("#detail");
    const days = row.days;
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
          <div><span class="label">Best ski day</span><b>${dayShort(days[row.bestDay.k].date)} · ${row.bestDay.letter}</b><span>${esc(row.bestDay.why.slice(0, 2).join(", ") || "typical day")}</span></div>
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
            const g = row.grades[days.indexOf(d)];
            return `<div class="day${d.snow >= 0.5 ? " snowy" : ""}" style="--c:${snowColor(d.snow)}" title="${g.letter}: ${esc(g.why.join(", ") || "typical day")}">
              <span class="day-top"><span class="label">${dayShort(d.date)}</span><span class="grade g-${g.letter}">${g.letter}</span></span>
              <span title="${ic.label}">${Icon(ic.icon)}</span>
              <span class="day-snow">${d.snow >= 0.5 ? snowTxt(d.snow) : "–"}</span>
              <span class="day-range">${d.hi >= 1 ? rangeTxt(d.lo, d.hi) : "&nbsp;"}</span>
              <span class="day-temp"><b>${tempTxt(d.tMax)}</b> / ${tempTxt(d.tMin)}</span>
              ${flag}
            </div>`;
          })
          .join("")}</div>
        <p class="hint grade-key">Day grades A–F weigh fresh snow, rain, refreeze ice, lift-closing wind and cold. Tap or hover a day for the reasons.</p>
        ${guidePanel(row)}
        ${windPanel(row)}
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
