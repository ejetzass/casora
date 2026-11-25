// The flight popup's map on a Leaflet ha-map (HA draws with Leaflet when the browser has no WebGL2; 49-flights.js).
// The map is ready when its tiles have loaded (counted as the fuel prices map does) and the layers are set; then it shows
// the aircraft with its direction, the trail and the airports, and fits the view once per flight. Without tiles in time it
// hides, as the MapLibre path does. Controlled clock; fake Leaflet map with a plain projection; no browser.
//   node dev/unit/flights_map_leaflet.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#defineMap,_build,_poll,_pollLeaflet,_syncLeaflet,_drawLeaflet
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');
const MIN = 60000;
const T0 = Date.now();

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
    _casoraUI: { stage: (type, o) => 'STAGE[' + type + ']', empty: () => 'EMPTY' },
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
// An SVG element stub: attributes, innerHTML as a string.
const svgEl = (tag) => ({ tag, attrs: {}, style: {}, innerHTML: '', setAttribute(k, v) { this.attrs[k] = String(v); },
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, appendChild() {}, remove() {} });
const house = () => {
  const hass = { entities: {}, states: {}, calls: [], callService: (...a) => { hass.calls.push(a); return Promise.resolve(); } };
  hass.source = (id, flights) => {
    hass.entities = { ...hass.entities, [id]: { entity_id: id, platform: 'flightradar24', device_id: 'd' + id, translation_key: 'additional_tracked' } };
    hass.states = { ...hass.states, [id]: { entity_id: id, state: String(flights.length), attributes: { flights } } };
  };
  return hass;
};
// Synthetic airborne flight: Airport Alpha (50N 4E) to Airport Beta (50N 20E), current point at 50.05N 12E, heading 270.
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
// The rule needs an observed movement: the baseline, then a step. Returns the time of the step.
const moving = (hass, flight, src = 'sensor.a', at = T0) => {
  hass.source(src, [flight]); F.airborne(hass, '', at);
  hass.source(src, [{ ...flight, latitude: flight.latitude + 0.05 }]);
  F.airborne(hass, '', at + MIN);
  return at + MIN;
};
const deq = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);

// A fake Leaflet map: 480x360 px, a plain projection (10 px per degree; lon 0 at x 240, lat 50 at y 180), one tile layer.
const fakeLf = () => {
  const tileHandlers = {};
  const tileLayer = { getTileUrl() {}, on(t, fn) { (tileHandlers[t] = tileHandlers[t] || []).push(fn); } };
  const lf = { size: { x: 480, y: 360 }, fits: [], invalidated: 0, disabled: [], tileHandlers,
    options: {},
    getSize() { return this.size; },
    invalidateSize() { this.invalidated++; },
    fitBounds(b, o) { this.fits.push({ b, o }); },
    latLngToContainerPoint(ll) { return { x: 240 + ll[1] * 10, y: 180 + (50 - ll[0]) * 10 }; },
    eachLayer(fn) { fn(tileLayer); },
    loadTile() { (tileHandlers.tileload || []).forEach((f) => f()); },
  };
  ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard', 'tap'].forEach((x) => {
    lf[x] = { disable() { lf.disabled.push(x); } };
  });
  return lf;
};
// Mounts a flight map element on a Leaflet map (the MapLibre handle reports nothing, as for a Leaflet ha-map).
const mount = async (lf, hs, key = 'w1', ml = null) => {
  ctx._casoraHaMap = { ok: () => true, defined: () => Promise.resolve(true), ml: () => ml, lf: () => lf };
  ctx.document.querySelector = () => ({ hass: hs });
  const host = fakeEl();
  ctx.document.createElement = () => host;
  ctx.document.createElementNS = (ns, tag) => svgEl(tag);
  const Cls = ctx.customElements.get('casora-flight-map');
  const f = new Cls();
  f.setAttribute('data-src', 'sensor.a'); f.setAttribute('data-key', key); f._conn = true;
  f.connectedCallback();
  await Promise.resolve(); await Promise.resolve();
  return { f, host };
};
const svgOf = (f) => f._kids.find((k) => k.tag === 'svg');
const tick = () => clock.timers.filter((t) => t.live).forEach((t) => t.fn());
// Runs fn with a controlled Date.now; fn gets a setter for the time.
const withClock = async (t0, fn) => {
  const real = Date.now; let now = t0; ctx.Date.now = () => now;
  try { return await fn((t) => { now = t; }); } finally { ctx.Date.now = real; }
};

