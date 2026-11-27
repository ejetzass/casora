// The globe of the Flights saver (files loaded): a full disc as large as its box, orthographic, zoom 1.25, centered on the aircraft's
// position, north up, matte, in Casora's colours.
//   node dev/unit/screensaver_globe.mjs
// @deckt: custom_components/casora/scripts/local/46-screensaver.js#globeProjection,globeSvg,DRAW,html
import assert from 'node:assert/strict';
import { page, globeFiles, settle } from './lib/globe_page.mjs';

const R = page(globeFiles());
R.start();
const before = R.host.innerHTML;
await settle();
R.api.update();
const globe = R.host.innerHTML;

// The view: the aircraft stood at 50.21 N, 10.12 E.
const SIZE = 1000;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, msg + ' (' + a + ' vs ' + b + ')');
{
  const P = R.S.globeProjection({ cur: [50.21, 10.12] });
  const [cx, cy] = P([10.12, 50.21]);
  near(cx, SIZE / 2, 0.01, 'the aircraft is in the middle (x)'); near(cy, SIZE / 2, 0.01, 'the aircraft is in the middle (y)');
  const north = P([10.12, 51.21]), east = P([11.12, 50.21]);
  near(north[0], SIZE / 2, 0.5, 'north of the aircraft is straight up'); assert.ok(north[1] < SIZE / 2, 'north is up');
  assert.ok(east[0] > SIZE / 2, 'east is to the right');
  // Zoom 1.25: the rim of the disc is asin(1 / 1.25) = 53.13 degrees from the centre; it lies on the edge of the square the disc is drawn in.
  const rim = P([10.12, 50.21 - 53.1301]);
  near(Math.hypot(rim[0] - SIZE / 2, rim[1] - SIZE / 2), SIZE / 2, 0.05, 'a point 53.13 degrees away is on the rim: the disc fills the square');
  // Near the dateline and far south: still the middle, still north up.
  const Q = R.S.globeProjection({ cur: [-33, 179.9] });
  const mid = Q([179.9, -33]), up = Q([179.9, -32]), across = Q([-179.9, -33]);
  near(mid[0], SIZE / 2, 0.01, 'dateline: the aircraft is in the middle'); assert.ok(up[1] < mid[1], 'dateline: north is up');
  assert.ok(across[0] > mid[0] && across[0] - mid[0] < 10, 'across the dateline the world just goes on to the right (no seam)');
  assert.equal(R.S.globeProjection({}), null, 'no position, no projection');
}

// The picture: the globe in its box; before the files are there the page has no globe.
assert.ok(!/cs-gl-svg/.test(before), 'no globe before the files');
assert.ok(!/cs-fl-svg/.test(globe), 'no flat route picture');
assert.match(globe, /<div class="cs-fl-live cs-fl-globe[^"]*"[^>]*><svg[^>]*viewBox="0 0 1000 1000"[^>]*preserveAspectRatio="xMidYMid meet"/, 'a square picture that meets its box: the disc is as large as the box allows');
assert.match(globe, /<circle class="cs-gl-sea" cx="500" cy="500" r="500"\/>/, 'the ocean is the full disc');
const land = globe.match(/<path class="cs-gl-land" d="([^"]+)"/);
assert.ok(land && land[1].length > 500, 'the land is drawn');
assert.match(globe, /cs-flights cs-dark cs-globe|cs-globe/, 'the scene takes the globe ground');
assert.match(globe, /<h2 data-no-i18n>XY1<\/h2>/, 'the text column stays');
assert.ok(!/casora-flight-map/.test(globe), 'no second map over the globe');
// Matte: nothing but flat fills and the coastline.
assert.ok(!/<filter|Gradient|blur|shadow|glow|opacity/i.test(globe.slice(globe.indexOf('cs-gl-svg'), globe.indexOf('</svg>'))), 'no glow, no lighting');
assert.ok(!/https?:|url\(|<img|<image|<link|<script/i.test(globe), 'nothing external');

// The land moves with the aircraft: the same flight a little east draws another path.
R.clock += 20000; R.hass.states['sensor.fr24'].attributes.flights = [{ ...R.hass.states['sensor.fr24'].attributes.flights[0], longitude: 30, latitude: 5 }];
R.api.update();
const moved = R.host.innerHTML.match(/<path class="cs-gl-land" d="([^"]+)"/);
assert.ok(moved && moved[1] !== land[1], 'the land follows the aircraft');

// The colours of the decision.
const css = R.S.CSS;
const rule = (sel) => (new RegExp(sel.replace(/[.]/g, '\\.') + '\\{([^}]*)\\}').exec(css) || [])[1] || '';
assert.match(rule('.cs-sv .cs-gl-sea'), /fill:#24211E/i);
assert.match(rule('.cs-sv .cs-gl-land'), /fill:#4A443C/i);
assert.match(rule('.cs-sv .cs-gl-land'), /stroke:rgba\(25,\s*22,\s*19,\s*\.7\)/);
assert.match(rule('.cs-sv.cs-flights.cs-globe'), /#1D1A17[^;]*#191613/i, 'ground: a gradient from #1D1A17 to #191613');

console.log('screensaver_globe: ok');
