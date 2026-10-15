// Forecast data and math. Pulls several weather models from Open-Meteo and turns
// them into per-resort daily snow totals, a range across models, and plain-English
// summaries. All values are inches, °F and mph; the page converts for display.
(function () {
  const API = "https://api.open-meteo.com/v1/forecast";
  const CACHE_MINUTES = 30;
  const FORECAST_DAYS = 7;

  const MODELS = [
    { id: "gfs_seamless", label: "GFS / HRRR", color: "#d4380d" },
    { id: "ecmwf_ifs025", label: "ECMWF", color: "#0b8a5f" },
    { id: "gem_seamless", label: "Canadian", color: "#c08a00" },
    { id: "icon_seamless", label: "German ICON", color: "#7a4fd1" },
    { id: "ncep_nbm_conus", label: "NWS Blend", color: "#0aa2c0" },
  ];

  const HOURLY = [
    "precipitation",
    "snowfall",
    "temperature_2m",
    "freezing_level_height",
    "wind_gusts_10m",
    "cloud_cover",
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

  function quality(ratio) {
    if (ratio == null) return null;
    if (ratio >= 15) return { key: "blower", label: "Blower powder", blurb: "light, dry and deep" };
    if (ratio >= 11) return { key: "powder", label: "Classic powder", blurb: "soft and fluffy" };
    if (ratio >= 8) return { key: "packing", label: "Dense snow", blurb: "denser, packs down well" };
    return { key: "wet", label: "Heavy, wet snow", blurb: "heavy and wet" };
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

  function emptyDay() {
    return { snow: 0, snowWater: 0, mix: 0, tMin: null, tMax: null, gustMax: null, fzlMin: null, overnight: 0, cloudSum: 0, cloudN: 0, coldHours: 0 };
  }

  // Hourly model output -> per-day totals and cleaned hourly values for one location.
  function summarize(hourly, model) {
    const time = hourly.time || [];
    const precip = series(hourly, "precipitation", model);
    const snowfall = series(hourly, "snowfall", model);
    const temp = series(hourly, "temperature_2m", model);
    const fzl = series(hourly, "freezing_level_height", model);
    const gust = series(hourly, "wind_gusts_10m", model);
    const cloud = series(hourly, "cloud_cover", model);

    const days = {};
    const hours = [];
    for (let i = 0; i < time.length; i++) {
      const t = time[i];
      const date = t.slice(0, 10);
      const hour = Number(t.slice(11, 13));
      const p = precip[i];
      const sf = snowfall[i];
      const tf = temp[i];
      if (p == null && sf == null && tf == null) {
        hours.push({ t, snow: null, mix: null, temp: null, fzlFt: null, gust: null });
        continue;
      }

      // Liquid that falls as snow, re-expanded with a temperature-based ratio
      // instead of the model's fixed 7:1.
      let snowWater;
      if (sf != null) snowWater = sf > 0 ? Math.min(p ?? sf / 7, sf / 7) : 0;
      else snowWater = tf != null && tf <= 33 ? p || 0 : 0;
      const snow = snowWater * snowRatio(tf);
      const mix = Math.max(0, (p || 0) - snowWater);

      hours.push({ t, snow, mix, temp: tf, fzlFt: fzl[i] != null ? mToFt(fzl[i]) : null, gust: gust[i] ?? null });

      const d = (days[date] ||= emptyDay());
      d.snow += snow;
      d.snowWater += snowWater;
      d.mix += mix;
      if (tf != null) {
        d.tMin = d.tMin == null ? tf : Math.min(d.tMin, tf);
        d.tMax = d.tMax == null ? tf : Math.max(d.tMax, tf);
        if (tf <= 26) d.coldHours += 1;
      }
      if (gust[i] != null) d.gustMax = Math.max(d.gustMax ?? 0, gust[i]);
      if (fzl[i] != null) {
        const ft = mToFt(fzl[i]);
        d.fzlMin = d.fzlMin == null ? ft : Math.min(d.fzlMin, ft);
      }
      if (cloud[i] != null && hour >= 9 && hour <= 16) {
        d.cloudSum += cloud[i];
        d.cloudN += 1;
      }
      // Overnight window for a powder morning: 4pm the day before to 9am.
      if (hour < 9) d.overnight += snow;
      if (hour >= 16) (days[nextDate(date)] ||= emptyDay()).overnight += snow;
    }
    return { days, hours };
  }

  function nextDate(date) {
    const d = new Date(date + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function median(xs) {
    const v = xs.filter((x) => x != null && !Number.isNaN(x));
    if (!v.length) return null;
    const s = [...v].sort((a, b) => a - b);
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
      const ratio = median(vals.filter((v) => v.snowWater > 0.02).map((v) => v.snow / v.snowWater));
      return {
        date,
        snow: med,
        lo,
        hi,
        confidence,
        models: vals.length,
        ratio,
        quality: med >= 0.5 ? quality(ratio) : null,
        mix: median(vals.map((v) => v.mix)) ?? 0,
        overnight: median(vals.map((v) => v.overnight)) ?? 0,
        gustMax: median(vals.map((v) => v.gustMax)),
        tMin: median(vals.map((v) => v.tMin)),
        tMax: median(vals.map((v) => v.tMax)),
        fzlMin: median(vals.map((v) => v.fzlMin)),
        cloud: median(vals.map((v) => (v.cloudN ? v.cloudSum / v.cloudN : null))),
        coldHours: median(vals.map((v) => v.coldHours)) ?? 0,
      };
    });
  }

  // Median of every model, hour by hour, plus each model's running snow total.
  function hourly(perModel) {
    const n = Math.max(0, ...perModel.map((m) => m.hours.length));
    const ref = perModel.find((m) => m.hours.length === n);
    const out = { time: [], snow: [], mix: [], temp: [], gust: [], fzlFt: [], cumulative: perModel.map(() => []) };
    const totals = perModel.map(() => 0);
    for (let i = 0; i < n; i++) {
      const hs = perModel.map((m) => m.hours[i]);
      out.time.push(ref.hours[i].t);
      out.snow.push(median(hs.map((h) => h?.snow)) ?? 0);
      out.mix.push(median(hs.map((h) => h?.mix)) ?? 0);
      out.temp.push(median(hs.map((h) => h?.temp)));
      out.gust.push(median(hs.map((h) => h?.gust)));
      out.fzlFt.push(median(hs.map((h) => h?.fzlFt)));
      hs.forEach((h, k) => {
        if (h?.snow != null) totals[k] += h.snow;
        out.cumulative[k].push(h?.snow != null ? totals[k] : null);
      });
    }
    return out;
  }

  // Snow events: runs of snowy hours, allowing short breaks.
  function storms(hc, perModel) {
    const events = [];
    let cur = null;
    let gap = 0;
    hc.snow.forEach((s, i) => {
      if (s >= 0.1) {
        if (!cur) cur = { start: i, end: i, total: 0 };
        cur.end = i;
        cur.total += s;
        gap = 0;
      } else if (cur) {
        cur.total += s;
        if (++gap > 4) {
          events.push(cur);
          cur = null;
        }
      }
    });
    if (cur) events.push(cur);
    return events
      .filter((e) => e.total >= 1)
      .map((e) => {
        const modelTotals = perModel.map((m) => {
          let t = 0;
          for (let i = e.start; i <= e.end; i++) t += m.hours[i]?.snow ?? 0;
          return t;
        });
        let water = 0;
        let snow = 0;
        for (let i = e.start; i <= e.end; i++) {
          snow += hc.snow[i];
          water += hc.snow[i] / snowRatio(hc.temp[i]);
        }
        return {
          ...e,
          startTime: hc.time[e.start],
          endTime: hc.time[e.end],
          lo: Math.min(...modelTotals),
          hi: Math.max(...modelTotals),
          quality: quality(water > 0 ? snow / water : null),
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
    for (let i = 0; i < FORECAST_DAYS; i++) out.push(fmt.format(new Date(now.getTime() + i * 86400000)));
    return out;
  }

  // Fetch every model for a set of locations at the given elevations.
  async function loadAll(locs, elevationsFt) {
    const results = await Promise.all(MODELS.map((m) => fetchModel(m.id, locs, elevationsFt)));
    const out = [];
    MODELS.forEach((model, i) => {
      if (results[i]) out.push({ model, locs: results[i].map((h) => summarize(h, model.id)) });
    });
    return out;
  }

  window.Forecast = { MODELS, loadAll, consensus, hourly, storms, powderScore, forecastDates, snowRatio, quality, median };
})();
