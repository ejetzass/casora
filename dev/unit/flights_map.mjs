// The flight map and the approximate progress (49-flights.js): one presentation (F.mapView, F.mapGeo, F.mapBounds) for the
// popup's map and progress, the tile's progress line and, later, the screensaver. Positions, trail and progress rules, the
// element that draws on HA's map (with the map failing or missing), and that rendering never writes to HA.
// Controlled clock; synthetic flights; no browser.
//   node dev/unit/flights_map.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#distanceKm,progress,progressOf,trailOf,mapView,mapGeo,mapBounds,liveHtml,flightSec,flightPopup
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');
const MIN = 60000;
const T0 = Date.now(); // the element reads the real clock

let F, ctx, clock;
const runtime = () => {
  clock = { timers: [] };
  ctx = {
    console, Date, Math, Intl, JSON,
    localStorage: { getItem: () => null, setItem() {} },
    document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => fakeEl() },
    setTimeout: () => ({ live: false }), clearTimeout() {},
    setInterval: (fn) => { const t = { fn, live: true }; clock.timers.push(t); return t; },
    clearInterval: (t) => { if (t) t.live = false; },
    addEventListener() {},
    _casoraNotifyOpenViaCard() {},
    _casoraUI: { stage: (type, o) => 'STAGE[' + type + ',' + (o.html || o.text || '') + ']', empty: () => 'EMPTY' },
    _casoraLovelaceCfg: () => null,
    casoraLocale: () => 'en-US',
  };
  ctx.window = ctx;
  ctx.HTMLElement = class { constructor() { this.style = {}; this._attrs = {}; this._kids = []; this._conn = false; }
    get isConnected() { return this._conn; } setAttribute(n, v) { this._attrs[n] = String(v); }
    getAttribute(n) { return n in this._attrs ? this._attrs[n] : null; } appendChild(c) { this._kids.push(c); return c; }
    remove() { this._conn = false; } };
  ctx.customElements = { defined: {}, get(n) { return this.defined[n]; }, define(n, c) { this.defined[n] = c; } };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  F = ctx._casoraFlights;
  return F;
};
const fakeEl = () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {}, shadowRoot: null });
const house = () => {
  const hass = { entities: {}, states: {}, calls: [], callService: (...a) => { hass.calls.push(a); return Promise.resolve(); } };
  hass.source = (id, flights) => {
    hass.entities = { ...hass.entities, [id]: { entity_id: id, platform: 'flightradar24', device_id: 'd' + id, translation_key: 'additional_tracked' } };
    hass.states = { ...hass.states, [id]: { entity_id: id, state: String(flights.length), attributes: { flights } } };
  };
  return hass;
};
// Synthetic airborne flight: Airport Alpha (50N 4E) to Airport Beta (50N 20E), current point mid-route.
const ALPHA = [50, 4], BETA = [50, 20];
const fl = (id, extra = {}) => ({
  id, flight_number: 'XY123', callsign: 'TST123', aircraft_registration: 'T-AAAA', tracked_type: 'live', on_ground: 0,
  latitude: 50, longitude: 12, altitude: 35000, ground_speed: 450, heading: 270, vertical_speed: 0,
  airline_short: 'Testair', airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB',
  airport_origin_name: 'Airport Alpha', airport_destination_name: 'Airport Beta',
  airport_origin_latitude: ALPHA[0], airport_origin_longitude: ALPHA[1],
  airport_destination_latitude: BETA[0], airport_destination_longitude: BETA[1],
  coordinates: [[49.8, 8], [49.9, 10]], ...extra,
});
// The rule needs an observed movement: the baseline, then a step. Returns the hass after the step.
const moving = (hass, flight, src = 'sensor.a', at = T0) => {
  hass.source(src, [flight]); F.airborne(hass, '', at);
  hass.source(src, [{ ...flight, latitude: flight.latitude + 0.05 }]);
  F.airborne(hass, '', at + MIN);
  return at + MIN;
};
const deq = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' not within ' + tol + ' of ' + b);

