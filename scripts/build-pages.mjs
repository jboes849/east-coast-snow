// Writes resorts/<id>/index.html (one shareable, search-friendly page per resort)
// and sitemap.xml. Each page is index.html with its own title and description;
// app.js sees data-resort on <body> and shows that resort full-page.
import fs from "node:fs";
import path from "node:path";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// Unit tokens -> inches/°F for page descriptions.
const plain = (t) =>
  t.replace(/\{\{(\w):([^}]+)\}\}/g, (_, k, v) => {
    const n = v.split(",").map(Number);
    const sn = (x) => (x < 0.5 ? "0" : x < 10 ? String(Math.round(x * 10) / 10) : String(Math.round(x)));
    if (k === "s") return `${sn(n[0])}"`;
    if (k === "r") return `${sn(n[0])}-${sn(n[1])}"`;
    if (k === "t") return `${Math.round(n[0])}°F`;
    if (k === "w") return `${Math.round(n[0])} mph`;
    if (k === "e") return `${Math.round(n[0]).toLocaleString("en-US")} ft`;
    if (k === "l") return `${n[0].toFixed(2)}"`;
    return v;
  });

export function buildPages({ root, resorts, forecast, siteUrl }) {
  const template = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const byId = Object.fromEntries(forecast.resorts.map((r) => [r.id, r]));
  const urls = [siteUrl];
  for (const r of resorts) {
    const f = byId[r.id];
    const title = `${r.name} snow forecast · Upslope`;
    const lead = f ? plain(f.insights.slice(0, 2).map((x) => x.text).join(" ")) : "";
    const desc = `${r.name} (${r.state}) 7-day snow forecast from 8 weather models and 82 ensemble runs. ${lead}`.slice(0, 300).replace(/(\.)[^.]*$/, "$1");
    const url = `${siteUrl}resorts/${r.id}/`;
    let html = template
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
      .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
      .replace("<meta charset=\"utf-8\">", `<meta charset="utf-8">\n  <base href="../../">`)
      .replace("</head>", `  <link rel="canonical" href="${url}">\n  <meta property="og:title" content="${esc(title)}">\n  <meta property="og:description" content="${esc(desc)}">\n  <meta property="og:url" content="${url}">\n</head>`)
      .replace("<body>", `<body data-resort="${r.id}">`);
    fs.mkdirSync(path.join(root, "resorts", r.id), { recursive: true });
    fs.writeFileSync(path.join(root, "resorts", r.id, "index.html"), html);
    urls.push(url);
  }
  urls.push(`${siteUrl}faq/`);
  const day = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(
    path.join(root, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${day}</lastmod></url>`).join("\n")}\n</urlset>\n`
  );
}
