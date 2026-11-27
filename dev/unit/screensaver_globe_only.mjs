// The Flights screensaver always draws the globe (no HA map, no flat picture): any saved casora_flights_map value, zoom 1.25
// clipped to the disc, soft inner country borders from countries-110m.json, and the music saver's layout with its text column
// (route caption, flight number, altitude and speed, progress bar with percent and total time, time left, arrival).
//   node dev/unit/screensaver_globe_only.mjs
// @deckt: custom_components/casora/scripts/local/46-screensaver.js#globeLoad,globeProjection,globeSvg,DRAW,html,CSS
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page, globeFiles, settle, read, ASSETS, SLOT0 } from './lib/globe_page.mjs';

const NBSP = ' ';
const show = async (o = {}) => {
  const R = page(globeFiles());
  Object.assign(R.flight, { time_real_departure: SLOT0 / 1000 - 4 * 3600 }, o.flight || {});
  if (o.vars) R.vars = o.vars;
  R.start(); await settle(); R.api.update();
  return R;
};
const plain = (h) => h.replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n');

// Every saved value of the old setting draws the globe, and no HA map element is ever in the page.
for (const v of [undefined, '', 'globe', 'flat', 'junk']) {
  const R = await show({ vars: v === undefined ? {} : { casora_flights_map: v } });
  assert.match(R.host.innerHTML, /<svg class="cs-gl-svg"/, 'saved value ' + JSON.stringify(v) + ': the globe');
  assert.ok(!/casora-flight-map|cs-fl-svg|cs-fl-pic/.test(R.host.innerHTML), 'no HA map, no flat picture');
  assert.ok(R.box.requests.includes('/casora_assets/globe/land-110m.json'), 'the files load without the setting');
}
{
  const R = await show();
  for (const name of ['liveMap', 'mountKeepingMap', 'routeFrame', 'routeSvg', 'routeMarker', 'routePicStyle', 'globeOn']) assert.equal(R.S[name], undefined, 'S.' + name + ' is gone');
  assert.ok(!/data-saver|SAVER_CSS/.test(read('custom_components/casora/scripts/local/49-flights.js')), 'the popup map has no saver mode');
}

// Zoom 1.25: the disc shows the part of the sphere within asin(1/1.25) = 53.13 degrees of the aircraft; the rest lies outside.
{
  const R = await show();
  const P = R.S.globeProjection({ cur: [50.21, 10.12] });
  const edge = P([10.12, 50.21 - 53.1301]);
  assert.ok(Math.abs(Math.hypot(edge[0] - 500, edge[1] - 500) - 500) < 0.05, 'a point 53.13 degrees away is on the rim of the disc');
  const out = P([10.12, 50.21 - 70]);
  assert.ok(Math.hypot(out[0] - 500, out[1] - 500) > 500, 'a point 70 degrees away lies outside the disc');
  assert.match(R.S.CSS.match(/\.cs-sv \.cs-gl-svg\{[^}]*\}/)[0], /border-radius:50%/, 'what lies outside the disc is clipped');
  assert.match(R.S.CSS.match(/\.cs-sv \.cs-gl-svg\{[^}]*\}/)[0], /overflow:hidden/);
}