// ── distance and progress ──────────────────────────────────────────────────────────────────────────────────────────
runtime();
near(F.distanceKm([0, 0], [0, 1]), 111.19, 0.05, 'one degree of longitude at the equator');
near(F.distanceKm([0, 179], [0, -179]), 222.39, 0.05, 'across the dateline: 2 degrees, not 358');
assert.equal(F.distanceKm([50, 4], [50, 4]), 0, 'same point');
// Progress from origin, current and destination: on the way, at the ends, and bounded.
assert.equal(F.progress(ALPHA, ALPHA, BETA), 0, 'at origin');
assert.equal(F.progress(ALPHA, BETA, BETA), 100, 'at destination');
const mid = F.progress(ALPHA, [50, 12], BETA);
assert.ok(Number.isInteger(mid) && mid >= 45 && mid <= 55, 'midpoint about 50, got ' + mid);
assert.equal(F.progress([50, 4], [50, 12], [50, 20]), F.progress(ALPHA, [50, 12], BETA), 'same route, same result');
// Dateline: the route from 179 E to 179 W with the aircraft on the dateline is about halfway.
const dl = F.progress([0, 179], [0, 180], [0, -179]);
assert.ok(dl >= 45 && dl <= 55, 'dateline halfway, got ' + dl);
// A detour stays inside 0..100 and is still an integer.
const detour = F.progress(ALPHA, [60, 12], BETA);
assert.ok(Number.isInteger(detour) && detour >= 0 && detour <= 100, 'detour bounded, got ' + detour);
// Omitted: a missing or invalid required point, and airports at the same place (no route to measure along).
assert.equal(F.progress(null, [50, 12], BETA), null, 'no origin');
assert.equal(F.progress(ALPHA, [50, 12], null), null, 'no destination');
assert.equal(F.progress(ALPHA, null, BETA), null, 'no current point');
assert.equal(F.progress(ALPHA, [50, 12], ALPHA), null, 'coincident airports');
assert.equal(F.progress([50, 4], [50, 4], [50, 4.000001]), null, 'airports a few centimetres apart');
// Trail: invalid points are dropped (no placeholder at zero), consecutive duplicates are merged, and the list is ordered.
deq(F.trailOf(fl('t', { coordinates: [[49, 8], [0, 0], [NaN, 3], ['x', 2], [95, 1], [49, 8], [49.5, 9], null, [49.5, 9]] })),
  [[49, 8], [49.5, 9]], 'bad points out, duplicates merged');
deq(F.trailOf(fl('t', { coordinates: undefined })), [], 'no trail');
deq(F.trailOf(fl('t', { coordinates: 'nope' })), [], 'trail not a list');

// ── one presentation: identity, freshness and the shared rule ──────────────────────────────────────────────────────
const hass = house();
const now = moving(hass, fl('w1'));
const v = F.mapView(hass, 'sensor.a', 'w1', now);
assert.equal(v.key, 'w1');
deq(v.cur, [50.05, 12], 'the current point is the source value');
deq(v.origin, ALPHA);
deq(v.destination, BETA);
assert.equal(v.progress, F.progress(ALPHA, [50.05, 12], BETA), 'progress from the same points');
deq(v.trail, [[49.8, 8], [49.9, 10]], 'the available trail, nothing invented');
assert.equal(F.mapView(hass, 'sensor.a', 'w1', now + 11 * MIN), null, 'a flight no longer moving is no marker');
assert.equal(F.mapView(hass, 'sensor.b', 'w1', now), null, 'another source has no such flight');
assert.equal(F.mapView(hass, 'sensor.a', 'other', now), null, 'another flight of the source has no marker');
assert.equal(F.mapView(hass, 'sensor.a', '', now), null, 'no key, no marker');
// A flight that stops qualifying (landed) leaves no marker or trail.
hass.source('sensor.a', [fl('w1', { on_ground: 1 })]);
assert.equal(F.mapView(hass, 'sensor.a', 'w1', now), null, 'landed: no marker');
const nowB = moving(hass, fl('w1'), 'sensor.a', now + 20 * MIN); // airborne again for the popup and tile checks below
// Missing airports: the marker, trail and text stay; progress is omitted.
const hass2 = house();
const now2 = moving(hass2, fl('w2', { airport_origin_latitude: undefined, airport_origin_longitude: undefined }), 'sensor.c');
const v2 = F.mapView(hass2, 'sensor.c', 'w2', now2);
assert.equal(v2.origin, null);
assert.equal(v2.progress, null, 'no progress without the origin');
assert.equal(v2.cur[0], 50.05, 'marker stays');
assert.match(F.liveHtml(hass2, '', now2), /XY123/, 'textual row stays without airports');
// An invalid airport coordinate counts as missing.
assert.equal(F.progressOf(fl('x', { airport_destination_latitude: 0, airport_destination_longitude: 0 })), null, '(0,0) is no airport');
assert.equal(F.progressOf(fl('x', { airport_destination_latitude: '50', airport_destination_longitude: 20 })), null, 'a text coordinate is no point');

