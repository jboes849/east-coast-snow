// Small inline SVG icon set (stroke icons, inherit currentColor).
window.Icon = (function () {
  const wrap = (body, cls = "") => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const flake = `<path d="M12 2v20M4.9 6.5l14.2 11M19.1 6.5 4.9 17.5"/><path d="m9.5 3.5 2.5 2 2.5-2M9.5 20.5l2.5-2 2.5 2M3.4 9.6l3.1-.4-.9-3M20.6 14.4l-3.1.4.9 3M5.6 17.8l.9-3-3.1-.4M18.4 6.2l-.9 3 3.1.4"/>`;
  const cloud = `<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 11 3.5 3.5 0 0 0 7 18Z"/>`;
  const icons = {
    flake: wrap(flake),
    snow: wrap(`<g transform="translate(0 -3)">${cloud}</g><path d="M8 19h.01M12 21h.01M16 19h.01M10 17.5h.01M14 17.5h.01" stroke-width="2.6"/>`),
    heavySnow: wrap(`<g transform="translate(0 -4)">${cloud}</g><path d="M7 17h.01M10 19h.01M13 17h.01M16 19h.01M8.5 21.5h.01M11.5 21.5h.01M14.5 21.5h.01M17 16.5h.01" stroke-width="2.6"/>`),
    rain: wrap(`<g transform="translate(0 -4)">${cloud}</g><path d="m8 17-1 3M12 17l-1 3M16 17l-1 3"/>`),
    mix: wrap(`<g transform="translate(0 -4)">${cloud}</g><path d="m8 17-1 3M15 18h.01M12 20h.01" stroke-width="2"/>`),
    sun: wrap(`<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`),
    partly: wrap(`<path d="M8 3v1.5M3.6 5.6l1 1M2 10h1.5M12.4 5.6l-1 1"/><path d="M5.2 12.3A3.5 3.5 0 1 1 11.6 9"/><path d="M9 20h8a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 8.1 13.6 3.2 3.2 0 0 0 9 20Z"/>`),
    cloud: wrap(cloud),
    wind: wrap(`<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>`),
    thermo: wrap(`<path d="M10 14.8V4a2 2 0 1 1 4 0v10.8a4 4 0 1 1-4 0Z"/><path d="M12 9v7"/>`),
    gun: wrap(`<path d="M4 18 14 8M14 8l3-3 3 3-3 3-3-3Z"/><path d="M6 6h.01M9 4h.01M5 10h.01M8 8h.01" stroke-width="2.4"/>`),
    star: wrap(`<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3Z"/>`),
    starFill: wrap(`<path fill="currentColor" d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3Z"/>`),
    close: wrap(`<path d="M6 6l12 12M18 6 6 18"/>`),
    radar: wrap(`<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 18 6"/>`),
    search: wrap(`<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>`),
    grid: wrap(`<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>`),
    table: wrap(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>`),
    mountain: wrap(`<path d="m3 20 6.5-11 3.5 5.5L15.5 11 21 20H3Z"/><path d="m8 11.5 1.5 1 1.5-1"/>`),
    info: wrap(`<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`),
    gauge: wrap(`<path d="M4 16a8 8 0 1 1 16 0"/><path d="m12 16 4-5"/>`),
    bars: wrap(`<path d="M4 20V12M9 20V6M14 20v-9M19 20V9M3 20h18"/>`),
    layers: wrap(`<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>`),
  };
  return (name, cls) => (cls ? icons[name].replace('class="icon ', `class="icon ${cls} `) : icons[name]);
})();
