# Upslope

Free ski snow forecasts for East Coast resorts (VT, NH, ME, NY, MA, PA, WV). Live at https://jboes849.github.io/east-coast-snow/

## How the forecast works

A GitHub Actions job (`.github/workflows/forecast.yml`) runs `scripts/build-forecast.mjs` four times a day. It pulls Open-Meteo data for every summit and base and writes:

- `data/forecast.json`: the summary the page loads (days, storms, odds, insights, grades or snowmaking).
- `data/r/<resort>.json`: hourly detail for the resort view.
- `data/archive/<run>.json`: a compact copy of each run, kept so models can be scored against observed snow later.

The math lives in `scripts/engine.mjs`:

- **Models:** HRRR, NAM 3 km, Canadian HRDPS, NWS Blend, GFS, ECMWF, Canadian GEM, German ICON. High-resolution models get extra weight in the first 36–60 hours; daily totals are the weighted median of the models, so one wild model can't drag the forecast.
- **Ensembles:** GFS (31 members) and ECMWF (51) give probabilities like "70% chance of 6 inches+" and the 10–90% band on the chart.
- **Precipitation type:** wet-bulb temperature at each elevation plus the 850/700 hPa warm layer, so sleet and freezing rain show up. Snow ratios use the warmest temperature in the column (Kuchera) reduced for wind.
- **Season:** typical opening and closing dates per resort (`resorts.js`). Before opening day there are no day grades, powder scores or ice warnings; the site shows snowmaking windows (summit wet bulb at or below 27°F) and first natural snow instead.
- **Insights:** generated from the numbers: rain/snow line by elevation, warm-layer sleet risk, heaviest-rate timing, outlier models, high-res vs global splits, northwest upslope tails, lake-band alignment, thaws, wind holds, refrozen surfaces.

## Files

- `index.html`, `style.css`, `app.js`: the page. It only reads the JSON files.
- `scripts/engine.mjs`, `scripts/build-forecast.mjs`: the forecast engine and the job that runs it.
- `resorts.js`: resorts, elevations and typical season dates (approximate; correct as needed).
- `guides.js`: storm setups, per-mountain wind arcs the engine uses (upslope, shadow, lake, exposed lifts) and local notes.
- `icons.js`: inline SVG icons. `vendor/`: Leaflet 1.9.4 and Chart.js 4.4.1 (MIT).

To run the job by hand: `node scripts/build-forecast.mjs` (Node 20+, needs internet).

## Run locally

    python3 -m http.server 8000
    # open http://localhost:8000

## Notes

- Open-Meteo's free API is for non-commercial use. A free site with no ads fits; ads or sponsors mean switching to their paid plan.
- Each run of the job is about 1,500 Open-Meteo calls (well under the free 10,000 a day); visitors make no API calls. Map tiles come from CARTO and radar from Iowa Environmental Mesonet, both free with attribution.
- Not yet built: email sign-up, and scoring the archived forecasts against observed snow (NOHRSC, Mount Washington Observatory).