// ── GeoJSON and bounds: no placeholder points, trail ends at the marker ────────────────────────────────────────────
const g = F.mapGeo(v);
const pts = g.points.features, roles = pts.map((x) => x.properties.role);
deq(roles, ['airport', 'airport', 'aircraft'], 'two airports and the aircraft');
deq(pts[2].geometry.coordinates, [12, 50.05], 'GeoJSON is [lon, lat]');
assert.equal(pts[2].properties.arrow, 1, 'a known heading draws the arrow');
assert.equal(g.trail.features.length, 1, 'a trail with two points is a line');
deq(g.trail.features[0].geometry.coordinates.slice(-1)[0], [12, 50.05], 'the line ends at the marker');
const gNoAir = F.mapGeo(v2);
assert.equal(gNoAir.points.features.length, 2, 'only the airport with coordinates is drawn, and the aircraft');
const gBare = F.mapGeo({ cur: [10, 20], heading: null, origin: null, destination: null, trail: [] });
assert.equal(gBare.points.features[0].properties.arrow, 0, 'no heading: no arrow');
assert.equal(gBare.trail.features.length, 0, 'no line for no trail');
assert.equal(F.mapGeo(null).points.features.length, 0, 'nothing to draw');
const b = F.mapBounds(v);
assert.ok(b[0][0] <= 4 && b[1][0] >= 20 && b[0][1] <= 49.8 && b[1][1] >= 50.05, 'bounds hold every point');
assert.equal(F.mapBounds(null), null, 'no view, no bounds');

// ── the popup and the tile: progress text and the map's place; text stays without the map ─────────────────────────
ctx._casoraSoftKit = { secCard: (watch, code) => ({ watch, code }), layout: (o) => o };
const pop = F.flightPopup(hass.states, hass, { source: 'sensor.a', flight: 'w1' });
assert.ok(pop.fields.map && pop.fields.prog, 'popup has the map and the progress');
assert.equal(pop.stage, 'map', 'the map is the stage');
const mapHtml = F.sec('fmap', { src: 'sensor.a', flight: 'w1' }, hass.states, hass);
assert.match(mapHtml, /<casora-flight-map[^>]*data-src="sensor\.a"[^>]*data-key="w1"/, 'map element with the flight');
// The host has a name and a role that allows the attribution link inside it: role="img" would make that link presentational
// (axe: nested-interactive), so the host is a named group.
assert.match(mapHtml, /<casora-flight-map[^>]*role="group"[^>]*aria-label="[^"]+"/, 'map host: named group, so its link is announced');
assert.doesNotMatch(mapHtml, /role="img"/, 'map host is not role="img" (it would hide the attribution link)');
assert.equal(F.sec('fmap', { src: 'sensor.a', flight: 'gone' }, hass.states, hass), '', 'no map for a flight not shown');
const prog = F.sec('fprog', { src: 'sensor.a', flight: 'w1' }, hass.states, hass);
assert.match(prog, /Ungefährer Fortschritt/, 'progress label');
assert.match(prog, new RegExp('aria-valuenow="' + v.progress + '"'), 'progress value');
assert.equal(F.sec('fprog', { src: 'sensor.a', flight: 'w2' }, hass.states, hass), '', 'no progress without the airports');
assert.match(F.sec('fstage', { src: 'sensor.a', flight: 'w2' }, hass.states, hass), /STAGE/, 'route text stays');
assert.match(F.sec('fair', { src: 'sensor.a', flight: 'w1' }, hass.states, hass), /Testair/, 'details stay');
const tile = F.liveHtml(hass, '', nowB);
// The tile's short row has no progress text line; its bar is the progressbar, at the popup's value.
assert.doesNotMatch(tile.replace(/<[^>]*>/g, ''), /Ungefährer Fortschritt/, 'tile: no progress text line');
assert.match(tile, new RegExp('role="progressbar"[^>]*aria-valuenow="' + v.progress + '"'), 'tile progress bar: its value');
assert.doesNotMatch(F.liveHtml(hass2, '', now2), /Ungefährer Fortschritt/, 'no tile progress without airports');
// The tile also shows the progress as a bar, at the same value as the popup (the text line above carries the number).
const tileBar = tile.match(/data-flights-bar[^>]*width:(\d+)%/);
assert.ok(tileBar, 'tile progress bar');
assert.equal(Number(tileBar[1]), v.progress, 'bar at the popup value');
assert.doesNotMatch(F.liveHtml(hass2, '', now2), /data-flights-bar/, 'no tile bar without airports');

