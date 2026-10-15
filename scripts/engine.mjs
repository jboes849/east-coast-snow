// Upslope forecast engine. Turns raw model output into per-resort forecasts:
// lead-time weighted blends, precipitation type, snow-to-liquid ratios, ensemble
// probabilities, season state, snowmaking windows, day grades and insights.
//
// Units inside the engine: inches, °F, mph, feet. Pressure-level temperatures are
// kept in °C because that is how forecasters talk about them.
//
// Text output uses tokens the page converts to the reader's units:
//   {{s:4.2}} snow inches   {{r:2,6}} snow range   {{t:28}} temp °F
//   {{w:45}} wind mph       {{e:2500}} elevation ft {{l:0.4}} liquid inches

export const MODELS = [
  { id: "ncep_hrrr_conus", label: "HRRR", color: "#e11d48", hires: true },
  { id: "ncep_nam_conus", label: "NAM 3 km", color: "#f59e0b", hires: true },
  { id: "gem_hrdps_continental", label: "Canadian HRDPS", color: "#8b5e00", hires: true },
  { id: "ncep_nbm_conus", label: "NWS Blend", color: "#0aa2c0" },
  { id: "gfs_global", alt: "gfs_seamless", label: "GFS", color: "#d4380d" },
  { id: "ecmwf_ifs025", label: "ECMWF", color: "#0b8a5f" },
  { id: "gem_global", alt: "gem_seamless", label: "Canadian GEM", color: "#c08a00" },
  { id: "icon_seamless", label: "German ICON", color: "#7a4fd1" },
];

export const ENSEMBLES = [
  { id: "gfs025", label: "GFS ensemble" },
  { id: "ecmwf_ifs025", label: "ECMWF ensemble" },
];

export const HOURLY = [
  "precipitation",
  "temperature_2m",
  "relative_humidity_2m",
  "freezing_level_height",
  "wind_gusts_10m",
  "wind_speed_10m",
  "wind_direction_10m",
  "cloud_cover",
  "temperature_850hPa",
  "temperature_700hPa",
  "wind_direction_850hPa",
  "snow_depth",
];
export const ENS_HOURLY = ["precipitation", "temperature_2m"];

// Model weight by lead time in hours. High-resolution models resolve terrain and
// banding far better, but only run out ~2 days, so they dominate early.
export function weight(id, lead) {
  const l = Math.max(0, lead);
  switch (id) {
    case "ncep_hrrr_conus": return l <= 18 ? 3 : l <= 36 ? 2 : l <= 48 ? 1 : 0;
    case "gem_hrdps_continental": return l <= 36 ? 2 : l <= 48 ? 1 : 0;
    case "ncep_nam_conus": return l <= 36 ? 1.5 : l <= 60 ? 1 : 0;
    case "ncep_nbm_conus": return 1.5;
    case "ecmwf_ifs025": return 1.5;
    default: return 1;
  }
}

// ---------- small math ----------
const fToC = (f) => (f - 32) * 5 / 9;
const cToF = (c) => c * 9 / 5 + 32;
const sum = (xs) => xs.reduce((a, b) => a + (b || 0), 0);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

