// The flight on the globe: Flown trail, Unreported part and Remaining route as lines on the disc, cut at the horizon, bent as great
// circles, one short path over the dateline. Real d3 from assets/globe runs in the page.
//   node dev/unit/screensaver_globe_flight.mjs
// @deckt: custom_components/casora/scripts/local/46-screensaver.js#globeSvg,globeLayers,DRAW
import assert from 'node:assert/strict';
import { page, globeFiles, settle } from './lib/globe_page.mjs';

const SIZE = 1000, C = SIZE / 2;
// A flight on the globe: `fl` overrides the fixture flight. The aircraft is at fl.latitude + .01, fl.longitude + .02 (the fixture's move).
const show = async (fl) => {
  const R = page(globeFiles());
  R.vars = { casora_flights_map: 'globe' };
  Object.assign(R.flight, fl);
  R.start(); await settle(); R.api.update();
  return R;
};
const layer = (html, cls) => {
  const m = html.match(new RegExp('<path class="' + cls + '"[^>]*? d="([^"]*)"'));
  return m ? m[1] : null;
};
const subpaths = (d) => (d.match(/M/g) || []).length;
const points = (d) => [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [+m[1], +m[2]]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const nearest = (d, p) => Math.min(...points(d).map((q) => dist(q, p)));
const bbox = (d) => { const p = points(d); const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };

// The great circle: Amsterdam area to New York area. The midpoint of that great circle, worked out by hand with the spherical
// midpoint formula: 53.6 N, 39.5 W (a straight line in latitude and longitude would pass 46.5 N, 34.5 W, far from it).
{
  const R = await show({ latitude: 52.3, longitude: 4.8, airport_destination_latitude: 40.6, airport_destination_longitude: -73.8, coordinates: [[52, 4], [52.2, 4.6]] });
  const html = R.host.innerHTML;
  const route = layer(html, 'cs-gl-route');
  assert.ok(route, 'the Remaining route is drawn');
  assert.equal(subpaths(route), 1, 'one line');
  const P = R.S.globeProjection({ cur: [52.31, 4.82] });
  const mid = P([-39.54, 53.56]);
  assert.ok(nearest(route, mid) < 4, 'the route passes the great circle midpoint (' + nearest(route, mid).toFixed(1) + ' units away)');
  assert.ok(dist(mid, P([-34.49, 46.46])) > 40, 'the straight-line midpoint would be far from it');
  assert.ok(nearest(route, P([-73.8, 40.6])) < 4, 'the route ends at the destination');
  assert.ok(layer(html, 'cs-gl-trail'), 'the Flown trail is drawn');
  assert.match(html, /<path class="cs-gl-route"[^>]*stroke-dasharray/, 'the Remaining route is dashed');
}

// The horizon: the Unreported part runs from the departure airport (Sydney, far side) to the trail's start (near the aircraft over
// Europe). It is cut where the sphere turns away: nothing of it lies outside the disc, and it reaches the rim. An Unreported part wholly on the far side is not drawn.
{
  const R = await show({ latitude: 50, longitude: 10, airport_origin_latitude: -33.9, airport_origin_longitude: 151.2, coordinates: [[51, 9], [50.5, 9.5]],
    airport_destination_latitude: 52, airport_destination_longitude: 20 });
  const un = layer(R.host.innerHTML, 'cs-gl-unrep');
  assert.ok(un, 'the near part of the Unreported part is drawn');
  const r = points(un).map((q) => dist(q, [C, C]));
  assert.ok(Math.max(...r) <= C + 0.5, 'nothing outside the disc (' + Math.max(...r).toFixed(2) + ')');
  assert.ok(Math.max(...r) > C - 1.5, 'the line is cut at the rim, not before it');
  const far = await show({ latitude: 50, longitude: 10, airport_origin_latitude: -33.9, airport_origin_longitude: 151.2, coordinates: [[-40, 170], [-41, 171], [50, 10]] });
  assert.equal(layer(far.host.innerHTML, 'cs-gl-unrep'), null, 'an arc wholly behind the horizon is not drawn');
  assert.ok(layer(far.host.innerHTML, 'cs-gl-trail'), 'the trail that ends at the aircraft is drawn up to the horizon');
}

// The dateline: Tokyo to Anchorage, the aircraft just west of the dateline. Every line is one short path, not around the world.
{
  const R = await show({ latitude: 52, longitude: 178, airport_origin_latitude: 35.5, airport_origin_longitude: 139.8,
    airport_destination_latitude: 61.2, airport_destination_longitude: -150, coordinates: [[40, 150], [46, 165], [50, 175], [51, 179.5], [51.5, -179.5]] });
  const html = R.host.innerHTML, P = R.S.globeProjection({ cur: [52.01, -179.96] });
  for (const cls of ['cs-gl-unrep', 'cs-gl-trail', 'cs-gl-route']) {
    const d = layer(html, cls);
    assert.ok(d, cls + ' is drawn');
    assert.equal(subpaths(d), 1, cls + ' is one path');
    const [x0, , x1] = bbox(d);
    assert.ok(x1 - x0 < C, cls + ' is short (' + (x1 - x0).toFixed(0) + ' units wide), not around the world');
  }
  const [x0, , x1] = bbox(layer(html, 'cs-gl-route'));
  assert.ok(nearest(layer(html, 'cs-gl-route'), P([-150, 61.2])) < 4, 'the route ends at Anchorage, east of the dateline');
  assert.ok(x1 > C && x0 >= C - 5, 'the route goes on to the right of the aircraft');
  // The other way: Auckland to Los Angeles, the aircraft already east of the dateline.
  const A = await show({ latitude: -20, longitude: -178, airport_origin_latitude: -37, airport_origin_longitude: 174.8,
    airport_destination_latitude: 33.9, airport_destination_longitude: -118.4, coordinates: [[-30, 178], [-25, 179.5], [-22, -179]] });
  for (const cls of ['cs-gl-unrep', 'cs-gl-trail', 'cs-gl-route']) {
    const d = layer(A.host.innerHTML, cls);
    assert.ok(d && subpaths(d) === 1 && bbox(d)[2] - bbox(d)[0] < C, cls + ' (Auckland to Los Angeles) is one short path');
  }
}

// Airports and the aircraft. Codes show for airports on the visible side only: no dot, no text for one behind the horizon.
{
  const near = await show({ latitude: 50, longitude: 10, heading: 90, airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB', coordinates: [[50, 4], [50.1, 5]] });
  const html = near.host.innerHTML;
  assert.equal((html.match(/<circle class="cs-gl-ap"/g) || []).length, 2, 'both airports are marked');
  assert.match(html, /<text class="cs-gl-code"[^>]*>AAA<\/text>/, 'the departure code');
  assert.match(html, /<text class="cs-gl-code"[^>]*>BBB<\/text>/, 'the arrival code');
  const P = near.S.globeProjection({ cur: [50.01, 10.02] }), b = P([20, 52]);
  assert.match(html, new RegExp('<circle class="cs-gl-ap" cx="' + b[0].toFixed(2).replace('.', '\\.') + '" cy="' + b[1].toFixed(2).replace('.', '\\.') + '"'), 'the arrival dot sits where the projection puts it');
  const plane = html.match(/<g class="cs-gl-plane" transform="translate\(([\d.]+) ([\d.]+)\) rotate\(([\d.]+)\)"/);
  assert.ok(plane && +plane[1] === C && +plane[2] === C && +plane[3] === 90, 'the aircraft is in the middle, turned to its heading');
  const behind = await show({ latitude: 50, longitude: 10, airport_origin_latitude: -33.9, airport_origin_longitude: 151.2, airport_origin_code_iata: 'SYD', airport_destination_code_iata: 'BBB', coordinates: [[50, 4]] });
  const h2 = behind.host.innerHTML;
  assert.equal((h2.match(/<circle class="cs-gl-ap"/g) || []).length, 1, 'the airport behind the horizon is not marked');
  assert.ok(!/SYD/.test(h2.slice(h2.indexOf('cs-gl-svg'), h2.indexOf('</svg>', h2.indexOf('cs-gl-svg')))), 'and has no code on the globe');
  assert.match(h2, />BBB<\/text>/, 'the near one keeps its code');
}

// Colours and contrast: the colours come from the saver's own CSS; each mark, blended over the land, is at least 3:1 against it.
{
  const css = (await show({})).S.CSS;
  const rule = (sel) => (new RegExp(sel.replace(/\./g, '\\.') + '\\{([^}]*)\\}').exec(css) || [])[1] || '';
  const colour = (decl, prop) => { const m = new RegExp('(?:^|;)' + prop + ':(#[0-9A-Fa-f]{6}|rgba\\(([^)]*)\\))').exec(decl); assert.ok(m, prop + ' in ' + decl);
    if (m[1][0] === '#') return { rgb: [1, 3, 5].map((i) => parseInt(m[1].slice(i, i + 2), 16)), a: 1 };
    const q = m[2].split(',').map(Number); return { rgb: q.slice(0, 3), a: q[3] }; };
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const land = colour(rule('.cs-sv .cs-gl-land'), 'fill').rgb;
  const over = (c) => c.rgb.map((v, i) => v * c.a + land[i] * (1 - c.a));
  const marks = { trail: colour(rule('.cs-sv .cs-gl-trail'), 'stroke'), route: colour(rule('.cs-sv .cs-gl-route'), 'stroke'), unreported: colour(rule('.cs-sv .cs-gl-unrep'), 'stroke'),
    text: colour(rule('.cs-sv .cs-gl-code'), 'fill'), aircraft: colour(rule('.cs-sv .cs-gl-plane path'), 'fill'), airport: colour(rule('.cs-sv .cs-gl-ap'), 'fill') };
  assert.deepEqual(marks.trail, { rgb: [246, 239, 230], a: 1 }, 'Flown trail #F6EFE6 solid');
  assert.deepEqual(marks.route, { rgb: [246, 239, 230], a: 0.72 }, 'Remaining route off-white at 72 %');
  assert.deepEqual(marks.unreported, { rgb: [246, 239, 230], a: 0.45 }, 'Unreported part off-white at 45 %');
  assert.deepEqual(marks.text, { rgb: [247, 241, 232], a: 1 }, 'text #F7F1E8');
  assert.deepEqual(marks.aircraft, { rgb: [224, 138, 92], a: 1 }, 'aircraft #E08A5C');
  const out = [];
  for (const [name, c] of Object.entries(marks)) { const r = ratio(over(c), land); out.push(name + ' ' + r.toFixed(2)); assert.ok(r >= 3, name + ' on the land: ' + r.toFixed(2) + ':1'); }
  assert.match(rule('.cs-sv .cs-gl-plane path'), /stroke:#191613/, 'the aircraft has a dark edge');
  console.log('contrast on land #4A443C: ' + out.join(', '));
}

console.log('screensaver_globe_flight: ok');