// ── the element: draws on HA's map, follows the flight, and hides when the map is missing or fails ───────────────
const fakeMl = () => {
  const ml = { sources: {}, layers: {}, fits: [], images: [], handlers: {}, styleLoaded: true, loadedFlag: true, tiles: 0,
    isStyleLoaded() { return this.styleLoaded; }, loaded() { return this.loadedFlag; },
    addSource(id, o) { this.sources[id] = { data: o.data, setData(d) { this.data = d; } }; },
    getSource(id) { return this.sources[id]; }, addLayer(o) { this.layers[o.id] = o; }, addImage(id) { this.images.push(id); },
    fitBounds(bb) { this.fits.push(bb); }, on(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); }, once() {},
    resize() {}, jumpTo() {}, dragPan: { disable() {} } };
  return ml;
};
const mountEl = (H, hs, src, key) => {
  const Cls = ctx.customElements.get('casora-flight-map');
  assert.ok(Cls, 'the element is defined');
  const el = new Cls();
  el.setAttribute('data-src', src); el.setAttribute('data-key', key);
  el._conn = true;
  ctx.document.querySelector = () => ({ hass: hs });
  el.connectedCallback();
  return el;
};
const tick = () => clock.timers.filter((t) => t.live).forEach((t) => t.fn());
const runEl = (hs, ml) => {
  const H = { ok: () => true, defined: () => Promise.resolve(true), ml: () => ml };
  ctx._casoraHaMap = H;
  const el = mountEl(H, hs, 'sensor.a', 'w1');
  return el;
};
// Waits for the element's promise, then ticks the poll until the map is ready.
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

