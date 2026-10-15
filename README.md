# East Coast Snow

Free ski snow forecasts for East Coast resorts (VT, NH, ME, NY, MA, PA, WV).

## What it does

- Pulls five weather models from Open-Meteo in the visitor's browser: GFS/HRRR, ECMWF, Canadian GEM, German ICON, and the NWS National Blend.
- Shows 7-day summit snow per resort as the middle forecast across models, with the low–high range and a "models disagree" fade.
- Recomputes snow from liquid using a temperature-based snow-to-liquid ratio instead of the models' fixed 7:1.
- Flags rain/ice ("mix"), snow level, summit wind gusts (45+ mph = wind hold risk), and base vs summit snow.
- Ranks the best powder mornings in the next 3 days (overnight snow 4pm–9am, cold, no rain, model agreement).

## Files

- `index.html`, `style.css`: the page.
- `resorts.js`: resort list. Coordinates and elevations are approximate; correct them as needed.
- `forecast.js`: data fetching and forecast math.
- `app.js`: rendering and interaction.

No build step and no server. Any static host works (Cloudflare Pages, GitHub Pages, Netlify).

## Run locally

    python3 -m http.server 8000
    # open http://localhost:8000

## Notes

- Open-Meteo's free API is for non-commercial use. A free site with no ads fits; ads or sponsors mean switching to their paid plan.
- Each visit makes about 5 API calls (cached 30 minutes in the browser). Opening a resort adds 5 more.
- Not yet built: email sign-up, storing past forecasts to score model accuracy per resort, and observed snow (Mount Washington Observatory, NOHRSC).
