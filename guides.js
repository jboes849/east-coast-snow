// Storm setups and per-mountain notes. The forecast engine reads the numbers
// (wind arcs and thresholds) to tailor its insights; the notes are local quirks
// written from general knowledge. Edit freely as local knowledge improves.
//
// setups:  storm types that deliver best here, most important first.
// hold:    summit gust (mph) where the exposed lifts usually stop.
// exposed: wind directions (degrees from) that hit the exposed lifts hardest.
// upslope: wind directions that force air up this side of the range (upslope snow).
// shadow:  wind directions where this mountain sits downwind of higher terrain.
// lake:    wind directions that carry lake-effect bands here.
window.SETUPS = {
  upslope: { label: "Northwest upslope", blurb: "Cold northwest flow behind a front is forced up the mountains and wrings out light, fluffy snow, often for a day or more after the storm ends." },
  noreaster: { label: "Nor'easter", blurb: "A coastal low tracks up the Atlantic. Snow totals depend on the track: a benchmark track (south of Nantucket) is cold; a track over Cape Cod or inland brings mix." },
  lake: { label: "Lake effect", blurb: "Cold air crossing a warmer Great Lake builds narrow snow bands. Totals hinge on wind direction, so a 20-degree shift moves the band miles." },
  southern: { label: "Southerly flow", blurb: "Snow arrives on south or southwest winds ahead of a low passing to the west. It often starts as snow and turns to mix as warm air arrives aloft." },
  west: { label: "Westerly / clipper", blurb: "A fast, moisture-starved system from Canada. Usually 1–4 inches, but cold, so the snow is light." },
};