// Soft borders: the inner borders of countries-110m.json, between the land and the flight, thin and faint.
{
  const R = await show();
  const html = R.host.innerHTML;
  assert.ok(R.box.requests.includes('/casora_assets/globe/countries-110m.json'), 'the countries file is asked for from the integration');
  const land = html.indexOf('class="cs-gl-land"'), border = html.indexOf('class="cs-gl-border"'), route = html.indexOf('class="cs-gl-route"');
  assert.ok(land > 0 && border > land && route > border, 'order: land, borders, then the flight');
  const d = html.match(/<path class="cs-gl-border" fill="none" d="([^"]+)"/);
  assert.ok(d && d[1].length > 200, 'borders are drawn');
  const rule = R.S.CSS.match(/\.cs-sv \.cs-gl-border\{[^}]*\}/)[0];
  assert.match(rule, /stroke:rgba\(25,\s*22,\s*19,\s*\.7\)/, 'the land line colour');
  assert.match(rule, /stroke-opacity:\.25/); assert.match(rule, /stroke-width:\.75/);
  // The file is the world-atlas countries topology, listed in the folder's licence.
  const topo = JSON.parse(read(ASSETS + 'countries-110m.json'));
  assert.equal(topo.type, 'Topology'); assert.ok(topo.objects.countries, 'objects.countries');
  assert.match(read(ASSETS + 'LICENSE.md'), /`countries-110m\.json` .*world-atlas 2\.0\.2/);
  // The countries file is decoration: missing or broken, the globe still draws (land, flight, airports), only without the border path.
  for (const [what, text] of [['missing', undefined], ['broken', '{"type":"Topology"']]) {
    const files = globeFiles(); files['countries-110m.json'] = text;
    const M = page(files); M.start(); await settle(); M.api.update();
    assert.ok(/class="cs-gl-svg"/.test(M.host.innerHTML) && /class="cs-gl-land"/.test(M.host.innerHTML), 'countries ' + what + ': the globe is drawn');
    assert.ok(!/cs-gl-border/.test(M.host.innerHTML), 'countries ' + what + ': no border path');
    assert.ok(/class="cs-gl-plane"/.test(M.host.innerHTML) && /cs-meta/.test(M.host.innerHTML), 'countries ' + what + ': the flight and the text stay');
  }
  // The land file is not decoration: broken, no globe, the text column stays.
  {
    const files = globeFiles(); files['land-110m.json'] = '{"type":"Topology"';
    const M = page(files); M.start(); await settle(); M.api.update();
    assert.ok(!/cs-gl-svg/.test(M.host.innerHTML) && /cs-meta/.test(M.host.innerHTML), 'broken land: no globe, the text stays');
  }
}

// Airports: only those the disc shows. The sphere is drawn 1.25 times as wide, so the disc ends asin(1/1.25) = 53.13 degrees from
// the aircraft; one farther out gets no dot and no code, one nearer does.
{
  const R = await show({ flight: { airport_origin_latitude: 10.2, airport_origin_longitude: 10.1, airport_origin_code_iata: 'NEA', airport_destination_latitude: -8, airport_destination_longitude: 10.1, airport_destination_code_iata: 'FAR' } });
  const dots = R.host.innerHTML.match(/class="cs-gl-ap"/g) || [];
  assert.equal(dots.length, 1, 'the airport 40 degrees away has its dot, the one 58 degrees away has none: ' + dots.length);
  assert.ok(/>NEA<\/text>/.test(R.host.innerHTML) && !/>FAR<\/text>/.test(R.host.innerHTML), 'the near code is there, the far code is not');
}

// Layout like the music saver: the globe square on the left, the text column on the right, clock and date top right.
{
  const R = await show();
  const html = R.host.innerHTML, css = R.S.CSS;
  assert.match(html, /<div class="cs-corner"><div class="cs-time">[^<]+<\/div><div class="cs-date">[^<]+<\/div><\/div>/, 'clock and date in the corner');
  assert.ok(!/sv-head/.test(html), 'no head');
  // One rule places both boxes (and the narrow-box rules after it): a change to the box touches one place.
  const rules = css.match(/[^{}]*\.cs-fl-live[^{}]*\{[^}]*\}/g) || [];
  assert.ok(rules.length >= 3 && rules.every((r) => /\.cs-sv \.cs-cover, \.cs-sv \.cs-fl-live\{/.test(r)), 'every .cs-fl-live rule is in a list with .cs-cover: ' + rules.map((r) => r.slice(-60)));
  const base = rules[0];
  for (const prop of ['position', 'left', 'top', 'width', 'height', 'margin-top']) assert.ok(new RegExp('[{;]' + prop + ':').test(base), 'the shared box rule has ' + prop);
  assert.match(html, /<div class="cs-fl-live cs-fl-globe"><svg/, 'the globe box');
}