// A map that loads: the layers are added once, the flight's data is set, the view fits once per flight.
{
  const hs = house(); const now3 = moving(hs, fl('w1'));
  const ml = fakeMl(); ctx._casoraHaMap = { ok: () => true, defined: () => Promise.resolve(true), ml: () => ml };
  const Cls = ctx.customElements.get('casora-flight-map');
  const el = new Cls(); el.setAttribute('data-src', 'sensor.a'); el.setAttribute('data-key', 'w1'); el._conn = true;
  ctx.document.querySelector = () => ({ hass: hs });
  const realNow = Date.now; ctx.Date.now = () => now3;
  el.connectedCallback();
  await settle();
  tick(); tick();
  assert.ok(ml.layers['casora-flight-trail'] && ml.layers['casora-flight-aircraft'], 'layers added');
  assert.ok(ml.images.includes('casora-flight-arrow') || ml.images.length === 0, 'arrow image when a canvas exists');
  assert.equal(ml.fits.length, 1, 'fitted once');
  // Movement of the same flight: its data changes, no second fit.
  hs.source('sensor.a', [fl('w1', { latitude: 50.2, longitude: 13 })]);
  F.airborne(hs, '', now3 + MIN);
  tick();
  assert.equal(ml.fits.length, 1, 'the same flight is not refitted');
  // Another flight of the source: the marker and trail change at once, the view is fitted to the new one.
  hs.source('sensor.a', [fl('w1', { latitude: 50.2, longitude: 13 }), fl('w9', { flight_number: 'ZZ9', latitude: 40, longitude: 1 })]);
  F.airborne(hs, '', now3 + 2 * MIN);
  hs.source('sensor.a', [fl('w1', { latitude: 50.2, longitude: 13 }), fl('w9', { flight_number: 'ZZ9', latitude: 40.05, longitude: 1 })]);
  F.airborne(hs, '', now3 + 3 * MIN);
  el._conn = true; // still shown
  ctx.document.querySelector = () => ({ hass: hs });
  // The element is for w1; a change of its key (attribute) is a new flight: nothing of w1 is left drawn.
  el.setAttribute('data-key', 'w9');
  tick();
  assert.equal(ml.fits.length, 2, 'a new flight refits once');
  assert.equal(ml.sources['casora-flight-points'].data.features.find((x) => x.properties.role === 'aircraft').geometry.coordinates[1], 40.05, 'the marker is the new flight only');
  // Removal: the element's timer stops and nothing is written after it.
  const before = JSON.stringify(ml.sources['casora-flight-points'].data);
  el.remove(); el._conn = false;
  el.disconnectedCallback && el.disconnectedCallback();
  hs.source('sensor.a', [fl('w9', { latitude: 41, longitude: 1 })]);
  tick();
  assert.equal(JSON.stringify(ml.sources['casora-flight-points'].data), before, 'nothing written after removal');
  Date.now = realNow;
}

// Landed while shown: the drawn marker and trail are cleared.
{
  const hs = house(); const now4 = moving(hs, fl('w1'));
  const ml = fakeMl(); ctx._casoraHaMap = { ok: () => true, defined: () => Promise.resolve(true), ml: () => ml };
  const Cls = ctx.customElements.get('casora-flight-map');
  const el = new Cls(); el.setAttribute('data-src', 'sensor.a'); el.setAttribute('data-key', 'w1'); el._conn = true;
  ctx.document.querySelector = () => ({ hass: hs });
  const realNow = Date.now; ctx.Date.now = () => now4;
  el.connectedCallback(); await settle(); tick();
  assert.ok(ml.sources['casora-flight-points'].data.features.length > 0, 'drawn while in the air');
  hs.source('sensor.a', [fl('w1', { on_ground: 1 })]);
  tick();
  assert.equal(ml.sources['casora-flight-points'].data.features.length, 0, 'landed: marker cleared');
  assert.equal(ml.sources['casora-flight-trail'].data.features.length, 0, 'landed: trail cleared');
  Date.now = realNow;
}

// The map cannot be used (no HA map service, or ha-map fails, or no tiles in time): the element hides, the text stays,
// nothing is written to HA.
{
  const hs = house(); moving(hs, fl('w1'));
  for (const H of [
    { ok: () => false, defined: () => Promise.resolve(true), ml: () => null },
    { ok: () => true, defined: () => Promise.resolve(false), ml: () => null },
  ]) {
    ctx._casoraHaMap = H;
    const Cls = ctx.customElements.get('casora-flight-map');
    const el = new Cls(); el.setAttribute('data-src', 'sensor.a'); el.setAttribute('data-key', 'w1'); el._conn = true;
    ctx.document.querySelector = () => ({ hass: hs });
    el.connectedCallback(); await settle();
    assert.equal(el.style.display, 'none', 'hidden without a map');
  }
  // No tiles ever: after the ready time the element hides itself.
  const ml = fakeMl(); ml.loadedFlag = false; ml.styleLoaded = false;
  ctx._casoraHaMap = { ok: () => true, defined: () => Promise.resolve(true), ml: () => ml };
  const Cls = ctx.customElements.get('casora-flight-map');
  const el = new Cls(); el.setAttribute('data-src', 'sensor.a'); el.setAttribute('data-key', 'w1'); el._conn = true;
  ctx.document.querySelector = () => ({ hass: hs });
  const realNow = Date.now; let fake = Date.now(); ctx.Date.now = () => fake;
  el.connectedCallback(); await settle();
  fake += F.MAP.READY_MS + 1000; tick();
  assert.equal(el.style.display, 'none', 'no tiles in time: hidden');
  Date.now = realNow;
  deq(hs.calls, [], 'the map and the rendering write nothing to HA');
}