runtime();

// ── ready: the tiles decide, within the ready time; without any tile in time the element hides itself ───────────────
await withClock(T0, async (setNow) => {
  const hs = house(); const t = moving(hs, fl('w1'));
  setNow(t);
  const lf = fakeLf();
  const { f, host } = await mount(lf, hs);
  tick();
  assert.equal(host.style.visibility, 'hidden', 'Leaflet: hidden until a tile has loaded');
  lf.loadTile();
  tick();
  assert.equal(host.style.visibility, '', 'Leaflet: shown once tiles have loaded and the layers are set');
  assert.equal(host.style.opacity, '1', 'Leaflet: fully opaque when shown');
  assert.notEqual(f.style.display, 'none', 'Leaflet: the element is not hidden');
});
await withClock(T0, async (setNow) => {
  const hs = house(); const t = moving(hs, fl('w1'));
  setNow(t);
  const { f, host } = await mount(fakeLf(), hs);
  setNow(t + F.MAP.READY_MS + 1000); tick();
  assert.equal(f.style.display, 'none', 'Leaflet: no tiles in time, the element hides');
  assert.equal(host.style.visibility, 'hidden', 'Leaflet: and the map stays hidden');
});

// ── drawing: marker with direction, trail, airports; interactions off; the overlay is not a Tab stop ─────────────────
await withClock(T0, async (setNow) => {
  const hs = house(); const t = moving(hs, fl('w1'));
  setNow(t);
  const lf = fakeLf();
  const { f } = await mount(lf, hs);
  lf.loadTile(); tick();
  const svg = svgOf(f);
  assert.ok(svg, 'Leaflet: an overlay is added to the element');
  const markup = svg.innerHTML;
  // Aircraft at 50.05N 12E: x = 240 + 12*10, y = 180 + (50 - 50.05)*10 = 179.5. Heading 270 turns the arrow.
  assert.match(markup, /<circle cx="360" cy="179\.5" r="7"/, 'Leaflet: the aircraft is at its position');
  assert.match(markup, /rotate\(270\)/, 'Leaflet: the arrow turns with the heading');
  // Trail: 49.8N 8E, 49.9N 10E, then the aircraft.
  assert.match(markup, /M320 182 L340 181 L360 179\.5/, 'Leaflet: the trail ends at the aircraft');
  // Airports: origin 50N 4E, destination 50N 20E.
  assert.match(markup, /<circle cx="280" cy="180" r="4"/, 'Leaflet: origin airport drawn');
  assert.match(markup, /<circle cx="440" cy="180" r="4"/, 'Leaflet: destination airport drawn');
  assert.equal(svg.getAttribute('aria-hidden'), 'true', 'Leaflet: the overlay is hidden from assistive technology');
  assert.equal(svg.getAttribute('tabindex'), null, 'Leaflet: the overlay is not a Tab stop');
  assert.equal(svg.style.pointerEvents, 'none', 'Leaflet: the overlay takes no pointer input');
  ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard', 'tap'].forEach((x) => {
    assert.ok(lf.disabled.includes(x), 'Leaflet: ' + x + ' is disabled');
  });
});

