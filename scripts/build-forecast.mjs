// Builds data/forecast.json and data/r/<id>.json from Open-Meteo. Runs on a
// schedule in GitHub Actions; the site only reads the JSON it writes.
//
//   node scripts/build-forecast.mjs            fetch live data
//   UPSLOPE_MOCK=path/to/mock.mjs node ...     use a mock fetcher (default export)
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { buildPages } from "./build-pages.mjs";
import { MODELS, ENSEMBLES, HOURLY, ENS_HOURLY, parseBlock, parseEnsemble, forecastResort, headline } from "./engine.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "data");
const API = "https://api.open-meteo.com/v1/forecast";
const ENS_API = "https://ensemble-api.open-meteo.com/v1/ensemble";

function loadBrowserGlobal(file) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), "utf8"), ctx);
  return ctx.window;
}
const { RESORTS } = loadBrowserGlobal("resorts.js");
const { GUIDES } = loadBrowserGlobal("guides.js");
const { UPSLOPE_CONFIG } = loadBrowserGlobal("config.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function liveFetch(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (res.ok) return await res.json();
      last = `${res.status} ${(await res.text()).slice(0, 200)}`;
      if (res.status === 400) break;
    } catch (e) {
      last = String(e);
    }
    await sleep(3000 * (i + 1));
  }
  throw new Error(last);
}
const fetchJson = process.env.UPSLOPE_MOCK ? (await import(path.resolve(process.env.UPSLOPE_MOCK))).default : liveFetch;

const ftToM = (ft) => Math.round(ft * 0.3048);
const COMMON = { timezone: "America/New_York", temperature_unit: "fahrenheit", precipitation_unit: "inch", wind_speed_unit: "mph" };

// One request per model for every summit and base.
async function fetchModel(id) {
  const locs = [...RESORTS.map((r) => [r, r.summit]), ...RESORTS.map((r) => [r, r.base])];
  const params = new URLSearchParams({
    latitude: locs.map(([r]) => r.lat).join(","),
    longitude: locs.map(([r]) => r.lon).join(","),
    elevation: locs.map(([, e]) => ftToM(e)).join(","),
    hourly: HOURLY.join(","),
    models: id,
    past_days: "2",
    forecast_days: "7",
    ...COMMON,
  });
  let json = await fetchJson(`${API}?${params}`);
  if (!Array.isArray(json)) json = [json];
  if (json.length !== locs.length) throw new Error(`expected ${locs.length} locations, got ${json.length}`);
  return json;
}

async function fetchEnsemble(id) {
  const params = new URLSearchParams({
    latitude: RESORTS.map((r) => r.lat).join(","),
    longitude: RESORTS.map((r) => r.lon).join(","),
    elevation: RESORTS.map((r) => ftToM(r.summit)).join(","),
    hourly: ENS_HOURLY.join(","),
    models: id,
    forecast_days: "7",
    ...COMMON,
  });
  let json = await fetchJson(`${ENS_API}?${params}`);
  if (!Array.isArray(json)) json = [json];
  if (json.length !== RESORTS.length) throw new Error(`expected ${RESORTS.length} locations, got ${json.length}`);
  return json;
}

function nyNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00`;
}

async function main() {
  const started = Date.now();
  const log = [];
  const results = [];
  for (const m of MODELS) {
    try {
      results.push({ meta: m, blocks: await fetchModel(m.id) });
      log.push(`${m.id}: ok`);
    } catch (e) {
      log.push(`${m.id}: FAILED ${e.message}`);
    }
  }
  const ens = [];
  for (const e of ENSEMBLES) {
    try {
      ens.push({ meta: e, blocks: await fetchEnsemble(e.id) });
      log.push(`ens ${e.id}: ok`);
    } catch (err) {
      log.push(`ens ${e.id}: FAILED ${err.message}`);
    }
  }
  console.log(log.join("\n"));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "build-log.txt"), `${new Date().toISOString()}\n${log.join("\n")}\n`);
  if (results.length < 3) throw new Error("Too few models responded; keeping the previous forecast.");

  // Shared hourly time axis: the longest one any model returned.
  const timeIndex = results.map((r) => r.blocks[0].hourly?.time || []).sort((a, b) => b.length - a.length)[0];
  const now = process.env.UPSLOPE_NOW || nyNow();
  let nowK = timeIndex.indexOf(now);
  if (nowK < 0) nowK = timeIndex.findIndex((t) => t >= now);
  if (nowK < 0) throw new Error(`current hour ${now} not in model time axis`);

  const n = RESORTS.length;
  const resorts = [];
  const details = {};
  RESORTS.forEach((resort, i) => {
    const wrap = (r, block) => {
      const raw = parseBlock(block, r.meta.id);
      const at = new Map(raw.time.map((t, k) => [t, k]));
      return { id: r.meta.id, raw, rawAt: (t, f) => (at.has(t) ? raw[f][at.get(t)] ?? null : null) };
    };
    const summitModels = results.map((r) => wrap(r, r.blocks[i]));
    const baseModels = results.map((r) => wrap(r, r.blocks[n + i]));
    const ensembles = ens.map((e) => ({ id: e.meta.id, members: parseEnsemble(e.blocks[i], timeIndex) })).filter((e) => e.members.length);
    const out = forecastResort({ resort, guide: GUIDES[resort.id] || {}, timeIndex, nowK, summitModels, baseModels, ensembles, modelMeta: MODELS });
    details[resort.id] = out.detail;
    delete out.detail;
    resorts.push(out);
  });

  const generated = new Date().toISOString();
  const members = ens.reduce((a, e) => a + (parseEnsemble(e.blocks[0], timeIndex).length || 0), 0);
  const summary = {
    generated,
    run: now,
    dates: resorts[0].days.map((d) => d.date),
    models: MODELS.map((m) => ({ ...m, ok: results.some((r) => r.meta.id === m.id) })),
    ensembles: { systems: ens.map((e) => e.meta.label), members },
    headline: headline(resorts, RESORTS),
    resorts,
  };

  fs.mkdirSync(path.join(OUT, "r"), { recursive: true });
  fs.mkdirSync(path.join(OUT, "archive"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "forecast.json"), JSON.stringify(summary));
  for (const [id, d] of Object.entries(details)) fs.writeFileSync(path.join(OUT, "r", `${id}.json`), JSON.stringify({ generated, ...d }));

  // Compact archive for scoring models against observed snow later.
  const archive = {
    generated,
    run: now,
    resorts: Object.fromEntries(
      resorts.map((r) => [r.id, { days: r.days.map((d) => [d.date, d.snow, d.lo, d.hi, d.rain]), models: details[r.id].modelDays.map((m) => [m.id, m.days]) }])
    ),
  };
  fs.writeFileSync(path.join(OUT, "archive", `${now.slice(0, 13).replace("T", "-")}.json`), JSON.stringify(archive));
  buildPages({ root: ROOT, resorts: RESORTS, forecast: summary, siteUrl: UPSLOPE_CONFIG.siteUrl });
  console.log(`Built ${resorts.length} resorts from ${results.length} models and ${members} ensemble members in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
