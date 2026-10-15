// National Weather Service extras for each resort: active watches and warnings,
// and the latest Area Forecast Discussion from the local office (where the
// forecasters explain their thinking). Best effort: any failure returns what it has.
import fs from "node:fs";
import path from "node:path";

const API = "https://api.weather.gov";
const UA = { "User-Agent": "Upslope ski forecasts (github.com/jboes849/east-coast-snow)", Accept: "application/geo+json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RELEVANT = /winter|blizzard|ice storm|snow|freez|wind|chill|cold|frost|avalanche/i;

async function get(url, accept) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { ...UA, ...(accept ? { Accept: accept } : {}) }, signal: AbortSignal.timeout(30000) });
      if (res.ok) return await res.json();
      last = `${res.status}`;
      if (res.status === 404) break;
    } catch (e) {
      last = String(e);
    }
    await sleep(2000 * (i + 1));
  }
  throw new Error(`${url}: ${last}`);
}

// Forecast zone, county and office per resort. Cached because it never changes.
async function points(resorts, cacheFile, log) {
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
  let changed = false;
  for (const r of resorts) {
    if (cache[r.id]) continue;
    try {
      const p = (await get(`${API}/points/${r.lat.toFixed(4)},${r.lon.toFixed(4)}`)).properties;
      const id = (u) => (u ? u.split("/").pop() : null);
      cache[r.id] = { office: p.gridId || p.cwa, zone: id(p.forecastZone), county: id(p.county), fire: id(p.fireWeatherZone) };
      changed = true;
      await sleep(300);
    } catch (e) {
      log.push(`nws points ${r.id}: ${e.message}`);
    }
  }
  if (changed) fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
  return cache;
}

// The opening synopsis or key messages: the most readable part of a discussion.
function excerpt(text) {
  const t = text.replace(/\r/g, "");
  const grab = (re) => {
    const m = t.match(re);
    return m ? m[1] : null;
  };
  let body =
    grab(/(?:^|\n)\.?KEY MESSAGES?[.\s]*\n([\s\S]*?)(?=\n&&|\n\.[A-Z][A-Z /]+\.\.\.|\n\n\n)/i) ||
    grab(/(?:^|\n)\.SYNOPSIS[.\s]*\n?([\s\S]*?)(?=\n&&|\n\.[A-Z][A-Z /]+\.\.\.)/) ||
    grab(/(?:^|\n)\.(?:NEAR TERM|SHORT TERM)[^\n]*\n([\s\S]*?)(?=\n&&|\n\.[A-Z][A-Z /]+\.\.\.)/);
  if (!body) return null;
  body = body.replace(/\n(?!\n)/g, " ").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  if (body === body.toUpperCase()) body = body.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase());
  const paras = body.split("\n").map((p) => p.replace(/^[-*\d.\s]+/, "").trim()).filter((p) => p && !/^(as of|issued at|update\b)/i.test(p));
  let out = "";
  for (const p of paras) {
    if ((out + " " + p).length > 700 && out) break;
    out += (out ? "\n" : "") + p;
  }
  return out.length > 900 ? out.slice(0, 880).replace(/\s\S*$/, "") + "…" : out;
}

export async function fetchNws({ resorts, root }) {
  const log = [];
  const out = { generated: new Date().toISOString(), alerts: {}, offices: {}, resortOffice: {} };
  try {
    const pts = await points(resorts, path.join(root, "data", "nws-points.json"), log);
    for (const r of resorts) if (pts[r.id]) out.resortOffice[r.id] = pts[r.id].office;

    const states = [...new Set(resorts.map((r) => r.state))].join(",");
    const alerts = (await get(`${API}/alerts/active?area=${states}`)).features || [];
    for (const a of alerts) {
      const p = a.properties;
      if (!RELEVANT.test(p.event) || p.status !== "Actual") continue;
      const ugc = new Set(p.geocode?.UGC || []);
      for (const r of resorts) {
        const z = pts[r.id];
        if (!z || !(ugc.has(z.zone) || ugc.has(z.county))) continue;
        const list = (out.alerts[r.id] ||= []);
        if (list.some((x) => x.event === p.event)) continue;
        list.push({
          event: p.event,
          severity: p.severity,
          headline: p.headline,
          onset: p.onset || p.effective,
          ends: p.ends || p.expires,
          text: (p.description || "").replace(/\s+/g, " ").slice(0, 600),
          office: z.office,
        });
      }
    }
    log.push(`nws alerts: ${alerts.length} active, ${Object.keys(out.alerts).length} resorts affected`);

    for (const office of [...new Set(Object.values(out.resortOffice))]) {
      try {
        const list = await get(`${API}/products/types/AFD/locations/${office}`, "application/ld+json");
        const latest = (list["@graph"] || [])[0];
        if (!latest) continue;
        const prod = await get(`${API}/products/${latest.id}`, "application/ld+json");
        out.offices[office] = {
          issued: prod.issuanceTime,
          excerpt: excerpt(prod.productText || ""),
          url: `https://forecast.weather.gov/product.php?site=${office}&issuedby=${office}&product=AFD&format=txt&version=1&glossary=1`,
        };
        await sleep(300);
      } catch (e) {
        log.push(`nws afd ${office}: ${e.message}`);
      }
    }
    log.push(`nws discussions: ${Object.keys(out.offices).length}`);
  } catch (e) {
    log.push(`nws: FAILED ${e.message}`);
  }
  return { nws: out, log };
}

export { excerpt };

// Climate Prediction Center 8–14 day outlook: odds of a warmer/colder and
// wetter/drier than normal pattern, sampled at one point per area.
const CPC = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/cpc_8_14_day_outlk/MapServer";
export async function fetchCpc(areas) {
  const log = [];
  const out = { areas: {} };
  try {
    const meta = await fetch(`${CPC}?f=json`, { headers: UA, signal: AbortSignal.timeout(30000) }).then((r) => r.json());
    const layers = meta.layers || [];
    const pick = (re) => layers.find((l) => re.test(l.name))?.id;
    const ids = { temp: pick(/temp/i) ?? 0, precip: pick(/prec/i) ?? 1 };
    log.push(`cpc layers: ${layers.map((l) => `${l.id}=${l.name}`).join("; ")}`);
    for (const a of areas) {
      const res = {};
      for (const [kind, id] of Object.entries(ids)) {
        const q = new URLSearchParams({ geometry: `${a.lon},${a.lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "*", returnGeometry: "false", f: "json" });
        const j = await fetch(`${CPC}/${id}/query?${q}`, { headers: UA, signal: AbortSignal.timeout(30000) }).then((r) => r.json());
        const attrs = j.features?.[0]?.attributes;
        if (!attrs) continue;
        if (!out.fields) {
          out.fields = Object.keys(attrs);
          log.push(`cpc fields: ${JSON.stringify(attrs)}`);
        }
        const key = (re) => Object.keys(attrs).find((k) => re.test(k));
        const cat = attrs[key(/^cat/i)];
        const prob = Number(attrs[key(/^prob/i)]);
        const start = attrs[key(/start|valid|fcst_date|idp_filedate/i)];
        res[kind] = { cat: cat ?? null, prob: Number.isFinite(prob) ? prob : null };
        if (start && !out.valid) out.valid = String(start);
      }
      out.areas[a.key] = res;
    }
    log.push(`cpc areas: ${Object.keys(out.areas).length}`);
  } catch (e) {
    log.push(`cpc: FAILED ${e.message}`);
  }
  return { cpc: out, log };
}
