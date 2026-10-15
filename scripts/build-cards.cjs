// Share preview images (1200x630) for the home page and each resort page.
// The cards don't carry forecast numbers, since chat apps and social sites cache
// previews for days. Run once after adding resorts:
//   node scripts/build-cards.cjs   (needs Playwright and Chromium)
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "img", "og");
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "resorts.js"), "utf8"), ctx);
const RESORTS = ctx.window.RESORTS;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ft = (x) => `${Math.round(x).toLocaleString("en-US")} ft`;

const page = (title, sub, meta) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@500&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; background: #fff; color: #0b0d10; font-family: Geist, sans-serif; }
  .card { box-sizing: border-box; width: 1200px; height: 630px; padding: 64px 72px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 14px; font: 600 26px Geist; letter-spacing: 0.12em; text-transform: uppercase; }
  .brand svg { width: 34px; height: 34px; }
  .rule { height: 1px; background: #0b0d10; margin: 36px 0 0; }
  h1 { margin: auto 0 0; font: 600 ${title.length > 18 ? 92 : 112}px/1 Geist; letter-spacing: -0.035em; }
  .sub { margin: 22px 0 0; font: 400 34px/1.3 Geist; color: #374151; }
  .meta { margin-top: 44px; padding-top: 22px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font: 500 20px "Geist Mono"; letter-spacing: 0.06em; text-transform: uppercase; color: #6b7280; }
  .meta b { color: #0057ff; font-weight: 500; }
</style></head><body><div class="card">
  <div class="brand"><svg viewBox="0 0 20 20"><path d="M1 18 8 5l4 7 2.5-4L19 18Z" fill="#0b0d10"/></svg>Upslope</div>
  <div class="rule"></div>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(sub)}</p>
  <div class="meta">${meta}</div>
</div></body></html>`;

(async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  fs.mkdirSync(OUT, { recursive: true });
  const shoot = async (file, html) => {
    await p.setContent(html, { waitUntil: "networkidle" });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(OUT, file), type: "png" });
  };
  await shoot("home.png", page("East Coast Snow Forecasts", "Free 7-day forecasts for 31 ski areas from Maine to West Virginia.", `<span><b>8 models</b> · 82 ensemble runs</span><span>Updated 4× a day</span>`));
  for (const r of RESORTS) {
    await shoot(`${r.id}.png`, page(r.name, `7-Day Snow Forecast · ${r.region}, ${r.state}`, `<span>Summit <b>${ft(r.summit)}</b> · Base ${ft(r.base)}</span><span>Updated 4× a day</span>`));
  }
  await browser.close();
  console.log(`Wrote ${RESORTS.length + 1} cards to img/og/`);
})();
