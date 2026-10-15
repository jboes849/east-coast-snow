// Forecast data and math. Pulls several weather models from Open-Meteo and turns
// them into per-resort daily snow totals with a range across models.
(function () {
  const API = "https://api.open-meteo.com/v1/forecast";
  const CACHE_MINUTES = 30;
  const FORECAST_DAYS = 7;

  const MODELS = [
    { id: "gfs_seamless", label: "GFS / HRRR" },
    { id: "ecmwf_ifs025", label: "ECMWF" },
    { id: "gem_seamless", label: "Canadian" },
    { id: "icon_seamless", label: "German ICON" },
    { id: "ncep_nbm_conus", label: "NWS Blend" },
  ];

  const HOURLY = [
    "precipitation",
    "snowfall",
    "temperature_2m",
    "freezing_level_height",
    "wind_gusts_10m",
  ];

  const ftToM = (ft) => Math.round(ft * 0.3048);
  const mToFt = (m) => m * 3.28084;

  // Snow-to-liquid ratio from air temperature (a surface-temperature take on the
  // Kuchera method): about 8:1 at freezing, rising to ~20:1 in cold air.
  function snowRatio(tempF) {
    if (tempF == null) return 10;
    const k = (tempF - 32) * 5 / 9 + 273.15;
    const r = k > 271.16 ? 12 + 2 * (271.16 - k) : 12 + (271.16 - k);
    return Math.max(3, Math.min(25, r));
  }

  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { at, data } = JSON.parse(raw);
      if (Date.now() - at > CACHE_MINUTES * 60000) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
    } catch (e) {
      // Storage full or blocked; the forecast still works without the cache.
    }
  }

  // One request per model covering every location. Returns an array of hourly
  // blocks in the same order as `locs`, or null when the model is unavailable.
  async function fetchModel(model, locs, elevationsFt) {
    const params = new URLSearchParams({
      latitude: locs.map((l) => l.lat).join(","),
      longitude: locs.map((l) => l.lon).join(","),
      elevation: elevationsFt.map(ftToM).join(","),
      hourly: HOURLY.join(","),
      models: model,
      forecast_days: String(FORECAST_DAYS),
      timezone: "America/New_York",
      temperature_unit: "fahrenheit",
      precipitation_unit: "inch",
      wind_speed_unit: "mph",
    });
    const url = `${API}?${params}`;
    const cached = cacheGet(url);
    if (cached) return cached;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      let json = await res.json();
      if (!Array.isArray(json)) json = [json];
      const blocks = json.map((j) => j.hourly);
      cacheSet(url, blocks);
      return blocks;
    } catch (e) {
      return null;
    }
  }

  // Variables come back as `snowfall` or `snowfall_<model>` depending on the request.
  function series(hourly, name, model) {
    return hourly[name] || hourly[`${name}_${model}`] || [];
  }

  // Hourly model output -> per-day totals for one location.
  function summarize(hourly, model) {
    const time = hourly.time || [];
    const precip = series(hourly, "precipitation", model);
    const snowfall = series(hourly, "snowfall", model);
    const temp = series(hourly, "temperature_2m", model);
    const fzl = series(hourly, "freezing_level_height", model);
    const gust = series(hourly, "wind_gusts_10m", model);

    const days = {};
    const hours = [];
    for (let i = 0; i < time.length; i++) {
      const t = time[i];
      const date = t.slice(0, 10);
      const hour = Number(t.slice(11, 13));
      const p = precip[i];
      const sf = snowfall[i];
      const tf = temp[i];
      if (p == null && sf == null && tf == null) continue;

      // Liquid that falls as snow, re-expanded with a temperature-based ratio
      // instead of the model's fixed 7:1.
      let snowWater;
      if (sf != null) snowWater = sf > 0 ? Math.min(p ?? sf / 7, sf / 7) : 0;
      else snowWater = tf != null && tf <= 33 ? p || 0 : 0;
      const snow = snowWater * snowRatio(tf);
      const mix = Math.max(0, (p || 0) - snowWater);

      hours.push({ t, snow, mix, temp: tf, fzlFt: fzl[i] != null ? mToFt(fzl[i]) : null, gust: gust[i] });

      const d = (days[date] ||= { snow: 0, mix: 0, tMin: null, tMax: null, gustMax: null, fzlMin: null, overnight: 0 });
      d.snow += snow;
      d.mix += mix;
      if (tf != null) {
        d.tMin = d.tMin == null ? tf : Math.min(d.tMin, tf);
        d.tMax = d.tMax == null ? tf : Math.max(d.tMax, tf);
      }
      if (gust[i] != null) d.gustMax = Math.max(d.gustMax ?? 0, gust[i]);
      if (fzl[i] != null) {
        const ft = mToFt(fzl[i]);
        d.fzlMin = d.fzlMin == null ? ft : Math.min(d.fzlMin, ft);
      }
      // Overnight window for a powder morning: 4pm the day before to 9am.
      if (hour < 9) d.overnight += snow;
      if (hour >= 16) {
        const next = nextDate(date);
        (days[next] ||= { snow: 0, mix: 0, tMin: null, tMax: null, gustMax: null, fzlMin: null, overnight: 0 }).overnight += snow;
      }
    }
    return { days, hours };
  }

  function nextDate(date) {
    const d = new Date(date + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function median(xs) {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Combine models into a consensus per day: median, low, high, and agreement.
  function consensus(perModel, dates) {
    return dates.map((date) => {
      const vals = perModel.map((m) => m.days[date]).filter(Boolean);
      const snow = vals.map((v) => v.snow);
      const med = median(snow) ?? 0;
      const lo = snow.length ? Math.min(...snow) : 0;
      const hi = snow.length ? Math.max(...snow) : 0;
      const spread = hi - lo;
      let confidence = "high";
      if (spread > Math.max(3, med * 0.8)) confidence = "low";
      else if (spread > Math.max(1.5, med * 0.4)) confidence = "medium";
      return {
        date,
        snow: med,
        lo,
        hi,
        confidence,
        models: vals.length,
        mix: median(vals.map((v) => v.mix)) ?? 0,
        overnight: median(vals.map((v) => v.overnight)) ?? 0,
        gustMax: median(vals.map((v) => v.gustMax).filter((x) => x != null)),
        tMin: median(vals.map((v) => v.tMin).filter((x) => x != null)),
        tMax: median(vals.map((v) => v.tMax).filter((x) => x != null)),
        fzlMin: median(vals.map((v) => v.fzlMin).filter((x) => x != null)),
      };
    });
  }

  // 0-100 score for a powder morning: overnight snow, cold fluffy snow, no rain,
  // and the models agreeing all push it up.
  function powderScore(day) {
    if (!day || day.overnight < 1) return 0;
    let s = Math.min(70, day.overnight * 7);
    if (day.tMax != null && day.tMax < 25) s += 10;
    if (day.mix < 0.05) s += 10;
    if (day.confidence === "high") s += 10;
    else if (day.confidence === "low") s -= 10;
    if (day.mix > 0.15) s -= 30;
    return Math.max(0, Math.min(100, Math.round(s)));
  }

  function forecastDates() {
    const out = [];
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
    for (let i = 0; i < FORECAST_DAYS; i++) {
      out.push(fmt.format(new Date(now.getTime() + i * 86400000)));
    }
    return out;
  }

  // Fetch every model for a set of locations at the given elevations.
  async function loadAll(locs, elevationsFt) {
    const results = await Promise.all(MODELS.map((m) => fetchModel(m.id, locs, elevationsFt)));
    const ok = [];
    MODELS.forEach((m, i) => {
      if (results[i]) ok.push({ model: m, blocks: results[i] });
    });
    return ok.map(({ model, blocks }) => ({
      model,
      locs: blocks.map((h) => summarize(h, model.id)),
    }));
  }

  window.Forecast = { MODELS, loadAll, consensus, powderScore, forecastDates, snowRatio };
})();
