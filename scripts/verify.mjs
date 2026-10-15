// Grades every model against measured precipitation at weather stations near the
// resorts, then writes data/skill.json. The forecast engine uses it to lean on the
// models with the best recent track record in each region.
//
// Forecasts: Open-Meteo Previous Runs API (what each model said 1, 2 and 3 days
// before each day). Observations: daily ASOS precipitation from the Iowa
// Environmental Mesonet. Liquid precipitation is scored (rain plus melted snow)
// because it is measured the same way all year.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { MODELS } from "./engine.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "data");
const DAYS = 30;
const LEADS = [1, 2, 3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "resorts.js"), "utf8"), ctx);
const RESORTS = ctx.window.RESORTS;
const ST = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "stations.json"), "utf8"));

async function get(url, as = "json") {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (res.ok) return as === "json" ? await res.json() : await res.text();
      last = `${res.status} ${(await res.text()).slice(0, 160)}`;
    } catch (e) {
      last = String(e);
    }
    await sleep(8000 * (i + 1));
  }
  throw new Error(last);
}

const ymd = (d) => d.toISOString().slice(0, 10);

// Daily observed precipitation per station: { [station]: { [date]: inches } }.
async function observed(start, end) {
  const byNet = {};
  ST.stations.forEach((s) => (byNet[s.network] ||= []).push(s.id));
  const obs = {};
  for (const [net, ids] of Object.entries(byNet)) {
    const [y1, m1, d1] = start.split("-").map(Number);
    const [y2, m2, d2] = end.split("-").map(Number);
    const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/daily.py?network=${net}&${ids.map((i) => `stations=${i}`).join("&")}&year1=${y1}&month1=${m1}&day1=${d1}&year2=${y2}&month2=${m2}&day2=${d2}&var=precip_in&var=snow_in&format=csv`;
    const csv = await get(url, "text");
    const [head, ...lines] = csv.trim().split("\n");
    const cols = head.split(",");
    const iS = cols.indexOf("station");
    const iD = cols.indexOf("day");
    const iP = cols.indexOf("precip_in");
    const iSn = cols.indexOf("snow_in");
    if (iP < 0) throw new Error(`no precip column for ${net}: ${head}`);
    for (const line of lines) {
      const c = line.split(",");
      const raw = c[iP];
      if (raw == null || raw === "" || raw === "M" || raw === "None") continue;
      const v = raw === "T" ? 0.001 : Number(raw);
      if (!Number.isFinite(v) || v < 0) continue;
      (obs[c[iS]] ||= {})[c[iD]] = { p: v, sn: iSn >= 0 && c[iSn] && !["M", "None", ""].includes(c[iSn]) ? (c[iSn] === "T" ? 0.01 : Number(c[iSn])) : null };
    }
    await sleep(6000); // IEM asks for one request at a time.
  }
  return obs;
}

// What each model forecast for each station-day at each lead.
async function forecasts(model) {
  const hourly = ["precipitation_previous_day1", "precipitation_previous_day2", "precipitation_previous_day3"];
  const params = new URLSearchParams({
    latitude: ST.stations.map((s) => s.lat).join(","),
    longitude: ST.stations.map((s) => s.lon).join(","),
    elevation: ST.stations.map((s) => Math.round(s.elevFt * 0.3048)).join(","),
    hourly: hourly.join(","),
    models: model,
    past_days: String(DAYS + 2),
    forecast_days: "1",
    timezone: "America/New_York",
    precipitation_unit: "inch",
  });
  let json = await get(`https://previous-runs-api.open-meteo.com/v1/forecast?${params}`);
  if (!Array.isArray(json)) json = [json];
  const out = {};
  json.forEach((block, j) => {
    const h = block.hourly || {};
    const st = ST.stations[j].id;
    LEADS.forEach((L) => {
      const arr = h[`precipitation_previous_day${L}`] || h[`precipitation_previous_day${L}_${model}`] || [];
      const days = {};
      (h.time || []).forEach((t, k) => {
        const d = t.slice(0, 10);
        const v = arr[k];
        const e = (days[d] ||= { s: 0, n: 0 });
        if (v != null) {
          e.s += v;
          e.n += 1;
        }
      });
      for (const [d, e] of Object.entries(days)) if (e.n >= 22) ((out[st] ||= {})[L] ||= {})[d] = e.s;
    });
  });
  return out;
}

function score(pairs) {
  if (pairs.length < 10) return null;
  const n = pairs.length;
  const mae = pairs.reduce((a, [f, o]) => a + Math.abs(f - o), 0) / n;
  const fs_ = pairs.reduce((a, [f]) => a + f, 0);
  const os = pairs.reduce((a, [, o]) => a + o, 0);
  const wet = pairs.filter(([, o]) => o >= 0.1);
  const hits = wet.filter(([f]) => f >= 0.05).length;
  const falseAlarms = pairs.filter(([f, o]) => f >= 0.1 && o < 0.02).length;
  return {
    n,
    wetDays: wet.length,
    mae: +mae.toFixed(3),
    bias: os > 0.05 ? +(fs_ / os).toFixed(2) : null,
    hitRate: wet.length ? +(hits / wet.length).toFixed(2) : null,
    falseAlarms,
  };
}

async function main() {
  const end = new Date(Date.now() - 86400000); // yesterday: today's obs aren't complete
  const start = new Date(end.getTime() - (DAYS - 1) * 86400000);
  const S = ymd(start);
  const E = ymd(end);
  const log = [];
  const obs = await observed(S, E);
  log.push(`obs stations: ${Object.keys(obs).length}`);

  const fc = {};
  for (const m of MODELS) {
    try {
      fc[m.id] = await forecasts(m.id);
      log.push(`${m.id}: ok`);
    } catch (e) {
      log.push(`${m.id}: FAILED ${e.message}`);
    }
  }

  // Region of each station (a station can serve several resorts and regions).
  const stationRegions = {};
  RESORTS.forEach((r) => (ST.resorts[r.id] || []).forEach((s) => (stationRegions[s] ||= new Set()).add(r.region)));

  const pairsFor = (model, L, filter) => {
    const out = [];
    for (const [st, byLead] of Object.entries(fc[model] || {})) {
      if (filter && !filter(st)) continue;
      for (const [d, f] of Object.entries(byLead[L] || {})) {
        if (d < S || d > E) continue;
        const o = obs[st]?.[d];
        if (o) out.push([f, o.p]);
      }
    }
    return out;
  };

  const models = {};
  for (const m of MODELS) {
    if (!fc[m.id]) continue;
    models[m.id] = { label: m.label };
    LEADS.forEach((L) => (models[m.id][`d${L}`] = score(pairsFor(m.id, L))));
  }

  // Per-region factors: how much better or worse than the typical model, using the
  // shortest lead each model has, shrunk toward 1 when there are few wet days.
  const regions = {};
  const regionNames = [...new Set(RESORTS.map((r) => r.region))];
  for (const reg of regionNames) {
    const inReg = (st) => stationRegions[st]?.has(reg);
    const scores = {};
    for (const m of MODELS) {
      if (!fc[m.id]) continue;
      const pairs = [1, 2].flatMap((L) => pairsFor(m.id, L, inReg));
      const sc = score(pairs);
      if (sc) scores[m.id] = sc;
    }
    const maes = Object.values(scores).map((s) => s.mae).sort((a, b) => a - b);
    const med = maes.length ? maes[Math.floor(maes.length / 2)] : null;
    regions[reg] = {};
    for (const [id, sc] of Object.entries(scores)) {
      const raw = med && sc.mae > 0 ? med / sc.mae : 1;
      const trust = Math.min(1, sc.wetDays / 12);
      const factor = Math.max(0.6, Math.min(1.6, 1 + (raw - 1) * trust));
      regions[reg][id] = { ...sc, factor: +factor.toFixed(2) };
    }
  }

  // Rank: average miss at the shortest lead each model has.
  const ranked = Object.entries(models)
    .map(([id, m]) => ({ id, mae: (m.d1 || m.d2 || m.d3 || {}).mae ?? 99 }))
    .sort((a, b) => a.mae - b.mae);
  ranked.forEach((x, i) => (models[x.id].rank = i + 1));

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, "skill.json"),
    JSON.stringify({ generated: new Date().toISOString(), window: { start: S, end: E, days: DAYS }, stations: Object.keys(obs).length, models, regions }, null, 1)
  );
  // Keep the observations: next season they score snowfall too.
  const obsFile = path.join(OUT, "obs.json");
  const prev = fs.existsSync(obsFile) ? JSON.parse(fs.readFileSync(obsFile, "utf8")) : {};
  for (const [st, days] of Object.entries(obs)) Object.assign((prev[st] ||= {}), days);
  fs.writeFileSync(obsFile, JSON.stringify(prev));
  fs.writeFileSync(path.join(OUT, "verify-log.txt"), `${new Date().toISOString()}\n${log.join("\n")}\n`);
  console.log(log.join("\n"));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(models).map(([id, m]) => [id, [m.rank, m.d1?.mae, m.d3?.mae, m.d1?.bias]]))));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
