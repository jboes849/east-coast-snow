#!/usr/bin/env bash
# Checks which Open-Meteo models and variables respond for one resort.
set -u
LAT=44.53; LON=-72.78; ELEV=1100
base="https://api.open-meteo.com/v1/forecast?latitude=$LAT&longitude=$LON&elevation=$ELEV&forecast_days=3&timezone=America/New_York"
for m in gfs_seamless ncep_hrrr_conus ncep_nam_conus ncep_nbm_conus gem_hrdps_continental gem_seamless ecmwf_ifs025 ecmwf_ifs ecmwf_aifs025_single icon_seamless; do
  r=$(curl -s "$base&hourly=snowfall,precipitation,temperature_2m,snow_depth,relative_humidity_2m,temperature_850hPa,temperature_700hPa&models=$m")
  echo "$m: $(echo "$r" | jq -c '{err:.reason, hours:(.hourly.time|length), snow_depth:(.hourly.snow_depth|map(select(.!=null))|length), t850:(.hourly.temperature_850hPa|map(select(.!=null))|length), rh:(.hourly.relative_humidity_2m|map(select(.!=null))|length), precip_nonnull:(.hourly.precipitation|map(select(.!=null))|length)}' 2>/dev/null || echo "$r" | head -c 200)"
done
ens="https://ensemble-api.open-meteo.com/v1/ensemble?latitude=$LAT&longitude=$LON&elevation=$ELEV&forecast_days=7&timezone=America/New_York&hourly=snowfall,precipitation,temperature_2m"
for m in gfs025 gfs_seamless ecmwf_ifs025 icon_seamless gem_global; do
  r=$(curl -s "$ens&models=$m")
  echo "ENS $m: $(echo "$r" | jq -c '{err:.reason, keys:(.hourly|keys|length), hours:(.hourly.time|length)}' 2>/dev/null || echo "$r" | head -c 200)"
done
echo "now: $(date -u)"
curl -s "$base&hourly=temperature_2m,snow_depth&models=gfs_seamless&past_days=1" | jq -c '{t:.hourly.temperature_2m[30:40], sd:.hourly.snow_depth[30:40]}'