window.GUIDES = {
  jay: { setups: ["upslope", "noreaster"], hold: 40, exposed: [250, 340], upslope: [270, 340],
    notes: [
      "First high ground northwest flow hits after crossing the St. Lawrence Valley. Post-storm northwest winds with summit temps in the teens are the classic \"Jay Cloud\" setup, and coarse global models tend to undercount it.",
      "Base sits near 1,800 ft and far north, so storms that mix in southern Vermont often stay all snow here.",
    ],
    wind: "The Aerial Tram to the summit is very exposed and holds often in strong west to northwest winds. Lower lifts usually keep running." },
  burke: { setups: ["noreaster", "upslope"], hold: 45, exposed: [240, 330], upslope: [280, 340], shadow: [250, 290],
    notes: [
      "Burke stands alone east of the Green Mountain spine, so westerly flow has already dropped much of its moisture. Expect noticeably less upslope snow than Jay on the same day.",
      "Its eastern position helps in coastal storms: it is closer to Atlantic moisture than the Greens.",
    ],
    wind: "As a standalone peak, the upper mountain is exposed to west winds." },
  smuggs: { setups: ["upslope", "noreaster"], hold: 45, exposed: [250, 340], upslope: [270, 340],
    notes: [
      "Shares Mount Mansfield with Stowe, on the north side. Northwest flow is the money setup, and the north-facing slopes hold snow quality for days after.",
      "The Notch funnels wind, so blowing snow can load some trails and scour others.",
    ],
    wind: "Upper lifts can see holds in strong westerly winds. Morse Mountain, lower down, is more sheltered." },
  stowe: { setups: ["upslope", "noreaster"], hold: 45, exposed: [250, 340], upslope: [270, 340],
    notes: [
      "Mount Mansfield is the highest point in Vermont and a prime upslope target on northwest flow. Totals at the summit can run well above the village on these days.",
      "In coastal storms that mix, the 1,300 ft base often goes to rain or sleet while the upper mountain stays snow. Check the base vs summit temperature chart.",
    ],
    wind: "The Gondola and FourRunner Quad serve the upper mountain and can slow or stop in high winds. Spruce Peak is somewhat more sheltered." },
  bolton: { setups: ["upslope"], hold: 45, exposed: [240, 330], upslope: [260, 330],
    notes: [
      "Sits on the west face of the Greens close to Lake Champlain. West to northwest flow rises straight up the slope, so it can outperform bigger neighbors on upslope days.",
      "A 1,600 ft base helps in marginal storms.",
    ],
    wind: "The high base means wind and cold are common. The Vista Quad up top is the most exposed lift." },
  mrg: { setups: ["upslope", "noreaster"], hold: 45, exposed: [250, 340], upslope: [270, 340],
    notes: [
      "Mostly natural snow, so the mountain is far more sensitive to actual snowfall than its neighbors. A thaw-and-refreeze hurts here more than at resorts with full snowmaking.",
      "Northwest upslope events are the main refresher on the spine of the central Greens.",
    ],
    wind: "The Single Chair runs to the summit ridge and is exposed to westerly winds." },
  sugarbush: { setups: ["upslope", "noreaster"], hold: 45, exposed: [250, 340], upslope: [270, 340],
    notes: [
      "Mount Ellen tops out above 4,000 ft and usually beats Lincoln Peak in upslope events.",
      "In marginal coastal storms the 1,500 ft base areas are where rain shows up first.",
    ],
    wind: "The Slide Brook Express connector and the upper Mount Ellen lifts are the most wind-prone." },
  killington: { setups: ["noreaster", "upslope"], hold: 45, exposed: [250, 340], upslope: [280, 340],
    notes: [
      "Over 3,000 ft of vertical with bases near 1,200 ft, so the snow line inside a storm matters more here than almost anywhere. A storm can be 8 inches of snow on Killington Peak and rain at the Skyeship base.",
      "One of the biggest snowmaking systems in the East, and usually among the first to open when cold nights line up in late October or November.",
    ],
    wind: "The K-1 Gondola and summit lifts are exposed in strong westerly winds, and holds are common in deep cold." },
  okemo: { setups: ["noreaster", "southern"], hold: 45, exposed: [240, 320], shadow: [270, 330],
    notes: [
      "Sits east of the main Green Mountain spine, so northwest upslope flow drops most of its snow on Killington and points west first. Expect a fraction of the northern Vermont totals on those days.",
      "Relies on coastal storms and a large snowmaking system.",
    ],
    wind: "Upper-mountain lifts can see holds in strong west winds." },
  stratton: { setups: ["noreaster", "southern"], hold: 45, exposed: [240, 330],
    notes: [
      "The tallest peak in southern Vermont. Its best storms track just south of New England, where it is close enough to the moisture and still cold enough for snow.",
      "Northwest flow rarely adds more than light refreshes this far south.",
    ],
    wind: "The summit gondola is exposed and can hold in high winds." },
  mountsnow: { setups: ["noreaster", "southern"], hold: 45, exposed: [240, 330], shadow: [280, 340],
    notes: [
      "One of the southernmost big Vermont mountains, so it is often near the rain-snow line in coastal storms. A 1,900 ft base helps.",
      "Gets little from northwest upslope flow, which unloads farther north and west.",
    ],
    wind: "Summit lifts face west winds and can be held on gusty days." },
  cannon: { setups: ["noreaster", "upslope"], hold: 40, exposed: [270, 360], upslope: [280, 350],
    notes: [
      "Franconia Notch channels northwest wind and traps cold air, so Cannon often runs colder and icier than its elevation suggests.",
      "Snow quality and coverage up top depend heavily on wind: strong northwest flow scours exposed faces.",
    ],
    wind: "The Aerial Tramway is one of the most wind-prone lifts in New England and frequently holds in strong northwest winds." },
  bretton: { setups: ["upslope", "noreaster"], hold: 50, exposed: [250, 330], upslope: [260, 330],
    notes: [
      "Faces west toward the Presidential Range approach, so it catches west to northwest upslope snow that eastern White Mountain resorts miss.",
      "Its trails are relatively sheltered, which makes it a good bet on windy days.",
    ],
    wind: "Relatively sheltered for its elevation, though summit lifts on Mount Rosebrook can still hold in strong winds." },
  wildcat: { setups: ["noreaster", "upslope"], hold: 40, exposed: [270, 360], upslope: [280, 340],
    notes: [
      "Directly across Pinkham Notch from Mount Washington, home of some of the strongest winds on earth. Northwest flow through the notch is both its snow source and its lift-hold risk.",
      "North-facing terrain keeps snow cold late into the season.",
    ],
    wind: "Very exposed to northwest winds funneling through Pinkham Notch. The summit lift goes on wind hold often." },
  attitash: { setups: ["noreaster"], hold: 45, exposed: [250, 340], shadow: [270, 340],
    notes: [
      "With a base near 600 ft, one of the lowest resorts on this list. The rain-snow line in coastal storms decides its day more than any other factor.",
      "Sits east of the Presidentials, so northwest flow is mostly downslope and dry here.",
    ],
    wind: "Summit lifts on Attitash and Bear Peak can hold in strong winds." },
  loon: { setups: ["noreaster", "upslope"], hold: 45, exposed: [250, 340], upslope: [270, 330],
    notes: [
      "On the western side of the White Mountains, so it gets some northwest upslope snow, but the lower base (under 1,000 ft) is prone to mixing in coastal storms.",
    ],
    wind: "The Gondola and North Peak lifts are the most wind-exposed." },
  waterville: { setups: ["noreaster"], hold: 50, exposed: [250, 340],
    notes: [
      "Tucked into a bowl at the end of the valley, which shelters it from wind but also from much upslope snow. Coastal storms bring most of its natural snow.",
      "A near-2,000 ft base keeps marginal storms snowier than lower White Mountain resorts.",
    ],
    wind: "The bowl protects most lifts from wind, so holds are less common than at nearby peaks." },
  sugarloaf: { setups: ["noreaster", "upslope"], hold: 40, exposed: [250, 340], upslope: [270, 330],
    notes: [
      "Far north and high, so it is one of the most reliable spots in the East to stay all snow in coastal storms.",
      "The above-treeline snowfields need a big storm and calm winds to open. Strong northwest flow strips them.",
    ],
    wind: "The summit snowfields and upper lifts are often closed or on hold in high winds." },
  saddleback: { setups: ["noreaster", "upslope"], hold: 45, exposed: [250, 340], upslope: [270, 330],
    notes: [
      "The base is near 2,500 ft, among the highest in New England, so marginal storms that rain on lower Maine resorts often stay snow here.",
    ],
    wind: "The upper lifts to the summit ridge are exposed to westerly winds." },
  sundayriver: { setups: ["noreaster"], hold: 45, exposed: [250, 340], shadow: [270, 330],
    notes: [
      "Low base (about 800 ft) and a big snowmaking system. It usually opens early in November on manmade snow when nights cooperate.",
      "Coastal storms are the main natural snow source; northwest flow is mostly dry by the time it gets here.",
    ],
    wind: "Upper lifts on Oz and Jordan Bowl can see wind holds." },
  whiteface: { setups: ["noreaster", "upslope"], hold: 40, exposed: [240, 330], upslope: [270, 330],
    notes: [
      "The most vertical in the East, from a 1,200 ft base to above 4,600 ft. Summit and base can be in different weather.",
      "The upper mountain is often scoured by wind, so fresh snow tends to collect on the lower and mid trails.",
    ],
    wind: "The Summit Quad and upper mountain frequently go on wind hold. The Cloudsplitter Gondola is also exposed." },
  gore: { setups: ["noreaster", "upslope"], hold: 45, exposed: [250, 340], upslope: [280, 340], lake: [270, 300],
    notes: [
      "In the southern Adirondacks. Strong west-northwest flow off Lake Ontario occasionally reaches this far east as a weakened lake band.",
      "Multiple peaks and aspects give options when the wind picks up.",
    ],
    wind: "Summit lifts and the Northwoods Gondola can hold in high winds." },
  snowridge: { setups: ["lake"], hold: 50, exposed: [240, 300], lake: [250, 290],
    notes: [
      "On the Tug Hill Plateau, the snowiest place east of the Rockies. West winds blowing the length of Lake Ontario aim bands straight at it.",
      "Lake-effect bands are narrow. A shift of 20 degrees in wind direction can move the snow from feet here to flurries 15 miles away, and the models rarely place it exactly.",
    ],
    wind: "Low elevation means wind holds are rare." },
  holidayvalley: { setups: ["lake", "west"], hold: 50, exposed: [220, 300], lake: [230, 300],
    notes: [
      "In western New York's snowbelt. Southwest to west winds off Lake Erie bring the bands; northwest flow sends them elsewhere.",
      "Lake Erie freezes in many winters, which shuts off lake effect from about mid-January on.",
    ],
    wind: "Fairly sheltered. Holds are uncommon." },
  hunter: { setups: ["noreaster", "southern"], hold: 45, exposed: [250, 340],
    notes: [
      "The Catskills are close to the rain-snow line in most coastal storms. Track and timing decide everything, and snowmaking does much of the work.",
      "Easy drive from New York City, so crowds follow fresh snow on weekends.",
    ],
    wind: "Upper lifts can hold in strong northwest winds." },
  windham: { setups: ["noreaster", "southern"], hold: 45, exposed: [250, 340],
    notes: [
      "Northern Catskills. Coastal storms that stay just offshore are the best case. Inland tracks bring mix.",
    ],
    wind: "Upper lifts can hold in strong northwest winds." },
  belleayre: { setups: ["noreaster", "southern"], hold: 45, exposed: [250, 340],
    notes: [
      "The highest skiable elevation in the Catskills, and the 2,000 ft base sometimes keeps it snow when lower Catskill resorts mix.",
    ],
    wind: "Upper lifts face west winds." },
  jiminy: { setups: ["noreaster", "upslope"], hold: 45, exposed: [250, 340], upslope: [280, 330],
    notes: [
      "On the western edge of the Berkshires, so strong northwest flow can squeeze out a few inches here that the Pioneer Valley never sees.",
      "Coastal storms bring most of the natural snow, but this far south many of them mix.",
    ],
    wind: "Summit lifts can hold in strong west winds." },
  camelback: { setups: ["noreaster", "southern"], hold: 50, exposed: [250, 340],
    notes: [
      "In the Poconos, at low elevation. Many storms mix or turn to rain, and the season leans heavily on snowmaking cold nights.",
    ],
    wind: "Low elevation. Holds are uncommon." },
  sevensprings: { setups: ["upslope", "lake"], hold: 50, exposed: [250, 340], upslope: [270, 340], lake: [290, 340],
    notes: [
      "On the Laurel Ridge, the first ridge northwest flow hits after crossing Ohio. Cold northwest winds behind fronts, sometimes fed by Lake Erie moisture, bring steady light snow.",
      "Storms tracking to the west bring rain more often than snow.",
    ],
    wind: "Fairly sheltered. Holds are uncommon." },
  snowshoe: { setups: ["upslope"], hold: 45, exposed: [260, 350], upslope: [270, 340],
    notes: [
      "On the Allegheny Front at nearly 4,850 ft, the main upslope target in the Mid-Atlantic. Northwest flow behind cold fronts can produce snow for a day or two while the valleys stay dry.",
      "The village sits at the summit and the base is at the bottom, so the bottom of the mountain is the warmest point, not the start of your day.",
    ],
    wind: "The village is at the summit and lifts run from the top down. Strong northwest winds can hold the upper lifts." },
};
