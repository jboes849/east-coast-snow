#!/usr/bin/env bash
# Checks the data sources for model verification. Output goes to data/probe/.
set -u
mkdir -p data/probe
for n in VT_ASOS NH_ASOS ME_ASOS NY_ASOS MA_ASOS PA_ASOS WV_ASOS; do
  curl -s -m 60 "https://mesonet.agron.iastate.edu/geojson/network/$n.geojson" > "data/probe/$n.geojson"
  echo "$n: $(jq '.features|length' data/probe/$n.geojson 2>&1 | head -c 100)"
done
echo "--- IEM daily"
curl -s -m 60 "https://mesonet.agron.iastate.edu/cgi-bin/request/daily.py?network=VT_ASOS&stations=BTV&stations=MPV&year1=2026&month1=9&day1=20&year2=2026&month2=10&day2=14&var=precip&var=snow&var=max_temp_f&var=min_temp_f&format=csv" | head -30
echo "--- IEM daily NH (MWN)"
curl -s -m 60 "https://mesonet.agron.iastate.edu/cgi-bin/request/daily.py?network=NH_ASOS&stations=MWN&stations=HIE&year1=2026&month1=10&day1=1&year2=2026&month2=10&day2=14&var=precip&var=snow&format=csv" | head -20
echo "--- previous runs"
P="https://previous-runs-api.open-meteo.com/v1/forecast?latitude=44.47&longitude=-73.15&past_days=31&forecast_days=1&timezone=America/New_York&precipitation_unit=inch&daily=precipitation_sum"
for m in ncep_hrrr_conus ncep_nam_conus gem_hrdps_continental ncep_nbm_conus gfs_seamless ecmwf_ifs025 gem_seamless icon_seamless; do
  r=$(curl -s -m 60 "https://previous-runs-api.open-meteo.com/v1/forecast?latitude=44.47&longitude=-73.15&past_days=31&forecast_days=1&timezone=America/New_York&precipitation_unit=inch&hourly=precipitation,precipitation_previous_day1,precipitation_previous_day2,precipitation_previous_day3,precipitation_previous_day5&models=$m")
  echo "$m: $(echo "$r" | jq -c '{err:.reason, n:(.hourly.time|length), d0:([.hourly.precipitation[]?|select(.!=null)]|length), d1:([.hourly.precipitation_previous_day1[]?|select(.!=null)]|length), d2:([.hourly.precipitation_previous_day2[]?|select(.!=null)]|length), d3:([.hourly.precipitation_previous_day3[]?|select(.!=null)]|length), d5:([.hourly.precipitation_previous_day5[]?|select(.!=null)]|length), sum1:([.hourly.precipitation_previous_day1[]?|select(.!=null)]|add)}' 2>/dev/null || echo "$r" | head -c 300)"
done
echo "--- multi-location previous runs"
curl -s -m 60 "https://previous-runs-api.open-meteo.com/v1/forecast?latitude=44.47,43.53&longitude=-73.15,-72.95&past_days=31&forecast_days=1&timezone=America/New_York&precipitation_unit=inch&hourly=precipitation_previous_day1&models=gfs_seamless" | jq -c 'if type=="array" then map(.hourly.time|length) else .reason end'
echo "now $(date -u)"