// ── fit: once per flight, with the same rules as MapLibre (padding, maxZoom 9, no animation) ────────────────────────
await withClock(T0, async (setNow) => {
  const hs = house(); const t = moving(hs, fl('w1'));
  setNow(t);
  const lf = fakeLf();
  const { f } = await mount(lf, hs);
  lf.loadTile(); tick();
  assert.equal(lf.fits.length, 1, 'Leaflet: fitted once to the flight');
  const b = lf.fits[0].b;
  assert.ok(b[0][0] <= 4 && b[1][0] >= 20 && b[0][1] <= 49.8 && b[1][1] >= 50.05, 'Leaflet: the fit holds every point');
  assert.equal(lf.fits[0].o.maxZoom, 9, 'Leaflet: maxZoom 9 as on MapLibre');
  assert.equal(lf.fits[0].o.animate, false, 'Leaflet: no animation');
  // Movement of the same flight: no second fit.
  hs.source('sensor.a', [fl('w1', { latitude: 50.2, longitude: 13 })]);
  F.airborne(hs, '', t + MIN);
  tick();
  assert.equal(lf.fits.length, 1, 'Leaflet: the same flight is not refitted');
  // A map with no size yet is not fitted (its zoom would be wrong); the next tick with a size fits.
  const hs2 = house(); const t2 = moving(hs2, fl('w2'), 'sensor.a', t + 30 * MIN);
  setNow(t2);
  const lf2 = fakeLf(); lf2.size = { x: 0, y: 0 };
  const m2 = await mount(lf2, hs2, 'w2');
  lf2.loadTile(); tick();
  assert.equal(lf2.fits.length, 0, 'Leaflet: no fit while the map has no size');
  lf2.size = { x: 480, y: 360 }; tick();
  assert.equal(lf2.fits.length, 1, 'Leaflet: fitted once the map has a size');
});

// ── the overlay follows the flight: landed clears it; removal stops writing; nothing is written to HA ──────────────────
await withClock(T0, async (setNow) => {
  const hs = house(); const t = moving(hs, fl('w1'));
  setNow(t);
  const lf = fakeLf();
  const { f } = await mount(lf, hs);
  lf.loadTile(); tick();
  const svg = svgOf(f);
  assert.match(svg.innerHTML, /<circle cx="360"/, 'drawn while in the air');
  hs.source('sensor.a', [fl('w1', { on_ground: 1 })]);
  tick();
  assert.equal(svg.innerHTML.includes('<circle cx="360"'), false, 'landed: the aircraft is cleared');
  assert.equal(svg.innerHTML.includes('<path'), false, 'landed: the trail is cleared');
  // Removal: no timer is left and nothing is drawn afterwards.
  hs.source('sensor.a', [fl('w1', { latitude: 51 })]);
  f.disconnectedCallback();
  const before = svg.innerHTML;
  hs.source('sensor.a', [fl('w1', { latitude: 52 })]);
  tick();
  assert.equal(svg.innerHTML, before, 'after removal nothing is drawn');
  deq(hs.calls, [], 'the Leaflet map and the drawing write nothing to HA');
});

// ── the MapLibre path wins when it exists: the Leaflet map is not touched ──────────────────────────────────────────
await withClock(T0, async (setNow) => {
  const hs = house(); const t = moving(hs, fl('w1'));
  setNow(t);
  const lf = fakeLf();
  let touched = 0; lf.getSize = () => { touched++; return { x: 480, y: 360 }; };
  const ml = { isStyleLoaded: () => false, loaded: () => false, on() {}, once() {}, resize() {}, jumpTo() {},
    getSource: () => null, addSource() {}, addLayer() {}, addImage() {}, fitBounds() {} };
  ['dragPan', 'scrollZoom', 'boxZoom', 'doubleClickZoom', 'touchZoomRotate', 'keyboard', 'dragRotate', 'touchPitch'].forEach((x) => { ml[x] = { disable() {} }; });
  await mount(lf, hs, 'w1', ml);
  tick();
  assert.equal(touched, 0, 'a MapLibre map is used; the Leaflet map is not drawn on');
});

// The shared helper hands out the Leaflet map as its own handle; ml() stays MapLibre-only (source check: 12-tanken.js runs in its own file).
{
  const tanken = read('custom_components/casora/scripts/local/12-tanken.js');
  assert.match(tanken, /var lfOf = function \(m\) \{ return m && m\.leafletMap \? m\.leafletMap : null; \};/, 'lf: the Leaflet map of the ha-map');
  assert.match(tanken, /window\._casoraHaMap = \{ ok: mapOk, defined: haMapDefined, ml: mlOf, lf: lfOf \}/, 'the helper exposes lf and keeps ml');
}

console.log('ok flights_map_leaflet');