export function median(xs) {
  const v = xs.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function wmedian(vals, ws) {
  const p = vals.map((v, i) => [v, ws[i]]).filter(([v, w]) => v != null && !Number.isNaN(v) && w > 0).sort((a, b) => a[0] - b[0]);
  if (!p.length) return null;
  const total = sum(p.map((x) => x[1]));
  let acc = 0;
  for (let i = 0; i < p.length; i++) {
    acc += p[i][1];
    if (acc > total / 2) return p[i][0];
    if (acc === total / 2) return (p[i][0] + p[i + 1][0]) / 2;
  }
  return p[p.length - 1][0];
}

function wmean(vals, ws) {
  let a = 0;
  let b = 0;
  vals.forEach((v, i) => {
    if (v == null || !(ws[i] > 0)) return;
    a += v * ws[i];
    b += ws[i];
  });
  return b ? a / b : null;
}

// Average wind direction as a vector, so 350° and 10° average to 0°, not 180°.
export function meanDir(items) {
  let x = 0;
  let y = 0;
  items.forEach((it) => {
    if (!it || it.dir == null) return;
    const r = (it.dir * Math.PI) / 180;
    x += Math.sin(r) * it.w;
    y += Math.cos(r) * it.w;
  });
  if (!x && !y) return null;
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

export const inArc = (dir, arc) => !!arc && dir != null && (arc[0] <= arc[1] ? dir >= arc[0] && dir <= arc[1] : dir >= arc[0] || dir <= arc[1]);
const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
const compass = (dir) => (dir == null ? "variable" : COMPASS[Math.round(dir / 45) % 8]);

// ---------- physics ----------
// Wet-bulb temperature (Stull 2011). Wet bulb decides whether falling snow melts
// and whether snow guns work, far better than air temperature alone.
export function wetBulbF(tF, rh) {
  if (tF == null) return null;
  if (rh == null) return tF;
  const T = fToC(tF);
  const R = clamp(rh, 5, 100);
  const tw = T * Math.atan(0.151977 * Math.sqrt(R + 8.313659)) + Math.atan(T + R) - Math.atan(R - 1.676331) + 0.00391838 * R ** 1.5 * Math.atan(0.023101 * R) - 4.686035;
  return cToF(Math.min(T, tw));
}

// Kuchera snow ratio from the warmest temperature in the column (K).
export function kuchera(tmaxK) {
  const r = tmaxK > 271.16 ? 12 + 2 * (271.16 - tmaxK) : 12 + (271.16 - tmaxK);
  return clamp(r, 4, 25);
}

// Snow ratio from surface temperature only (ensemble members carry no upper air).
export const surfaceRatio = (tF) => kuchera(fToC(tF ?? 32) + 273.15);

// Type and snow amount for one hour of one model.
//   p: liquid in.  tF, twF: surface temp/wet bulb.  t850, t700: °C.
//   siteFt: elevation, so a "warm nose" below the site is ignored.
export function precipType({ p, tF, twF, t850, t700, wind, siteFt }) {
  const out = { snowW: 0, rainW: 0, iceW: 0, slr: null, snow: 0, type: null };
  if (p == null || tF == null) return out;
  if (p < 0.004) return out;
  const tw = fToC(twF ?? tF);
  const t = fToC(tF);
  // Warm layer aloft: 850 hPa is ~4,900 ft; skip it when the site is near or above it.
  const aloft = [siteFt < 4400 ? t850 : null, t700].filter((x) => x != null);
  const warm = aloft.length ? Math.max(...aloft) : null;
  let frac;
  let ice = false;
  if (warm != null && warm > 1 && tw <= 0.5) {
    // Snow melts in the warm layer, then refreezes (sleet) or lands as freezing rain.
    frac = 0;
    ice = true;
    out.type = t <= 0 && warm >= 3 ? "zr" : "pl";
  } else {
    frac = tw <= 0 ? 1 : tw >= 1.5 ? 0 : 1 - tw / 1.5;
    out.type = frac >= 0.9 ? "sn" : frac <= 0.1 ? "ra" : "mx";
  }
  out.snowW = p * frac;
  if (ice) out.iceW = p - out.snowW;
  else out.rainW = p - out.snowW;
  if (out.snowW > 0) {
    const col = [t, t850, siteFt < 9000 ? t700 : null].filter((x) => x != null);
    let slr = kuchera(Math.max(...col) + 273.15);
    // Wind breaks up flakes into small, dense grains.
    if (wind != null && wind > 15) slr *= Math.max(0.75, 1 - (wind - 15) * 0.01);
    // Partly melted flakes are wet and dense.
    if (frac < 1) slr = Math.min(slr, 6 + 4 * frac);
    out.slr = clamp(slr, 5, 22);
    out.snow = out.snowW * out.slr;
  }
  return out;
}

// ---------- parsing ----------
const series = (hourly, name, model) => hourly[name] || hourly[`${name}_${model}`] || [];
function unitOf(units, name, model) {
  return (units && (units[name] || units[`${name}_${model}`])) || "";
}
const lenToFt = (v, u) => (v == null ? null : u === "ft" ? v : v * 3.28084);
const depthToIn = (v, u) => (v == null ? null : u === "ft" ? v * 12 : u === "cm" ? v / 2.54 : u === "inch" || u === "in" ? v : v * 39.3701);
const pressToC = (v, u) => (v == null ? null : u.includes("F") ? fToC(v) : v);

// Raw Open-Meteo block -> plain arrays in engine units.
export function parseBlock(block, model) {
  const h = block.hourly || {};
  const u = block.hourly_units || {};
  const g = (n) => series(h, n, model);
  return {
    time: h.time || [],
    p: g("precipitation"),
    t: g("temperature_2m"),
    rh: g("relative_humidity_2m"),
    fzl: g("freezing_level_height").map((v) => lenToFt(v, unitOf(u, "freezing_level_height", model))),
    gust: g("wind_gusts_10m"),
    wind: g("wind_speed_10m"),
    dir: g("wind_direction_10m"),
    cloud: g("cloud_cover"),
    t850: g("temperature_850hPa").map((v) => pressToC(v, unitOf(u, "temperature_850hPa", model))),
    t700: g("temperature_700hPa").map((v) => pressToC(v, unitOf(u, "temperature_700hPa", model))),
    dir850: g("wind_direction_850hPa"),
    sd: g("snow_depth").map((v) => depthToIn(v, unitOf(u, "snow_depth", model))),
  };
}

// Ensemble block -> list of members, each { p:[], t:[] } aligned to `time`.
export function parseEnsemble(block, time) {
  const h = block.hourly || {};
  const idx = new Map((h.time || []).map((t, i) => [t, i]));
  const members = [];
  Object.keys(h).forEach((k) => {
    if (!k.startsWith("precipitation")) return;
    const suffix = k.slice("precipitation".length);
    const tk = `temperature_2m${suffix}`;
    if (!h[tk]) return;
    const p = time.map((t) => (idx.has(t) ? h[k][idx.get(t)] : null));
    const tt = time.map((t) => (idx.has(t) ? h[tk][idx.get(t)] : null));
    if (p.some((v) => v != null)) members.push({ p, t: tt });
  });
  return members;
}

// ---------- per-model processing ----------
// Hourly physics for one model at one site. `fill850` supplies the cross-model
// median where a model has no upper-air temps.
function processModel(raw, siteFt, fill850, fill700, timeIndex) {
  const n = timeIndex.length;
  const at = new Map(raw.time.map((t, i) => [t, i]));
  const hours = [];
  for (let k = 0; k < n; k++) {
    const i = at.get(timeIndex[k]);
    const tF = i == null ? null : raw.t[i];
    const p = i == null ? null : raw.p[i];
    if (tF == null && p == null) {
      hours.push(null);
      continue;
    }
    const t850 = raw.t850[i] ?? fill850[k];
    const t700 = raw.t700[i] ?? fill700[k];
    const twF = wetBulbF(tF, raw.rh[i]);
    const wind = raw.wind[i] ?? null;
    const pt = precipType({ p: p ?? 0, tF, twF, t850, t700, wind, siteFt });
    hours.push({
      p: p ?? 0,
      t: tF,
      tw: twF,
      t850,
      fzl: raw.fzl[i] ?? null,
      gust: raw.gust[i] ?? null,
      wind,
      dir: raw.dir[i] ?? null,
      dir850: raw.dir850[i] ?? null,
      cloud: raw.cloud[i] ?? null,
      rh: raw.rh[i] ?? null,
      sd: raw.sd[i] ?? null,
      ...pt,
    });
  }
  return hours;
}

// ---------- the blend ----------
// Blend models hour by hour. Amounts use a weighted mean (keeps totals when models
// disagree on timing), then each day is rescaled to the weighted median of the
// models' daily totals, which resists a single wild model.
function blend(models, timeIndex, leads, dates, factors = {}) {
  const wt = (id, lead) => weight(id, lead) * (factors[id] ?? 1);
  const n = timeIndex.length;
  const H = { snow: [], snowW: [], rain: [], ice: [], t: [], tw: [], t850: [], fzl: [], gust: [], wind: [], dir: [], dir850: [], cloud: [], rh: [], sd: [], type: [] };
  for (let k = 0; k < n; k++) {
    const hs = models.map((m) => m.hours[k]);
    const ws = models.map((m, j) => (hs[j] ? wt(m.id, leads[k]) : 0));
    const pick = (f) => hs.map((h) => (h ? h[f] : null));
    H.snow.push(wmean(pick("snow"), ws) ?? 0);
    H.snowW.push(wmean(pick("snowW"), ws) ?? 0);
    H.rain.push(wmean(pick("rainW"), ws) ?? 0);
    H.ice.push(wmean(pick("iceW"), ws) ?? 0);
    for (const f of ["t", "tw", "t850", "fzl", "gust", "wind", "cloud", "rh", "sd"]) H[f].push(wmedian(pick(f), ws));
    H.dir.push(meanDir(hs.map((h, j) => (h && h.dir != null ? { dir: h.dir, w: (h.wind || 1) * ws[j] } : null))));
    H.dir850.push(meanDir(hs.map((h, j) => (h && h.dir850 != null ? { dir: h.dir850, w: ws[j] } : null))));
  }

  // Per-model daily totals and the consensus day.
  const dayIdx = {};
  timeIndex.forEach((t, k) => (dayIdx[t.slice(0, 10)] ||= []).push(k));
  const perModelDays = models.map((m) => {
    const out = {};
    for (const [d, ks] of Object.entries(dayIdx)) {
      const hs = ks.map((k) => m.hours[k]);
      if (hs.filter(Boolean).length < ks.length * 0.75) continue;
      out[d] = {
        snow: sum(hs.map((h) => h?.snow)),
        rain: sum(hs.map((h) => h?.rainW)),
        ice: sum(hs.map((h) => h?.iceW)),
        w: wmean(ks.map((k) => wt(m.id, leads[k])), ks.map(() => 1)),
      };
    }
    return out;
  });

  const days = {};
  for (const [d, ks] of Object.entries(dayIdx)) {
    const have = perModelDays.map((pm, j) => (pm[d] ? j : -1)).filter((j) => j >= 0 && perModelDays[j][d].w > 0);
    const ws = have.map((j) => perModelDays[j][d].w);
    const snows = have.map((j) => perModelDays[j][d].snow);
    const target = {
      snow: wmedian(snows, ws) ?? 0,
      rain: wmedian(have.map((j) => perModelDays[j][d].rain), ws) ?? 0,
      ice: wmedian(have.map((j) => perModelDays[j][d].ice), ws) ?? 0,
    };
    // Rescale the hourly shape to match the daily consensus.
    for (const [f, key] of [["snow", "snow"], ["rain", "rain"], ["ice", "ice"]]) {
      const s = sum(ks.map((k) => H[key][k]));
      const scale = s > 0 ? target[f] / s : 0;
      ks.forEach((k) => (H[key][k] *= scale));
      if (f === "snow") ks.forEach((k) => (H.snowW[k] *= scale));
    }
    days[d] = {
      date: d,
      snow: target.snow,
      lo: snows.length ? Math.min(...snows) : 0,
      hi: snows.length ? Math.max(...snows) : 0,
      models: have.length,
      rain: target.rain,
      ice: target.ice,
    };
  }
  for (let k = 0; k < n; k++) {
    const total = H.snowW[k] + H.rain[k] + H.ice[k];
    if (total < 0.004) H.type.push(null);
    else if (H.ice[k] > total * 0.4) H.type.push(H.t[k] != null && H.t[k] <= 32 && H.ice[k] > H.snowW[k] ? "zr" : "pl");
    else if (H.snowW[k] >= total * 0.9) H.type.push("sn");
    else if (H.snowW[k] <= total * 0.1) H.type.push("ra");
    else H.type.push("mx");
  }
  return { H, days, perModelDays };
}

// ---------- ensembles ----------
// Ensemble members carry only surface data, so precipitation type and snow ratio
// come from the deterministic blend where it has precipitation (that includes the
// warm layer aloft), and from member temperature otherwise.
function memberSnow(m, H) {
  return m.p.map((p, k) => {
    const t = m.t[k];
    if (p == null || t == null || p < 0.004) return 0;
    const det = H.snowW[k] + H.rain[k] + H.ice[k];
    let frac;
    let slr;
    if (det >= 0.003) {
      frac = H.snowW[k] / det;
      slr = H.snowW[k] > 0.001 ? H.snow[k] / H.snowW[k] : surfaceRatio(t);
    } else {
      frac = H.t850[k] != null && H.t850[k] > 1 ? 0 : t <= 32 ? 1 : t >= 35 ? 0 : (35 - t) / 3;
      slr = surfaceRatio(t);
    }
    return p * frac * slr;
  });
}

// Pooled ensemble: each ensemble system gets equal say regardless of size.
function ensembleStats(systems, H) {
  const members = [];
  systems.forEach((sys) => sys.members.forEach((m) => members.push({ w: 1 / sys.members.length, snow: memberSnow(m, H) })));
  return members.length ? members : null;
}

function probAtLeast(members, k0, k1, thresholds) {
  const tw = sum(members.map((m) => m.w));
  const totals = members.map((m) => ({ v: sum(m.snow.slice(k0, k1 + 1)), w: m.w }));
  const out = {};
  thresholds.forEach((th) => (out[th] = Math.round((100 * sum(totals.filter((x) => x.v >= th).map((x) => x.w))) / tw)));
  return out;
}

function percentile(members, arrFn, q) {
  const vals = members.map((m) => ({ v: arrFn(m), w: m.w })).sort((a, b) => a.v - b.v);
  const tw = sum(vals.map((x) => x.w));
  let acc = 0;
  for (const x of vals) {
    acc += x.w;
    if (acc >= tw * q) return x.v;
  }
  return vals.length ? vals[vals.length - 1].v : 0;
}

// ---------- season ----------
function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000);

export function season(resort, date) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const startYear = m >= 7 ? y : y - 1;
  const open = `${startYear}-${resort.open || "12-01"}`;
  const close = `${startYear + 1}-${resort.close || "04-01"}`;
  let phase;
  if (date < open) phase = "preseason";
  else if (date > close) phase = "closed";
  else if (daysBetween(open, date) < 21) phase = "early";
  else if (date >= `${startYear + 1}-03-10`) phase = "spring";
  else phase = "season";
  return { phase, open, close, daysToOpen: date < open ? daysBetween(date, open) : 0, operating: phase === "early" || phase === "season" || phase === "spring" };
}