// The text column, top to bottom.
{
  const R = await show();
  const html = R.host.innerHTML, col = html.slice(html.indexOf('<div class="cs-meta cs-fl-meta">'));
  const at = (s) => { const i = col.indexOf(s); assert.ok(i > 0, s + ' is in the column'); return i; };
  const order = [at('<div class="cs-cap" data-no-i18n>'), at('<h2 data-no-i18n>XY1</h2>'), at('<h3'), at('<span data-flights-bar'), at('Restzeit'), at('class="cs-fl-arr"')];
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'caption, flight number, altitude and speed, bar, time left, arrival');
  assert.match(col, /<h3[^>]*>35,000 ft · 450 kn<\/h3>/, 'altitude and ground speed in the saved units, joined so the dot cannot sit at a line edge');
  const row = col.match(/<div class="cs-tt">(.*?)<\/div>/)[1];
  assert.match(row, /^<span>\d+[  ]?%<\/span><span class="cs-fl-tot">Gesamt 5:23 Std\.<\/span>$/, 'percent left, total right: ' + row);
  assert.match(col, /Restzeit 1:23 Std\./, 'time left');
  assert.ok(!/Ungefährer Fortschritt/.test(html), 'the hand-built progress text is gone');
  assert.ok(!/ · | ·$|^· /m.test(plain(col)), 'no dot with a plain space beside it: ' + JSON.stringify(plain(col)));
  assert.ok(!/cs-fl-pct/.test(R.S.CSS + html), 'the music saver\'s time row (cs-tt) is reused: flex, space-between');
  assert.match(R.S.CSS.match(/\.cs-sv \.cs-tt\{[^}]*\}/)[0], /display:flex[^}]*justify-content:space-between/);
  assert.match(R.S.CSS.match(/\.cs-sv \.cs-fl-meta \.cs-tt\{[^}]*\}/)[0], /white-space:nowrap/, 'nothing in the row runs on to a second line');
}
// Without a known progress: no bar, no percent (the time left stays).
{
  const R = await show({ flight: { coordinates: [], latitude: 50.2, longitude: 10.1, airport_origin_latitude: undefined, airport_origin_longitude: undefined } });
  const col = R.host.innerHTML.slice(R.host.innerHTML.indexOf('<div class="cs-meta cs-fl-meta">'));
  assert.ok(!/data-flights-bar|%/.test(col), 'no bar, no percent');
  assert.match(col, /Restzeit/, 'the time left stays');
}

// Only the total is known (no position fix, but a scheduled duration): no bar, no percent, the total alone on its row.
{
  const R = await show({ flight: { coordinates: [], airport_origin_latitude: undefined, airport_origin_longitude: undefined,
    time_scheduled_departure: SLOT0 / 1000 - 4 * 3600, time_scheduled_arrival: SLOT0 / 1000 + 5400, time_real_departure: undefined } });
  const col = R.host.innerHTML.slice(R.host.innerHTML.indexOf('<div class="cs-meta cs-fl-meta">'));
  assert.ok(!/data-flights-bar|%/.test(col), 'no bar, no percent');
  assert.match(col, /<div class="cs-tt"><span class="cs-fl-tot">Gesamt\s5:\d\d\sStd\.<\/span><\/div>/, 'only the total, on its row: ' + col);
}
// The total keeps its capital in Dutch: "Totaal 9:48 u" (the flight popup's label).
{
  const nl = JSON.parse(read('custom_components/casora/translations/dashboard/phrases/nl.json')).exact;
  const R = page(globeFiles()); R.box.casoraTr = (t) => nl[t] || t;
  Object.assign(R.flight, { time_real_departure: SLOT0 / 1000 - 4 * 3600 });
  R.start(); await settle(); R.api.update();
  const col = R.host.innerHTML.slice(R.host.innerHTML.indexOf('<div class="cs-meta cs-fl-meta">'));
  assert.match(col, /<span class="cs-fl-tot">Totaal\u00a05:23\u00a0u\.?<\/span>/, 'nl: Totaal with a capital: ' + col.match(/cs-fl-tot[^/]*/));
}

// The Studio setting stays in the code but is hidden.
{
  const { loadPanel } = await import('./lib/testhaus.mjs');
  const { I } = await loadPanel();
  const field = I.SECTIONS.find((s) => s.label === 'General').fields.find((f) => f.key === 'casora_flights_map');
  assert.ok(field, 'the field stays for the flat map option');
  assert.equal(field.when({ casora_screensaver: '5' }, { entities: {}, states: {}, devices: {} }), false, 'never shown');
  assert.equal(field.when({ casora_screensaver: '5' }, { entities: { 'sensor.a': { entity_id: 'sensor.a', platform: 'flightradar24', device_id: 'd1', translation_key: 'additional_tracked' } }, states: { 'sensor.a': { entity_id: 'sensor.a', state: '0', attributes: { flights: [] } } }, devices: {} }), false, 'not even with FlightRadar24');
}
console.log('screensaver_globe_only: ok');
