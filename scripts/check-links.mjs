// Finds each resort's snow report, webcam and trail map pages by trying common
// paths and keeping the ones that load a real page (not a redirect home or a 404).
// Writes data/links.json for the site. Runs daily with the model scoring.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "resorts.js"), "utf8"), ctx);
const RESORTS = ctx.window.RESORTS;

const VAIL = { report: ["/the-mountain/mountain-conditions/snow-and-weather-report.aspx"], cams: ["/the-mountain/mountain-conditions/mountain-cams.aspx"], map: ["/the-mountain/about-the-mountain/trail-map.aspx"] };
const COMMON = {
  report: ["/snow-report", "/mountain-report", "/conditions", "/snow-report/", "/mountain/conditions", "/mountain-conditions", "/the-mountain/snow-report", "/plan-your-trip/mountain-report"],
  cams: ["/webcams", "/mountain-cams", "/web-cams", "/cams", "/mountain/webcams", "/the-mountain/webcams", "/live-cams"],
  map: ["/trail-map", "/trail-maps", "/mountain/trail-map", "/the-mountain/trail-map", "/trailmap"],
};
const VAIL_IDS = new Set(["stowe", "okemo", "mountsnow", "attitash", "wildcat", "hunter", "sevensprings"]);
const UA = { "User-Agent": "Mozilla/5.0 (compatible; UpslopeLinkCheck/1.0; +https://github.com/jboes849/east-coast-snow)" };

async function ok(url, home) {
  try {
    const res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(20000) });
    if (!res.ok) return false;
    const final = res.url.replace(/\/$/, "");
    if (final === home.replace(/\/$/, "") || /\/(404|not-found|page-not-found)/i.test(final)) return false;
    const html = (await res.text()).slice(0, 60000);
    const title = (html.match(/<title[^>]*>([^<]*)/i) || [])[1] || "";
    return !/not found|404|page doesn.t exist|oops/i.test(title);
  } catch (e) {
    return false;
  }
}

const out = {};
const log = [];
for (const r of RESORTS) {
  if (!r.site) continue;
  const found = { site: r.site };
  const tries = VAIL_IDS.has(r.id) ? { report: [...VAIL.report, ...COMMON.report], cams: [...VAIL.cams, ...COMMON.cams], map: [...VAIL.map, ...COMMON.map] } : COMMON;
  for (const [kind, paths] of Object.entries(tries)) {
    for (const p of paths) {
      const url = r.site.replace(/\/$/, "") + p;
      if (await ok(url, r.site)) {
        found[kind] = url;
        break;
      }
    }
  }
  out[r.id] = found;
  log.push(`${r.id}: ${["report", "cams", "map"].map((k) => `${k}=${found[k] ? "yes" : "no"}`).join(" ")}`);
}
fs.writeFileSync(path.join(ROOT, "data", "links.json"), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(ROOT, "data", "links-log.txt"), `${new Date().toISOString()}\n${log.join("\n")}\n`);
console.log(log.join("\n"));