// Typical Great Lakes surface temps (°C) by month, for lake-effect instability.
const LAKE_C = { 1: 3, 2: 1, 3: 2, 4: 4, 5: 8, 6: 15, 7: 21, 8: 23, 9: 20, 10: 15, 11: 10, 12: 6 };

// ---------- text helpers ----------
const WEEKDAY = (date) => new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
const WD = (date) => new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
function when(t) {
  const d = WEEKDAY(t.slice(0, 10));
  const h = Number(t.slice(11, 13));
  if (h < 5) return `early ${d}`;
  if (h < 12) return `${d} morning`;
  if (h < 17) return `${d} afternoon`;
  if (h < 21) return `${d} evening`;
  return `${d} night`;
}
function span(t0, t1) {
  const a = when(t0);
  const b = when(t1);
  return a === b ? a : `${a} to ${b}`;
}
const S = (x) => `{{s:${round(x, 1)}}}`;
const R = (a, b) => `{{r:${round(a, 1)},${round(b, 1)}}}`;
const T = (f) => `{{t:${Math.round(f)}}}`;
const W = (mph) => `{{w:${Math.round(mph)}}}`;
const E = (ft) => `{{e:${Math.round(ft / 100) * 100}}}`;
const Lq = (inch) => `{{l:${round(inch, 2)}}}`;
const listTxt = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- storms ----------
// Events are runs of precipitating hours (any type), allowing 6-hour breaks.
function findStorms(H, k0) {
  const out = [];
  let cur = null;
  let gap = 0;
  for (let k = k0; k < H.snow.length; k++) {
    const wet = H.snowW[k] + H.rain[k] + H.ice[k] >= 0.01;
    if (wet) {
      if (!cur) cur = { start: k, end: k };
      cur.end = k;
      gap = 0;
    } else if (cur && ++gap > 6) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out
    .map((e) => {
      const ks = [];
      for (let k = e.start; k <= e.end; k++) ks.push(k);
      return { ...e, ks, snow: sum(ks.map((k) => H.snow[k])), snowW: sum(ks.map((k) => H.snowW[k])), rain: sum(ks.map((k) => H.rain[k])), ice: sum(ks.map((k) => H.ice[k])) };
    })
    .filter((e) => e.snow >= 1 || e.rain + e.ice >= 0.1);
}

function classify(storm, H, guide, month) {
  const items = storm.ks.map((k) => (H.dir850[k] ?? H.dir[k]) != null ? { dir: H.dir850[k] ?? H.dir[k], w: Math.max(0.005, H.snowW[k] + H.rain[k]) } : null);
  const dir = meanDir(items);
  const t850 = median(storm.ks.map((k) => H.t850[k]));
  const lakeDelta = t850 == null ? null : LAKE_C[month] - t850;
  let key = "west";
  if (dir == null) key = "west";
  else if (guide.lake && inArc(dir, guide.lake) && lakeDelta != null && lakeDelta >= 13) key = "lake";
  else if (dir >= 280 || dir < 10) key = "upslope";
  else if (dir < 130) key = "noreaster";
  else if (dir < 240) key = "southern";
  return { key, dir: round(dir, 0), t850: round(t850, 1), lakeDelta: round(lakeDelta, 0), favored: (guide.setups || []).includes(key), best: (guide.setups || [])[0] === key };
}

// ---------- day grades (operating season only) ----------
function skiHours(H, ks) {
  const pick = (a) => ks.map((k) => a[k]).filter((v) => v != null);
  const temps = pick(H.t);
  const gusts = pick(H.gust);
  const chills = ks.map((k) => windChill(H.t[k], H.wind[k])).filter((v) => v != null);
  return {
    snow: sum(ks.map((k) => H.snow[k])),
    wet: sum(ks.map((k) => H.rain[k] + H.ice[k])),
    tMax: temps.length ? Math.max(...temps) : null,
    gustMax: gusts.length ? Math.max(...gusts) : null,
    chillMin: chills.length ? Math.min(...chills) : null,
    dir: meanDir(ks.map((k) => (H.dir[k] != null ? { dir: H.dir[k], w: H.wind[k] || 1 } : null))),
  };
}

export function windChill(t, v) {
  if (t == null || v == null) return null;
  if (t > 50 || v < 3) return t;
  const p = Math.pow(v, 0.16);
  return 35.74 + 0.6215 * t - 35.75 * p + 0.4275 * t * p;
}

const holdFor = (guide, dir) => (guide.hold || 45) - (inArc(dir, guide.exposed) ? 5 : 0);

// ---------- per-resort forecast ----------
export function forecastResort({ resort, guide, timeIndex, nowK, summitModels, baseModels, ensembles, modelMeta, skill }) {
  // Track-record factors for this region from data/skill.json (1 = average).
  const factors = Object.fromEntries(Object.entries(skill?.regions?.[resort.region] || {}).map(([id, x]) => [id, x.factor]));
  const leads = timeIndex.map((_, k) => k - nowK);
  const today = timeIndex[nowK].slice(0, 10);
  const dates = [...new Set(timeIndex.map((t) => t.slice(0, 10)))].filter((d) => d >= today).slice(0, 7);
  const k0 = timeIndex.findIndex((t) => t.startsWith(today));
  const month = Number(today.slice(5, 7));
  const sea = season(resort, today);

  // Upper-air fill: median across models that carry it.
  const fillFrom = (models, f) => timeIndex.map((t) => median(models.map((m) => m.rawAt(t, f))));
  const fill850 = fillFrom(summitModels, "t850");
  const fill700 = fillFrom(summitModels, "t700");

  const sm = summitModels.map((m) => ({ id: m.id, hours: processModel(m.raw, resort.summit, fill850, fill700, timeIndex) }));
  const bm = baseModels.map((m) => ({ id: m.id, hours: processModel(m.raw, resort.base, fill850, fill700, timeIndex) }));
  const S_ = blend(sm, timeIndex, leads, dates, factors);
  const B_ = blend(bm, timeIndex, leads, dates, factors);
  const H = S_.H;
  const HB = B_.H;
  // Mid-mountain, halfway up: interpolated between summit and base, with the
  // rain/snow split from the halfway snowmaking (wet bulb) temperature.
  const HM = { t: [], tw: [], snow: [], rain: [] };
  for (let k = 0; k < timeIndex.length; k++) {
    const avg = (a, b) => (a == null ? b : b == null ? a : (a + b) / 2);
    const t = avg(H.t[k], HB.t[k]);
    const tw = avg(H.tw[k], HB.tw[k]);
    const liq = ((H.snowW[k] || 0) + (H.rain[k] || 0) + (H.ice[k] || 0) + (HB.snowW?.[k] || 0) + (HB.rain[k] || 0) + (HB.ice[k] || 0)) / 2;
    const frac = tw == null ? 0 : tw <= 31 ? 1 : tw >= 34 ? 0 : (34 - tw) / 3;
    const slrS = H.snowW[k] > 0.001 ? H.snow[k] / H.snowW[k] : null;
    const slrB = HB.snowW?.[k] > 0.001 ? HB.snow[k] / HB.snowW[k] : null;
    const slr = slrS && slrB ? (slrS + slrB) / 2 : slrS || slrB || 10;
    HM.t.push(t);
    HM.tw.push(tw);
    HM.snow.push(liq * frac * slr);
    HM.rain.push(liq * (1 - frac));
  }
  const dayKs = (d) => timeIndex.map((t, k) => (t.startsWith(d) ? k : -1)).filter((k) => k >= 0);

  // Ensemble members at the summit.
  const ens = ensembles && ensembles.length ? ensembleStats(ensembles, H) : null;
  const TH = [1, 3, 6, 12, 18];

  // ---- days ----
  const days = dates.map((d, i) => {
    const ks = dayKs(d);
    const c = S_.days[d] || { snow: 0, lo: 0, hi: 0, rain: 0, ice: 0, models: 0 };
    const b = B_.days[d] || { snow: 0, rain: 0, ice: 0 };
    const temps = ks.map((k) => H.t[k]).filter((v) => v != null);
    const btemps = ks.map((k) => HB.t[k]).filter((v) => v != null);
    const gusts = ks.map((k) => H.gust[k]).filter((v) => v != null);
    const clouds = ks.filter((k) => Number(timeIndex[k].slice(11, 13)) >= 9 && Number(timeIndex[k].slice(11, 13)) <= 16).map((k) => H.cloud[k]).filter((v) => v != null);
    // Overnight: 4pm the day before to 9am.
    const prevKs = dayKs(addDays(d, -1)).filter((k) => Number(timeIndex[k].slice(11, 13)) >= 16);
    const onKs = [...prevKs, ...ks.filter((k) => Number(timeIndex[k].slice(11, 13)) < 9)];
    const spread = c.hi - c.lo;
    let conf = "high";
    if (spread > Math.max(3, c.snow * 0.8)) conf = "low";
    else if (spread > Math.max(1.5, c.snow * 0.4)) conf = "medium";
    const snowW = sum(ks.map((k) => H.snowW[k]));
    const sm27 = ks.filter((k) => H.tw[k] != null && H.tw[k] <= 27).length;
    const bm27 = ks.filter((k) => HB.tw[k] != null && HB.tw[k] <= 27).length;
    return {
      date: d,
      snow: round(c.snow),
      lo: round(c.lo),
      hi: round(c.hi),
      conf,
      models: c.models,
      rain: round(c.rain, 2),
      ice: round(c.ice, 2),
      baseRain: round(b.rain + b.ice, 2),
      baseSnow: round(b.snow),
      midSnow: round(sum(ks.map((k) => HM.snow[k]))),
      midRain: round(sum(ks.map((k) => HM.rain[k])), 2),
      slr: snowW > 0.02 ? round(c.snow / Math.max(snowW, 1e-6), 0) : null,
      tMax: temps.length ? round(Math.max(...temps), 0) : null,
      tMin: temps.length ? round(Math.min(...temps), 0) : null,
      bMax: btemps.length ? round(Math.max(...btemps), 0) : null,
      bMin: btemps.length ? round(Math.min(...btemps), 0) : null,
      gustMax: gusts.length ? round(Math.max(...gusts), 0) : null,
      cloud: clouds.length ? round(median(clouds), 0) : null,
      // Summit in the clouds during lift hours: near-saturated air under overcast.
      fog: ks.filter((k) => { const h = Number(timeIndex[k].slice(11, 13)); return h >= 9 && h <= 16 && (H.rh[k] ?? 0) >= 96 && (H.cloud[k] ?? 0) >= 90; }).length,
      overnight: round(sum(onKs.map((k) => H.snow[k]))),
      smHours: sm27,
      smBase: bm27,
      prob: ens && i < 7 ? probAtLeast(ens, ks[0], ks[ks.length - 1], [1, 3, 6]) : null,
      _ks: ks,
    };
  });

  // ---- storms ----
  const storms = findStorms(H, k0).map((st) => {
    const setup = classify(st, H, guide, month);
    const perModel = sm.map((m) => ({ id: m.id, total: sum(st.ks.map((k) => m.hours[k]?.snow)), n: st.ks.filter((k) => m.hours[k]).length }))
      .filter((x) => x.n >= st.ks.length * 0.8);
    const snowHours = st.ks.filter((k) => H.snow[k] >= 0.05);
    const peakK = st.ks.reduce((a, k) => (H.snow[k] > H.snow[a] ? k : a), st.ks[0]);
    const prob = ens ? probAtLeast(ens, st.start, st.end, TH) : null;
    return {
      start: timeIndex[st.start],
      end: timeIndex[st.end],
      _ks: st.ks,
      total: round(st.snow),
      lo: round(perModel.length ? Math.min(...perModel.map((x) => x.total)) : st.snow),
      hi: round(perModel.length ? Math.max(...perModel.map((x) => x.total)) : st.snow),
      rain: round(st.rain, 2),
      ice: round(st.ice, 2),
      baseRain: round(sum(st.ks.map((k) => HB.rain[k] + HB.ice[k])), 2),
      baseSnow: round(sum(st.ks.map((k) => HB.snow[k]))),
      slr: st.snowW > 0.02 ? round(st.snow / st.snowW, 0) : null,
      peakRate: round(H.snow[peakK], 2),
      peakTime: timeIndex[peakK],
      snowHours: snowHours.length,
      setup,
      models: perModel.map((x) => ({ id: x.id, total: round(x.total) })),
      prob,
    };
  });

  // ---- snowmaking windows (summit wet bulb ≤ 27°F, at least 4 hours) ----
  const windows = [];
  let cur = null;
  for (let k = k0; k < timeIndex.length; k++) {
    const ok = H.tw[k] != null && H.tw[k] <= 27;
    if (ok) {
      if (!cur) cur = { s: k, e: k, gap: 0 };
      cur.e = k;
      cur.gap = 0;
    } else if (cur && ++cur.gap > 1) {
      windows.push(cur);
      cur = null;
    }
  }
  if (cur) windows.push(cur);
  const smWindows = windows
    .map((w) => {
      const ks = [];
      for (let k = w.s; k <= w.e; k++) ks.push(k);
      return {
        start: timeIndex[w.s],
        end: timeIndex[w.e],
        hours: ks.filter((k) => H.tw[k] <= 27).length,
        good: ks.filter((k) => H.tw[k] <= 22).length,
        minTw: round(Math.min(...ks.map((k) => H.tw[k]).filter((v) => v != null)), 0),
        baseHours: ks.filter((k) => HB.tw[k] != null && HB.tw[k] <= 27).length,
      };
    })
    .filter((w) => w.hours >= 4);
  const smHours7 = sum(days.map((d) => d.smHours));

  // ---- grades and powder (only when the lifts are turning) ----
  if (sea.operating) {
    days.forEach((d, i) => {
      const ks = d._ks.filter((k) => {
        const h = Number(timeIndex[k].slice(11, 13));
        return h >= 8 && h <= 16;
      });
      const ski = skiHours(H, ks);
      const prevKs = dayKs(addDays(d.date, -1));
      const prevWet = sum(prevKs.map((k) => H.rain[k] + H.ice[k]));
      const prevWarmHrs = prevKs.filter((k) => H.t[k] != null && H.t[k] >= 38).length;
      const prevBaseWet = sum(prevKs.map((k) => HB.rain[k] + HB.ice[k])) >= 0.1 || prevKs.filter((k) => HB.t[k] != null && HB.t[k] >= 40).length >= 4;
      const nightKs = [...prevKs.filter((k) => Number(timeIndex[k].slice(11, 13)) >= 18), ...d._ks.filter((k) => Number(timeIndex[k].slice(11, 13)) < 8)];
      const hardFreeze = nightKs.filter((k) => H.tw[k] != null && H.tw[k] <= 28).length >= 3;
      let score = 66;
      const why = [];
      if (d.overnight >= 1) { score += Math.min(30, d.overnight * 4); why.push(`${S(d.overnight)} fresh`); }
      if (ski.snow >= 1) { score += Math.min(10, ski.snow * 1.5); why.push("snowing"); }
      const baseWetSki = sum(ks.map((k) => HB.rain[k] + HB.ice[k]));
      if (ski.wet > 0.05) { score -= 35; why.push("rain"); }
      else if (baseWetSki > 0.05) { score -= 18; why.push("rain lower down"); }
      else if (d.rain + d.ice > 0.1) { score -= 8; why.push("rain later"); }
      let ice = false;
      if ((prevWet >= 0.1 || prevWarmHrs >= 4) && hardFreeze && ski.tMax != null && ski.tMax <= 32 && d.overnight < 2) {
        score -= 20;
        ice = true;
        why.push("refrozen, firm");
      } else if ((prevWet >= 0.1 || prevWarmHrs >= 4) && hardFreeze && ski.tMax != null && ski.tMax > 34 && d.overnight < 2) {
        score -= 6;
        why.push("firm early, softens");
      } else if (prevBaseWet && hardFreeze && d.overnight < 2) {
        score -= 6;
        why.push("firm lower mountain");
      }
      const hold = holdFor(guide, ski.dir);
      if (ski.gustMax != null && ski.gustMax >= hold) { score -= 15; why.push("lift holds likely"); }
      else if (ski.gustMax != null && ski.gustMax >= hold - 10) { score -= 5; why.push("breezy"); }
      if (ski.chillMin != null && ski.chillMin <= -20) { score -= 15; why.push("brutal wind chill"); }
      else if (ski.chillMin != null && ski.chillMin <= -5) { score -= 7; why.push("very cold"); }
      if (d.cloud != null && d.cloud < 40 && (ski.gustMax ?? 0) < 25 && ski.wet < 0.02 && !ice) { score += 6; why.push("bluebird"); }
      score = clamp(Math.round(score), 0, 100);
      d.grade = { score, letter: score >= 85 ? "A" : score >= 72 ? "B" : score >= 58 ? "C" : score >= 45 ? "D" : "F", why, ice };
      d.windHold = ski.gustMax != null && ski.gustMax >= hold;
      d.skiGust = ski.gustMax != null ? round(ski.gustMax, 0) : null;
      d.skiDir = ski.dir != null ? round(ski.dir, 0) : null;

      // Powder: overnight snow, light snow, no rain, models agree, not blown away.
      let p = 0;
      if (d.overnight >= 1) {
        p = Math.min(70, d.overnight * 7);
        if (d.slr != null && d.slr >= 14) p += 10;
        if (d.rain + d.ice < 0.03) p += 10;
        if (d.conf === "high") p += 10;
        else if (d.conf === "low") p -= 10;
        if (d.rain + d.ice > 0.15) p -= 30;
        if ((ski.gustMax ?? 0) >= 40) p -= 10;
      }
      d.powder = clamp(Math.round(p), 0, 100);
    });
  }

  // ---- totals ----
  const k7 = days[days.length - 1]._ks.slice(-1)[0];
  const k3 = days[Math.min(2, days.length - 1)]._ks.slice(-1)[0];
  const modelTotals = sm.map((m) => ({ id: m.id, total: sum(days.map((d) => S_.perModelDays[sm.indexOf(m)][d.date]?.snow ?? 0)), full: days.every((d) => S_.perModelDays[sm.indexOf(m)][d.date]) }));
  const full = modelTotals.filter((x) => x.full);
  const total7 = sum(days.map((d) => d.snow));
  const total3 = sum(days.slice(0, 3).map((d) => d.snow));
  const prob7 = ens ? probAtLeast(ens, k0, k7, TH) : null;
  const prob3 = ens ? probAtLeast(ens, k0, k3, TH) : null;
  const pct = ens
    ? { p10: round(percentile(ens, (m) => sum(m.snow.slice(k0, k7 + 1)), 0.1)), p50: round(percentile(ens, (m) => sum(m.snow.slice(k0, k7 + 1)), 0.5)), p90: round(percentile(ens, (m) => sum(m.snow.slice(k0, k7 + 1)), 0.9)) }
    : null;
  const depthNow = H.sd[nowK];
  // What already fell: the blend over the past week is close to an analysis.
  const back = (a, h) => sum(a.slice(Math.max(0, nowK - h), nowK));
  const recent = nowK >= 24 ? { hours: Math.min(168, nowK), snow7: round(back(H.snow, 168)), snow2: round(back(H.snow, 48)), rain7: round(back(H.rain, 168) + back(H.ice, 168), 2), baseSnow7: round(back(HB.snow, 168)) } : null;

  const res = {
    id: resort.id,
    season: { ...sea, depth: depthNow != null ? round(depthNow, 0) : null },
    recent,
    pastDays: (() => {
      const out = {};
      for (let k = 0; k < k0; k++) {
        const d = timeIndex[k].slice(0, 10);
        out[d] = (out[d] || 0) + (H.snow[k] || 0);
      }
      return Object.entries(out).map(([date, v]) => [date, round(v)]);
    })(),
    total3: round(total3),
    total7: round(total7),
    lo7: round(full.length ? Math.min(...full.map((x) => x.total)) : total7),
    hi7: round(full.length ? Math.max(...full.map((x) => x.total)) : total7),
    prob3,
    prob7,
    ens7: pct,
    days: days.map(({ _ks, ...d }) => d),
    storms: storms.map(({ _ks, ...s }) => s),
    snowmaking: { hours7: smHours7, windows: smWindows },
  };
  if (sea.operating) {
    const best = res.days.slice(1, 4).map((d, i) => ({ k: i + 1, score: d.powder })).sort((a, b) => b.score - a.score)[0];
    res.best = best;
    res.bestDay = res.days.map((d, k) => ({ k, score: d.grade.score, letter: d.grade.letter })).sort((a, b) => b.score - a.score || a.k - b.k)[0];
  }

  const ctx = { resort, guide, H, HB, timeIndex, storms, days, res, sea, month, ens, k0, sm, modelMeta };
  res.insights = insights(ctx);
  res.flags = flags(ctx);
  res.summary = res.insights.slice(0, 4).map((x) => x.text).join(" ");

  // Hourly detail from today 00:00 for the resort page.
  const slice = (a, d = 1) => a.slice(k0).map((v) => (v == null ? null : round(v, d)));
  const cum = (arr) => {
    let run = 0;
    return arr.slice(k0).map((v) => (v == null ? null : round((run += v), 1)));
  };
  res.detail = {
    time: timeIndex.slice(k0),
    summit: { fog: H.rh.slice(k0).map((v, i) => (v ?? 0) >= 96 && (H.cloud[k0 + i] ?? 0) >= 90 ? 1 : 0), cloud: slice(H.cloud, -1), snow: slice(H.snow, 2), rain: slice(H.rain, 2), ice: slice(H.ice, 2), t: slice(H.t, 0), tw: slice(H.tw, 0), gust: slice(H.gust, 0), wind: slice(H.wind, 0), dir: slice(H.dir, 0), fzl: slice(H.fzl, -2), type: H.type.slice(k0), t850: slice(H.t850, 1) },
    base: { snow: slice(HB.snow, 2), rain: slice(HB.rain, 2), t: slice(HB.t, 0), tw: slice(HB.tw, 0), type: HB.type.slice(k0) },
    mid: { snow: slice(HM.snow, 2), t: slice(HM.t, 0) },
    models: sm.map((m) => ({ id: m.id, cum: cum(m.hours.map((h) => (h ? h.snow : null))) })),
    modelDays: sm.map((m, j) => ({ id: m.id, days: res.days.map((d) => (S_.perModelDays[j][d.date] ? round(S_.perModelDays[j][d.date].snow) : null)) })),
    ens: ens
      ? (() => {
          const n = timeIndex.length - k0;
          const cums = ens.map((m) => {
            let run = 0;
            return { w: m.w, c: m.snow.slice(k0).map((v) => (run += v)) };
          });
          const band = (q) => Array.from({ length: n }, (_, i) => round(percentile(cums, (m) => m.c[i], q), 1));
          return { p10: band(0.1), p50: band(0.5), p90: band(0.9), members: ens.length };
        })()
      : null,
  };
  return res;
}

// ---------- insights ----------
// Specific, data-driven sentences, most useful first. Each has a priority so the
// summary can lead with what matters.
function insights(c) {
  const { resort, guide, H, HB, timeIndex, storms, days, sea, month, ens, sm, modelMeta, res } = c;
  const out = [];
  const add = (pri, text, kind) => out.push({ pri, text, kind });
  const label = (id) => (modelMeta.find((m) => m.id === id) || { label: id }).label;
  const snowStorms = storms.filter((s) => s.total >= 1);
  const main = [...snowStorms].sort((a, b) => b.total - a.total)[0];

  // Pre-season and closed: what matters is cold enough to make snow, and whether
  // any natural snow sticks.
  if (!sea.operating) {
    const w = [...res.snowmaking.windows].sort((a, b) => b.hours - a.hours);
    if (sea.phase === "closed") add(1, `Closed for the season.`, "season");
    if (w.length) {
      const top = w[0];
      const more = w.length > 1 ? ` ${w.length - 1} more ${w.length === 2 ? "window follows" : "windows follow"} this week.` : "";
      add(9, `Snow guns can run ${span(top.start, top.end)}: about ${top.hours} hours cold enough at the summit, getting down to ${T(top.minTw)} once humidity is factored in${top.baseHours >= 3 ? `. The base is cold enough for ${top.baseHours} of those hours` : ". The base stays too warm"}.${more}`, "snowmaking");
    } else {
      const minTw = Math.min(...days.map((d, i) => {
        const ks = timeIndex.map((t, k) => (t.startsWith(d.date) ? k : -1)).filter((k) => k >= 0);
        return Math.min(...ks.map((k) => H.tw[k] ?? 99));
      }));
      add(8, minTw <= 27
        ? `No real snowmaking window this week: the summit only gets cold enough for a few hours. Snow guns need several hours around ${T(27)} or colder (factoring in humidity).`
        : `Too warm for snowmaking this week. Snow guns need about ${T(27)} or colder once humidity is factored in; the summit only gets to about ${T(minTw)}.`, "snowmaking");
    }
    const flakes = [...storms].filter((x) => x.total >= 0.5).sort((a, b) => b.total - a.total)[0];
    if (flakes) {
      const main = flakes;
      const after = afterStorm(c, main);
      const rainFirst = "";
      const stick = after.maxT != null && after.maxT >= 40 ? ` It won't last: highs reach ${T(after.maxT)} ${after.when}.` : after.maxT != null ? ` Highs stay near ${T(after.maxT)} afterward, so some of it should stick up high.` : "";
      add(10, `${main.total >= 3 ? "Accumulating snow" : "First flakes"}: about ${S(main.total)} at the summit ${span(main.start, main.end)} (models ${R(main.lo, main.hi)}).${rainFirst}${snowLine(c, main)}${stick}`, "storm");
    }
    if (sea.phase === "preseason") add(2, `Typically opens around ${fmtDate(sea.open)}, ${sea.daysToOpen} days out. Openings depend on snowmaking nights, not the calendar.`, "season");
    return out.sort((a, b) => b.pri - a.pri);
  }

  // ---- storms ----
  snowStorms.slice(0, 3).forEach((s) => {
    const isMain = s === main;
    const pri = isMain ? 10 : 6;
    let text = `${isMain ? (snowStorms.length > 1 ? "Main storm" : "Snow") : "Another round"} ${span(s.start, s.end)}: ${S(s.total)} at the summit (models ${R(s.lo, s.hi)}).`;
    if (s.prob) {
      const ths = [3, 6, 12, 18].filter((t) => s.prob[t] >= 10);
      const pick = ths.slice(-2);
      if (pick.length) text += ` Odds: ${pick.map((t) => `${s.prob[t]}% chance of ${S(t)} or more`).join(", ")}.`;
    }
    add(pri, text, "storm");
    const line = snowLine(c, s);
    if (line) add(pri - 1, line.trim(), "snowline");
    const nose = warmNose(c, s);
    if (nose) add(pri - 0.5, nose, "ice");
    if (isMain && s.peakRate >= 0.5) add(5, `Heaviest snow ${when(s.peakTime)}, near ${S(s.peakRate)} an hour.`, "rate");
    if (isMain && s.slr != null) {
      if (s.slr >= 15) add(5, `It's cold all the way up (about ${T(cToF(s.setup.t850 ?? -12))} a mile overhead), so expect light, fluffy snow that skis deep.`, "quality");
      else if (s.slr <= 9) add(5, `Expect heavy, wet snow: great for building a base, but tiring to ski.`, "quality");
    }
    if (isMain) {
      const o = outlier(s, label);
      if (o) add(7, o, "models");
      const hr = hiresSplit(c, s, label);
      if (hr) add(7, hr, "models");
    }
    const setupTxt = setupInsight(c, s, isMain);
    if (setupTxt) add(isMain ? 8 : 5, setupTxt, "setup");
  });

  // Big rain with no snow.
  const rainStorm = storms.filter((s) => s.total < 1 && s.rain + s.ice >= 0.25)[0];
  if (rainStorm) {
    const s = rainStorm;
    const ks = timeIndex.map((t, k) => (t >= s.start && t <= s.end ? k : -1)).filter((k) => k >= 0);
    const maxT = Math.max(...ks.map((k) => H.t[k] ?? -99));
    const after = main && main.end < s.start ? " Ski the new snow before it arrives." : "";
    add(9, `Rain ${span(s.start, s.end)}: about ${Lq(s.rain + s.ice)} of liquid with summit temps up to ${T(maxT)}.${s.ice >= 0.1 ? " Some of it falls as freezing rain or sleet." : ""}${after}`, "rain");
  }
  if (!snowStorms.length) {
    const dry = storms.length === 0;
    add(8, `${dry ? "Dry week" : "No meaningful snow this week"}. ${res.snowmaking.hours7 >= 12 ? `Snowmaking gets ${res.snowmaking.hours7} hours of cold enough air to resurface trails.` : "Too mild for much snowmaking."}`, "storm");
  }

  // ---- after the main storm ----
  if (main) {
    const a = afterStorm(c, main);
    if (a.rainAfter >= 0.1 && !rainStorm) add(8, `A thaw follows: rain and ${T(a.maxT)} ${a.when}. Ski the new snow early.`, "thaw");
  }

  // ---- ice and wind ----
  const iceDay = days.find((d) => d.grade && d.grade.ice);
  if (iceDay) add(7, `Firm, refrozen surfaces ${WEEKDAY(iceDay.date)} morning after the rain and an overnight freeze. Groomers will be fastest; soft snow is unlikely.`, "ice");
  const windDays = days.filter((d) => d.windHold);
  if (windDays.length) {
    const d = windDays[0];
    add(6, `Gusts near ${W(d.skiGust)} from the ${compass(d.skiDir)} during lift hours ${WEEKDAY(d.date)}${windDays.length > 1 ? ` (and ${windDays.length - 1} more day${windDays.length > 2 ? "s" : ""})` : ""}. ${(guide.hold || 45) >= 50 ? "Even this sheltered mountain may slow its lifts." : guide.wind ? guide.wind.split(".")[0] + "." : "Upper lifts may hold."}`, "wind");
  }

  // ---- best day ----
  if (res.bestDay) {
    const d = days[res.bestDay.k];
    add(3, `Best day to ski: ${WEEKDAY(d.date)} (${res.bestDay.letter}${d.grade.why.length ? `, ${d.grade.why.slice(0, 2).join(", ")}` : ""}).`, "best");
  }
  if (sea.phase === "early") add(2, `Early season: expect limited terrain on mostly manmade snow.`, "season");
  return out.sort((a, b) => b.pri - a.pri);
}

function fmtDate(iso) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// How the rain/snow line plays out across the mountain during a storm.
function snowLine(c, s) {
  const { H, HB, resort, timeIndex } = c;
  const ks = timeIndex.map((t, k) => (t >= s.start && t <= s.end ? k : -1)).filter((k) => k >= 0);
  const wet = (h, k) => h.rain[k] + h.ice[k];
  const summitRainKs = ks.filter((k) => H.rain[k] >= 0.01 && H.rain[k] > H.snowW[k]);
  const baseRainKs = ks.filter((k) => HB.rain[k] >= 0.01 && HB.rain[k] > HB.snowW[k]);
  const fzl = median(ks.filter((k) => wet(HB, k) + HB.snowW[k] > 0.01).map((k) => H.fzl[k]));
  const level = fzl != null ? Math.max(0, fzl - 1000) : null;
  if (summitRainKs.length >= 2) {
    const snowKs = ks.filter((k) => H.snowW[k] >= 0.01 && H.snowW[k] >= H.rain[k]);
    if (snowKs.length >= 2 && median(snowKs) > median(summitRainKs)) {
      const firstSnow = snowKs.find((k) => k > summitRainKs[Math.floor(summitRainKs.length / 2)]) ?? snowKs[0];
      return ` It starts as rain (${Lq(s.rain)}), even at the summit, then changes to snow ${when(timeIndex[firstSnow])} as colder air arrives.`;
    }
    const first = timeIndex[summitRainKs[0]];
    return ` Rain reaches the summit ${when(first)}${level != null && level < 7000 ? ` as the snow level climbs to about ${E(Math.max(level, resort.summit))}` : ""}.`;
  }
  if (baseRainKs.length >= 2 && s.total >= 1) {
    const first = timeIndex[baseRainKs[0]];
    const lead = level != null && level > resort.base && level < resort.summit ? ` Snow level near ${E(level)}, so the base` : " The base";
    return `${lead} (${E(resort.base)}) mixes with or changes to rain ${when(first)}: about ${S(s.baseSnow)} there vs ${S(s.total)} up top.`;
  }
  if (s.total >= 1 && s.baseSnow >= s.total * 0.6) return ` All snow top to bottom.`;
  return "";
}

// Sleet / freezing rain from a warm layer aloft over cold surface air.
function warmNose(c, s) {
  const { H, HB, timeIndex } = c;
  const ks = timeIndex.map((t, k) => (t >= s.start && t <= s.end ? k : -1)).filter((k) => k >= 0);
  const iceKs = ks.filter((k) => H.ice[k] >= 0.01 || HB.ice[k] >= 0.01);
  if (iceKs.length < 2) return null;
  const zr = iceKs.some((k) => H.type[k] === "zr" || HB.type[k] === "zr");
  const warm = Math.max(...iceKs.map((k) => H.t850[k] ?? -99));
  return `${zr ? "Freezing rain" : "Sleet"} risk ${when(timeIndex[iceKs[0]])}: air about a mile up warms to ${T(cToF(warm))} while the slopes stay below freezing. Expect ${zr ? "a glaze" : "pellets"} rather than snow for part of the storm.`;
}

function afterStorm(c, s) {
  const { H, timeIndex } = c;
  const endK = timeIndex.indexOf(s.end);
  const ks = [];
  for (let k = endK + 1; k < Math.min(timeIndex.length, endK + 73); k++) ks.push(k);
  if (!ks.length) return { maxT: null, rainAfter: 0, when: "" };
  const maxK = ks.reduce((a, k) => ((H.t[k] ?? -99) > (H.t[a] ?? -99) ? k : a), ks[0]);
  return { maxT: H.t[maxK], when: WEEKDAY(timeIndex[maxK].slice(0, 10)), rainAfter: sum(ks.map((k) => H.rain[k])) };
}

function outlier(s, label) {
  const ms = s.models.filter((m) => m.total != null);
  if (ms.length < 4) return null;
  const sorted = [...ms].sort((a, b) => b.total - a.total);
  const hi = sorted[0];
  const rest = sorted.slice(1).map((m) => m.total);
  const medRest = median(rest);
  if (hi.total - medRest >= 3 && hi.total >= medRest * 1.6) {
    return `${label(hi.id)} is the high outlier at ${S(hi.total)}; the other ${rest.length} models cluster around ${R(Math.min(...rest), Math.max(...rest))}. The forecast leans on the cluster.`;
  }
  const lo = sorted[sorted.length - 1];
  const restLo = sorted.slice(0, -1).map((m) => m.total);
  const medLo = median(restLo);
  if (medLo >= 4 && lo.total <= medLo * 0.4) return `${label(lo.id)} is the low outlier at ${S(lo.total)}, keeping a lighter outcome on the table.`;
  return null;
}

// High-res vs global split, only meaningful inside the high-res range.
function hiresSplit(c, s, label) {
  const { modelMeta, timeIndex } = c;
  const hires = s.models.filter((m) => modelMeta.find((x) => x.id === m.id)?.hires);
  const glob = s.models.filter((m) => !modelMeta.find((x) => x.id === m.id)?.hires);
  if (hires.length < 2 || glob.length < 2) return null;
  const a = median(hires.map((m) => m.total));
  const b = median(glob.map((m) => m.total));
  if (Math.abs(a - b) < 2 || Math.abs(a - b) < 0.35 * Math.max(a, b)) return null;
  return `The short-range, high-resolution models (${listTxt(hires.map((m) => label(m.id)))}) show ${a > b ? "more" : "less"}: ${S(a)} vs ${S(b)} from the global models. They resolve the terrain better, so they carry extra weight this close in.`;
}

function setupInsight(c, s, isMain) {
  const { guide, resort, H, timeIndex } = c;
  const st = s.setup;
  if (!st || st.dir == null) return null;
  // Northwest "tail" after a storm of another type: light upslope snow as winds turn.
  if (st.key !== "upslope" && st.key !== "lake") {
    const ks = timeIndex.map((t, k) => (t >= s.start && t <= s.end ? k : -1)).filter((k) => k >= 0);
    const tail = ks.filter((k) => {
      const d = H.dir850[k] ?? H.dir[k];
      return d != null && (d >= 270 || d < 10) && H.snow[k] > 0.02;
    });
    const tailSnow = sum(tail.map((k) => H.snow[k]));
    if (tail.length >= 4 && tailSnow >= 0.8) {
      const endT = timeIndex[tail[tail.length - 1]];
      const t850 = median(tail.map((k) => H.t850[k]));
      if (inArc(meanDir(tail.map((k) => ({ dir: H.dir850[k] ?? H.dir[k], w: 1 }))), guide.upslope))
        return `Winds turn ${compass(meanDir(tail.map((k) => ({ dir: H.dir850[k] ?? H.dir[k], w: 1 }))))} behind the storm${t850 != null ? ` with ${T(cToF(t850))} a mile up` : ""}, and upslope snow keeps going until ${when(endT)}, adding about ${S(tailSnow)}. Global models often undercount this part.`;
      if (inArc(meanDir(tail.map((k) => ({ dir: H.dir850[k] ?? H.dir[k], w: 1 }))), guide.shadow))
        return `The northwest-flow snow behind the storm mostly falls upwind of ${resort.name}; expect little after the main storm.`;
    }
  }
  const t850F = st.t850 != null ? T(cToF(st.t850)) : null;
  if (st.key === "lake") {
    return `Flow from the ${compass(st.dir)} (${st.dir}°) lines up with the lake band${st.lakeDelta != null ? `, and the lake is far warmer than the air a mile up, which fuels heavy bands` : ""}. Band placement is the big uncertainty: totals can be double or half the forecast.`;
  }
  if (st.key === "upslope" && inArc(st.dir, guide.upslope)) {
    return `${isMain ? "This one comes" : "It comes"} on ${compass(st.dir)} flow${t850F ? ` with ${t850F} a mile up` : ""}, ${resort.name}'s upslope setup. Coarse global models tend to undercount these, so the high end of the range is in play.`;
  }
  if (inArc(st.dir, guide.shadow)) {
    return `Flow from the ${compass(st.dir)} puts ${resort.name} downwind of higher terrain, so expect the low end of the range.`;
  }
  return null;
}

// Short labels for the resort list.
function flags(c) {
  const { days, storms, res, sea } = c;
  const f = [];
  if (!sea.operating) {
    const w = [...res.snowmaking.windows].sort((a, b) => b.hours - a.hours)[0];
    if (w) f.push({ cls: "cold", text: `Snow guns ${WD(w.start.slice(0, 10))}` });
    const s = storms.find((x) => x.total >= 0.5);
    if (s) f.push({ cls: "powder", text: `Snow ${WD(s.start.slice(0, 10))}` });
    if (sea.phase === "preseason") f.push({ cls: "muted", text: `Usually opens ${fmtDate(sea.open)}` });
    else f.push({ cls: "muted", text: "Closed" });
    return f;
  }
  if (res.best && res.best.score >= 40) f.push({ cls: "powder", text: `Powder ${WD(days[res.best.k].date)}` });
  const fav = storms.find((s) => s.setup && s.setup.favored && s.total >= 1);
  if (fav) f.push({ cls: "setup", text: `${{ noreaster: "Nor'easter", lake: "Lake effect", upslope: "Upslope", southern: "Southern storm", west: "Clipper" }[fav.setup.key]} ${WD(fav.start.slice(0, 10))}` });
  const rainDay = days.find((d) => d.rain + d.ice > 0.1);
  const lowDay = days.find((d) => d.baseRain > 0.2 && d.rain + d.ice <= 0.1);
  if (rainDay) f.push({ cls: "rain", text: `${rainDay.ice > 0.05 ? "Ice" : "Rain"} ${WD(rainDay.date)}` });
  else if (lowDay) f.push({ cls: "rain", text: `Rain down low ${WD(lowDay.date)}` });
  const windDay = days.find((d) => d.windHold);
  if (windDay) f.push({ cls: "wind", text: `Windy ${WD(windDay.date)}` });
  const iceDay = days.find((d) => d.grade && d.grade.ice);
  if (iceDay) f.push({ cls: "rain", text: `Icy ${WD(iceDay.date)}` });
  return f;
}

// ---------- region headline ----------
export function headline(rows, resorts) {
  const byId = Object.fromEntries(resorts.map((r) => [r.id, r]));
  const operating = rows.filter((r) => r.season.operating);
  const snowiest = [...rows].sort((a, b) => b.total7 - a.total7)[0];
  if (!operating.length) {
    const sm = rows.filter((r) => r.snowmaking.windows.length);
    const firstOpen = [...rows].filter((r) => r.season.phase === "preseason").sort((a, b) => a.season.daysToOpen - b.season.daysToOpen)[0];
    const regions = {};
    sm.forEach((r) => (regions[byId[r.id].region] = (regions[byId[r.id].region] || 0) + r.snowmaking.hours7));
    const topRegions = Object.entries(regions).sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]);
    let title;
    let text;
    if (snowiest && snowiest.total7 >= 1) {
      const s = [...snowiest.storms].sort((a, b) => b.total - a.total)[0];
      title = `First flakes for ${byId[snowiest.id].region}.`;
      text = `Up to ${S(snowiest.total7)} on the summit of ${byId[snowiest.id].name}${s ? ` ${span(s.start, s.end)}` : ""}.`;
    } else {
      title = sm.length ? "Pre-season: snowmaking watch." : "Pre-season: still too warm.";
      text = "";
    }
    text += sm.length
      ? ` ${sm.length} of ${rows.length} resorts get cold enough nights for snow guns this week, mostly in ${listTxt(topRegions)}.`
      : ` No resort gets cold enough for snowmaking this week.`;
    if (firstOpen) text += ` ${byId[firstOpen.id].name} typically opens first, around ${fmtDate(firstOpen.season.open)}.`;
    return { title, text: text.trim() };
  }
  const regions = {};
  rows.forEach((r) => {
    const reg = byId[r.id].region;
    if (!regions[reg] || r.total7 > regions[reg].total7) regions[reg] = r;
  });
  const ranked = Object.entries(regions).sort((a, b) => b[1].total7 - a[1].total7);
  const [leadName, lead] = ranked[0];
  if (lead.total7 < 1) {
    const sm = rows.filter((r) => r.snowmaking.hours7 >= 12).length;
    return { title: "A quiet week across the East.", text: `No meaningful natural snow in the next 7 days.${sm ? ` ${sm} resorts get solid snowmaking weather.` : ""}` };
  }
  const big = [...lead.storms].sort((a, b) => b.total - a.total)[0];
  let text = `Up to ${S(lead.total7)} at ${byId[lead.id].name} over 7 days (models ${R(lead.lo7, lead.hi7)}).`;
  if (big) text += ` The main round arrives ${when(big.start)}.`;
  if (lead.prob7 && lead.prob7[6] >= 10) text += ` Ensembles give ${lead.prob7[6]}% odds of ${S(6)} or more.`;
  if (ranked[1] && ranked[1][1].total7 >= 2) text += ` ${ranked[1][0]} follows with up to ${S(ranked[1][1].total7)} at ${byId[ranked[1][1].id].name}.`;
  return { title: `${leadName} leads the week.`, text };
}