// The attribution style is in the map's shadow root from the build on, not only after the first poll (no unstyled link
// before then). A poll does not add a second copy.
{
  const hs = house(); moving(hs, fl('w5'));
  const shadow = { kids: [], appendChild(c) { this.kids.push(c); return c; }, querySelectorAll: () => [] };
  const host = { style: {}, setAttribute() {}, appendChild() {}, remove() {}, shadowRoot: shadow };
  ctx.document.createElement = () => host;
  ctx._casoraHaMap = { ok: () => true, defined: () => Promise.resolve(true), ml: () => fakeMl() };
  ctx.document.querySelector = () => ({ hass: hs });
  const Cls = ctx.customElements.get('casora-flight-map');
  const el = new Cls(); el.setAttribute('data-src', 'sensor.a'); el.setAttribute('data-key', 'w5'); el._conn = true;
  el.connectedCallback(); await settle();
  const styled = () => shadow.kids.filter((c) => c.textContent && c.textContent.includes('.maplibregl-ctrl-attrib{'));
  assert.equal(styled().length, 1, 'the attribution style is in the map shadow root after the build');
  tick();
  assert.equal(styled().length, 1, 'a poll does not add the style again');
  el.disconnectedCallback();
}

// ── Layout: the element keeps the popup's 4:3 box (no style text replaced), its map fills the box, reduced motion gives no fade,
//    and the map takes no pointer input while it is not inert (its attribution link stays reachable; the host is not an img role) ──
const mountFresh = async (hs, key, reduce) => {
  const H = { ok: () => true, defined: () => Promise.resolve(true), ml: () => fakeMl() };
  ctx._casoraHaMap = H;
  ctx.document.querySelector = () => ({ hass: hs });
  ctx.matchMedia = reduce ? () => ({ matches: true }) : undefined;
  const Cls = ctx.customElements.get('casora-flight-map');
  const el = new Cls();
  el.setAttribute('data-src', 'sensor.a'); el.setAttribute('data-key', key); el._conn = true;
  el.style.aspectRatio = '4 / 3'; // what the popup's style attribute gives the host
  el.connectedCallback();
  await settle();
  return el;
};
{
  const hs = house(); moving(hs, fl('w2'));
  const el = await mountFresh(hs, 'w2', false);
  assert.equal(el.style.aspectRatio, '4 / 3', 'the popup box keeps its 4:3 ratio');
  assert.equal(el.style.cssText, undefined, 'the host style text is not replaced');
  assert.equal(el.style.height, undefined, 'the host gets no fixed height (the ratio sets it)');
  assert.ok(el._el, 'the map is built');
  assert.equal(el._el.style.position, 'absolute', 'the map fills the box');
  assert.equal(el._el.style.pointerEvents, 'none', 'the map takes no pointer input; only its attribution link does');
  assert.equal(el._el.style.transition, 'opacity .35s ease', 'no reduced motion: the fade stays');
  el.disconnectedCallback();
  const elR = await mountFresh(hs, 'w2', true);
  assert.equal(elR._el.style.transition, 'none', 'reduced motion: no fade');
  elR.disconnectedCallback();
  ctx.matchMedia = undefined;
}
// The progress line keeps its text contrast (no reduced opacity on the label).
{
  const hs = house(); moving(hs, fl('w3', { airport_origin_latitude: 50, airport_origin_longitude: 4, airport_destination_latitude: 40, airport_destination_longitude: -74 }));
  const prog = F.sec('fprog', { src: 'sensor.a', flight: 'w3' }, hs.states, hs);
  assert.match(prog, /Ungefährer Fortschritt/, 'the progress line is shown');
  assert.doesNotMatch(prog, /opacity:\.75/, 'the progress label keeps its contrast');
  assert.doesNotMatch(prog, /nowrap/, 'the progress line wraps');
}

console.log('ok flights_map');
