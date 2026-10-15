// East Coast ski areas. Coordinates are near mid-mountain; elevations are in feet
// and approximate (from resort and OpenSkiMap figures). Verify before relying on them.
// open/close: typical opening and closing dates (MM-DD) from recent seasons. They are
// rough guides, not announced dates; resorts open when snowmaking allows.
// site: resort home page (scripts/check-links.mjs finds its report, webcam and trail map pages).
// night: runs lights for night skiing on at least some evenings.
// pass: multi-resort pass for 2026-27 (epic, ikon, indy). Lineups change yearly.
window.RESORTS = [
  // Vermont
  { id: "jay", name: "Jay Peak", region: "Northern Vermont", state: "VT", lat: 44.936, lon: -72.505, base: 1815, summit: 3968, open: "11-27", close: "04-25", pass: "indy", site: "https://jaypeakresort.com" },
  { id: "burke", name: "Burke", region: "Northern Vermont", state: "VT", lat: 44.587, lon: -71.918, base: 1150, summit: 3267, open: "12-05", close: "04-06", pass: "indy", site: "https://skiburke.com" },
  { id: "smuggs", name: "Smugglers' Notch", region: "Northern Vermont", state: "VT", lat: 44.588, lon: -72.790, base: 1030, summit: 3640, open: "12-06", close: "04-06", pass: "indy", site: "https://www.smuggs.com" },
  { id: "stowe", name: "Stowe", region: "Northern Vermont", state: "VT", lat: 44.530, lon: -72.781, base: 1280, summit: 3625, open: "11-21", close: "04-20", pass: "epic", site: "https://www.stowe.com" },
  { id: "bolton", name: "Bolton Valley", region: "Northern Vermont", state: "VT", lat: 44.421, lon: -72.850, base: 1600, summit: 3150, open: "12-05", close: "04-06", pass: "indy", site: "https://www.boltonvalley.com", night: true },
  { id: "mrg", name: "Mad River Glen", region: "Central Vermont", state: "VT", lat: 44.202, lon: -72.918, base: 1600, summit: 3637, open: "12-12", close: "04-06", site: "https://www.madriverglen.com" },
  { id: "sugarbush", name: "Sugarbush", region: "Central Vermont", state: "VT", lat: 44.136, lon: -72.894, base: 1483, summit: 4083, open: "11-22", close: "04-27", pass: "ikon", site: "https://www.sugarbush.com" },
  { id: "killington", name: "Killington", region: "Central Vermont", state: "VT", lat: 43.626, lon: -72.797, base: 1165, summit: 4241, open: "11-08", close: "05-10", pass: "ikon", site: "https://www.killington.com" },
  { id: "okemo", name: "Okemo", region: "Southern Vermont", state: "VT", lat: 43.402, lon: -72.717, base: 1144, summit: 3344, open: "11-20", close: "04-13", pass: "epic", site: "https://www.okemo.com" },
  { id: "stratton", name: "Stratton", region: "Southern Vermont", state: "VT", lat: 43.113, lon: -72.908, base: 1872, summit: 3875, open: "11-21", close: "04-13", pass: "ikon", site: "https://www.stratton.com" },
  { id: "mountsnow", name: "Mount Snow", region: "Southern Vermont", state: "VT", lat: 42.960, lon: -72.920, base: 1900, summit: 3600, open: "11-08", close: "04-20", pass: "epic", site: "https://www.mountsnow.com" },
  // New Hampshire
  { id: "cannon", name: "Cannon", region: "White Mountains", state: "NH", lat: 44.156, lon: -71.699, base: 1900, summit: 4080, open: "11-28", close: "04-13", pass: "indy", site: "https://www.cannonmt.com" },
  { id: "bretton", name: "Bretton Woods", region: "White Mountains", state: "NH", lat: 44.258, lon: -71.441, base: 1500, summit: 3100, open: "11-15", close: "04-13", site: "https://www.brettonwoods.com" },
  { id: "wildcat", name: "Wildcat", region: "White Mountains", state: "NH", lat: 44.264, lon: -71.239, base: 1950, summit: 4062, open: "11-22", close: "04-20", pass: "epic", site: "https://www.skiwildcat.com" },
  { id: "attitash", name: "Attitash", region: "White Mountains", state: "NH", lat: 44.083, lon: -71.229, base: 600, summit: 2350, open: "12-06", close: "04-06", pass: "epic", site: "https://www.attitash.com" },
  { id: "loon", name: "Loon", region: "White Mountains", state: "NH", lat: 44.036, lon: -71.621, base: 950, summit: 3050, open: "11-15", close: "04-20", pass: "ikon", site: "https://www.loonmtn.com" },
  { id: "waterville", name: "Waterville Valley", region: "White Mountains", state: "NH", lat: 43.965, lon: -71.528, base: 1984, summit: 4004, open: "11-27", close: "04-13", pass: "indy", site: "https://www.waterville.com" },
  // Maine
  { id: "sugarloaf", name: "Sugarloaf", region: "Western Maine", state: "ME", lat: 45.031, lon: -70.313, base: 1417, summit: 4237, open: "11-15", close: "04-27", pass: "ikon", site: "https://www.sugarloaf.com" },
  { id: "saddleback", name: "Saddleback", region: "Western Maine", state: "ME", lat: 44.937, lon: -70.504, base: 2460, summit: 4120, open: "12-06", close: "04-20", pass: "indy", site: "https://www.saddlebackmaine.com" },
  { id: "sundayriver", name: "Sunday River", region: "Western Maine", state: "ME", lat: 44.473, lon: -70.857, base: 800, summit: 3140, open: "11-08", close: "04-20", pass: "ikon", site: "https://www.sundayriver.com" },
  // New York
  { id: "whiteface", name: "Whiteface", region: "Adirondacks", state: "NY", lat: 44.366, lon: -73.903, base: 1220, summit: 4650, open: "11-22", close: "04-13", site: "https://whiteface.com" },
  { id: "gore", name: "Gore", region: "Adirondacks", state: "NY", lat: 43.673, lon: -74.006, base: 998, summit: 3600, open: "11-22", close: "04-06", site: "https://goremountain.com" },
  { id: "snowridge", name: "Snow Ridge", region: "Tug Hill", state: "NY", lat: 43.632, lon: -75.405, base: 1400, summit: 1900, open: "12-12", close: "03-30", pass: "indy", site: "https://www.snowridge.com", night: true },
  { id: "holidayvalley", name: "Holiday Valley", region: "Western New York", state: "NY", lat: 42.262, lon: -78.668, base: 1500, summit: 2250, open: "12-05", close: "03-30", site: "https://www.holidayvalley.com", night: true },
  { id: "hunter", name: "Hunter", region: "Catskills", state: "NY", lat: 42.203, lon: -74.226, base: 1600, summit: 3200, open: "11-22", close: "04-06", pass: "epic", site: "https://www.huntermtn.com" },
  { id: "windham", name: "Windham", region: "Catskills", state: "NY", lat: 42.296, lon: -74.257, base: 1500, summit: 3100, open: "11-28", close: "04-06", site: "https://www.windhammountainclub.com", night: true },
  { id: "belleayre", name: "Belleayre", region: "Catskills", state: "NY", lat: 42.133, lon: -74.508, base: 2025, summit: 3429, open: "12-05", close: "03-30", site: "https://www.belleayre.com" },
  // Massachusetts
  { id: "jiminy", name: "Jiminy Peak", region: "Berkshires", state: "MA", lat: 42.556, lon: -73.292, base: 1230, summit: 2380, open: "12-05", close: "03-30", site: "https://www.jiminypeak.com", night: true },
  // Pennsylvania
  { id: "camelback", name: "Camelback", region: "Poconos", state: "PA", lat: 41.052, lon: -75.356, base: 1250, summit: 2133, open: "12-05", close: "03-30", site: "https://www.skicamelback.com", night: true },
  { id: "sevensprings", name: "Seven Springs", region: "Laurel Highlands", state: "PA", lat: 40.023, lon: -79.297, base: 2240, summit: 2990, open: "12-12", close: "03-30", pass: "epic", site: "https://www.7springs.com", night: true },
  // West Virginia
  { id: "snowshoe", name: "Snowshoe", region: "West Virginia", state: "WV", lat: 38.410, lon: -79.994, base: 3348, summit: 4848, open: "11-27", close: "03-30", pass: "ikon", site: "https://www.snowshoemtn.com", night: true },
];
