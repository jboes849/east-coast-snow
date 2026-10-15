# Upslope

Free ski snow forecasts for East Coast resorts (VT, NH, ME, NY, MA, PA, WV). Live at https://jboes849.github.io/east-coast-snow/

## What it does

- **Snow story:** a plain-English headline for the week, plus quick stats (most snow, best powder morning, coldest summit).
- **Snow map:** every resort on a map, colored by expected snow for 3 or 7 days, with a live NEXRAD radar layer.
- **Powder mornings:** the best first chairs in the next 3 days, scored 0 to 100 (overnight snow 4pm to 9am, cold, no rain, model agreement).
- **Resort cards:** 7-day mini bar chart with the model range behind each bar, plus badges for powder, rain, wind holds and snowmaking weather. A table view, search, state filters, and starred "My mountains" (saved in the browser).
- **Resort detail:** a written summary, 7-day tiles with weather icons, a chart of snow piling up for every model, a snow quality meter, summit vs base temperature, and wind gusts against the lift-hold line.
- **Units:** inches/°F or cm/°C.

Under the hood it pulls five models from Open-Meteo in the visitor's browser (GFS/HRRR, ECMWF, Canadian GEM, German ICON, NWS National Blend) and recomputes snow from liquid with a temperature-based snow-to-liquid ratio instead of the models' fixed 7:1.

## Files

- `index.html`, `style.css`: the page.
- `app.js`: rendering, map, charts and interaction.
- `forecast.js`: data fetching and forecast math (consensus, storms, powder score, snow quality).
- `resorts.js`: resort list. Coordinates and elevations are approximate; correct them as needed.
- `icons.js`: inline SVG icons.
- Fonts: Geist and Geist Mono from Google Fonts.
- `vendor/`: Leaflet 1.9.4 and Chart.js 4.4.1 (MIT), served from the site so there's no CDN dependency.

No build step and no server. Any static host works (GitHub Pages, Cloudflare Pages, Netlify).

## Run locally

    python3 -m http.server 8000
    # open http://localhost:8000

## Notes

- Open-Meteo's free API is for non-commercial use. A free site with no ads fits; ads or sponsors mean switching to their paid plan.
- Each visit makes about 5 API calls (cached 30 minutes in the browser). Opening a resort adds 5 more. Map tiles come from CARTO and radar from Iowa Environmental Mesonet, both free with attribution.
- Not yet built: email sign-up, storing past forecasts to score model accuracy per resort, and observed snow (Mount Washington Observatory, NOHRSC).