// ---------- daily regional write-ups ----------
// A short morning story per area, built only from this run's numbers so it never
// says more than the data does. Uses the same unit tokens as insights.
export const WRITEUP_AREAS = [
  { key: "vt", name: "Vermont", states: ["VT"] },
  { key: "nh", name: "New Hampshire", states: ["NH"] },
  { key: "me", name: "Maine", states: ["ME"] },
  { key: "ny", name: "New York", states: ["NY"] },
  { key: "south", name: "Massachusetts, Pennsylvania and West Virginia", short: "Mass., Pa. and W.Va.", states: ["MA", "PA", "WV"] },
];

export function writeups(rows, resorts, { nws, setups } = {}) {
  const byId = Object.fromEntries(resorts.map((r) => [r.id, r]));
  const nm = (r) => byId[r.id].name;
  const OFF = { BTV: "Burlington", GYX: "Gray", ALY: "Albany", BUF: "Buffalo", BGM: "Binghamton", PHI: "Mount Holly", CTP: "State College", PBZ: "Pittsburgh", RNK: "Blacksburg", RLX: "Charleston", BOX: "Boston", OKX: "New York" };
  return WRITEUP_AREAS.map((area) => {
    const R_ = rows.filter((r) => area.states.includes(byId[r.id].state));
    if (!R_.length) return null;
    const open = R_.filter((r) => r.season.operating);
    const dates = R_[0].days.map((d) => d.date);
    const paras = [];
    const by7 = [...R_].sort((a, b) => b.total7 - a.total7);
    const top = by7[0];

    // The main event: the biggest storm among these mountains.
    const storms = R_.flatMap((r) => r.storms.filter((s) => s.total >= 0.5).map((s) => ({ r, s }))).sort((a, b) => b.s.total - a.s.total);
    const main = storms[0];
    let title;
    if (main && main.s.total >= 6) title = `${cap(when(main.s.start).replace(/^early /, ""))} storm: up to ${S(main.s.total)} at ${nm(main.r)}.`;
    else if (main && main.s.total >= 2) title = `Some snow ${when(main.s.start)}, best at ${nm(main.r)}.`;
    else if (main) title = `Just a coating for the high peaks.`;
    else if (!open.length) title = R_.some((r) => r.snowmaking.hours7 >= 12) ? "Dry, with snowmaking nights." : "Quiet and too mild for snow guns.";
    else title = "A dry stretch.";

    if (main) {
      const same = storms.filter((x) => Math.abs(Date.parse(x.s.start) - Date.parse(main.s.start)) < 30 * 3600000);
      const leaders = [];
      for (const x of same) if (!leaders.some((y) => y.r === x.r) && leaders.length < 3) leaders.push(x);
      let p = `The main event runs ${span(main.s.start, main.s.end)}. ${leaders.map((x) => `${nm(x.r)} ${S(x.s.total)}`).join(", ")} at the summits`;
      p += main.s.hi - main.s.lo >= 3 ? `, though the models range from ${R(main.s.lo, main.s.hi)} at ${nm(main.r)}.` : ".";
      const setup = setups?.[main.s.setup?.key];
      if (setup && main.s.total >= 2) {
        const fav = same.filter((x) => x.s.setup?.favored).map((x) => nm(x.r));
        p += ` It's a ${setup.label.toLowerCase()} setup${fav.length ? `, one that usually favors ${listTxt(fav.slice(0, 3))}` : ""}.`;
      }
      const wet = same.filter((x) => x.s.baseRain >= 0.2 || x.s.rain >= 0.2);
      if (wet.length) p += ` Rain mixes in ${wet.some((x) => x.s.rain >= 0.2) ? "even up high at times" : "at the bases"}.`;
      const p6 = main.s.prob?.[6];
      if (p6 != null && main.s.total >= 4) p += p6 >= 70 ? ` Confidence is high: ${p6}% of ensemble runs give ${nm(main.r)} ${S(6)} or more.` : p6 >= 35 ? ` Confidence is moderate (${p6}% odds of ${S(6)}+).` : ` Confidence is low so far (${p6}% odds of ${S(6)}+), so expect changes.`;
      paras.push(p);
    }

    // The next two days at a glance.
    const d2 = (r) => r.days.slice(0, 2);
    const hi = Math.max(...R_.flatMap((r) => d2(r).map((d) => d.tMax ?? -99)));
    const lo = Math.min(...R_.flatMap((r) => d2(r).map((d) => d.tMin ?? 99)));
    const gust = Math.max(...R_.flatMap((r) => d2(r).map((d) => d.gustMax ?? 0)));
    const snow2 = Math.max(...R_.map((r) => sum(d2(r).map((d) => d.snow))));
    const rain2 = Math.max(...R_.map((r) => sum(d2(r).map((d) => d.rain + d.ice))));
    let p2 = `Next two days: summit temperatures from ${T(lo)} to ${T(hi)}`;
    if (snow2 >= 0.5) p2 += `, with up to ${S(snow2)} of snow`;
    else if (rain2 >= 0.1) p2 += `, with rain at times`;
    else p2 += ", mostly dry";
    p2 += gust >= 40 ? ` and gusts near ${W(gust)} up top.` : ".";
    paras.push(p2);

    // Skiing or snowmaking.
    if (open.length) {
      const best = [...open].sort((a, b) => b.bestDay.score - a.bestDay.score || b.total3 - a.total3)[0];
      const d = best.days[best.bestDay.k];
      paras.push(`Best ski day: ${WEEKDAY(d.date)} at ${nm(best)} (${best.bestDay.letter}).${d.overnight >= 1 ? ` About ${S(d.overnight)} falls overnight before first chair.` : ""}`);
    } else {
      const sm = [...R_].sort((a, b) => b.snowmaking.hours7 - a.snowmaking.hours7);
      const firstOpen = [...R_].filter((r) => r.season.phase === "preseason").sort((a, b) => a.season.daysToOpen - b.season.daysToOpen)[0];
      let p = sm[0].snowmaking.hours7 >= 4 ? `Snowmaking: ${nm(sm[0])} gets the most hours cold enough for snow guns this week (${sm[0].snowmaking.hours7}).` : "Snowmaking: too warm for snow guns this week.";
      if (firstOpen) p += ` ${nm(firstOpen)} usually opens first here, around ${fmtDate(firstOpen.season.open)}.`;
      paras.push(p);
    }

    // How the forecast has moved.
    const trends = R_.filter((r) => r.trend && Math.abs(r.trend.now - r.trend.was) >= 1.5);
    if (trends.length) {
      const up = trends.filter((r) => r.trend.now > r.trend.was);
      paras.push(up.length >= trends.length / 2 ? `Trend: totals have gone up since yesterday, led by ${nm(up[0])} (${S(up[0].trend.was)} to ${S(up[0].trend.now)}).` : `Trend: totals have come down since yesterday.`);
    }

    // What the NWS forecasters and warnings say.
    const offices = [...new Set(R_.map((r) => nws?.resortOffice?.[r.id]).filter(Boolean))];
    const warned = R_.filter((r) => (nws?.alerts?.[r.id] || []).length);
    if (warned.length) paras.push(`The NWS has a ${nws.alerts[warned[0].id][0].event} for ${listTxt(warned.slice(0, 4).map(nm))}.`);
    const afd = offices.map((o) => ({ o, a: nws?.offices?.[o] })).find((x) => x.a?.excerpt);
    if (afd) {
      const first = afd.a.excerpt.split("\n").find((l) => l.length > 30 && !/^as of|^issued/i.test(l));
      if (first) paras.push(`NWS ${OFF[afd.o] || afd.o} forecasters: "${first.replace(/\s+/g, " ").trim()}"`);
    }

    // Days 8–14 from the Climate Prediction Center.
    let outlook = null;
    const cpc = nws?.cpc?.areas?.[area.key];
    if (cpc?.temp || cpc?.precip) {
      const word = (c, kind) => {
        const x = String(c || "").toLowerCase();
        if (x.startsWith("a")) return kind === "temp" ? "warmer than normal" : "wetter than normal";
        if (x.startsWith("b")) return kind === "temp" ? "colder than normal" : "drier than normal";
        if (x.startsWith("n")) return "near normal";
        return null;
      };
      const parts = ["temp", "precip"].map((k) => cpc[k] && word(cpc[k].cat, k) && `${word(cpc[k].cat, k)}${cpc[k].prob ? ` (${Math.round(cpc[k].prob)}% odds)` : ""}`).filter(Boolean);
      outlook = parts.length ? `Days 8 to 14: the NOAA outlook leans ${listTxt(parts)}.` : "Days 8 to 14: the NOAA outlook shows no clear lean either way.";
      const t = String(cpc.temp?.cat || "").toLowerCase();
      const pr = String(cpc.precip?.cat || "").toLowerCase();
      if (t.startsWith("b") && pr.startsWith("a")) outlook += " Cold and stormy is the combination powder chasers want.";
      else if (t.startsWith("a") && pr.startsWith("a")) outlook += " Wet and mild often means rain below the summits.";
      else if (t.startsWith("b")) outlook += " Good news for snowmaking.";
    }

    return { key: area.key, name: area.name, short: area.short || area.name, title, paras, outlook, top: top ? top.id : null };
  }).filter(Boolean);
}
