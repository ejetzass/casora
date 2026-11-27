// The flight map and the approximate progress (49-flights.js): one presentation (F.mapView, F.mapGeo, F.mapBounds) for the
// popup's map and progress, the tile's progress line and, later, the screensaver. Positions, trail and progress rules, the
// element that draws on HA's map (with the map failing or missing), and that rendering never writes to HA.
// Controlled clock; synthetic flights; no browser.
//   node dev/unit/flights_map.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#distanceKm,progress,progressOf,trailOf,greatCircle,unreportedOf,mapView,mapGeo,mapBounds,liveHtml,flightSec,flightPopup
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
    _casoraUI: { line: (m) => 'STAGE[line,' + m + ']', stage: (type, o) => 'STAGE[' + type + ',' + (o.html || o.text || '') + ']', empty: () => 'EMPTY' },
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
// ── the Remaining route: F.greatCircle(from, to) → [[lat, lon], …] along the shortest path on the globe ─────────────────
{
  const AMS = [52.31, 4.76], JFK = [40.64, -73.78];
  const gc = F.greatCircle(AMS, JFK);
  assert.ok(gc.length >= 8, 'a long route has many points');
  deq(gc[0], AMS, 'the first point is the aircraft');
  deq(gc[gc.length - 1], JFK, 'the last point is the destination');
  // The straight line on the flat map (linear in lat/lon) is the reference: the great circle bends north of it.
  const maxLat = Math.max(...gc.map((p) => p[0]));
  assert.ok(maxLat > 52.31 + 2, 'Amsterdam to New York rises north of both ends: ' + maxLat);
  gc.forEach((p) => {
    const t = (p[1] - AMS[1]) / (JFK[1] - AMS[1]);
    const straight = AMS[0] + t * (JFK[0] - AMS[0]);
    assert.ok(p[0] >= straight - 1e-6, 'never south of the straight line at lon ' + p[1]);
  });
  const mid = gc[Math.floor(gc.length / 2)];
  assert.ok(mid[0] > (AMS[0] + JFK[0]) / 2 + 3, 'the middle bends clearly north of the straight line');
  // Every point lies on the great circle: the distances along it add up to the direct distance.
  let sum = 0; for (let i = 1; i < gc.length; i++) sum += F.distanceKm(gc[i - 1], gc[i]);
  near(sum, F.distanceKm(AMS, JFK), 15, 'the path length is the great-circle distance');
  // Pacific: Tokyo to Los Angeles crosses the date line; longitudes stay continuous (no jump of about 360).
  const TYO = [35.55, 139.78], LAX = [33.94, -118.41];
  const pac = F.greatCircle(TYO, LAX);
  for (let i = 1; i < pac.length; i++) assert.ok(Math.abs(pac[i][1] - pac[i - 1][1]) < 30, 'continuous over the date line at point ' + i);
  deq(pac[0], TYO, 'Pacific: first point');
  near(((pac[pac.length - 1][1] - LAX[1]) % 360 + 360) % 360 % 360, 0, 1e-6, 'Pacific: the last point is the destination, shifted by whole turns');
  assert.equal(pac[pac.length - 1][0], LAX[0], 'Pacific: the last latitude');
  assert.ok(pac.some((p) => p[1] > 180), 'the route runs on past 180 instead of jumping back');
  // The other direction, west to east over the date line, stays continuous too.
  const back = F.greatCircle(LAX, TYO);
  for (let i = 1; i < back.length; i++) assert.ok(Math.abs(back[i][1] - back[i - 1][1]) < 30, 'continuous eastbound over the date line');
  // Empty cases.
  deq(F.greatCircle(null, JFK), [], 'no aircraft point');
  deq(F.greatCircle(AMS, null), [], 'no destination');
  deq(F.greatCircle(AMS, [91, 0]), [], 'an invalid point');
  deq(F.greatCircle(AMS, AMS), [], 'the same point');
  deq(F.greatCircle([50, 4], [50.005, 4]), [], 'under 1 km');
  assert.ok(F.greatCircle([50, 4], [50.02, 4]).length >= 2, 'just over 1 km gives a route');
  // Near-opposite points: finite numbers, first and last as given.
  for (const b of [[-52.31, -175.24], [-52.31, -175.2400001], [-52.30, -175.24], [-52.31, 4.76 - 180 + 0.0001]]) {
    const o = F.greatCircle(AMS, b);
    assert.ok(o.length >= 2, 'near-opposite gives a route');
    o.forEach((p) => assert.ok(isFinite(p[0]) && isFinite(p[1]), 'finite point'));
    deq(o[0], AMS, 'near-opposite first'); assert.equal(o[o.length - 1][0], b[0], 'near-opposite last latitude');
  }
}

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

// ── Unreported part: the great circle from the departure airport to the oldest trail point, one function for both maps ──
{
  const onArc = (a, p, b) => Math.abs(F.distanceKm(a, p) + F.distanceKm(p, b) - F.distanceKm(a, b)) < 0.01;
  const view = { origin: ALPHA, trail: [[49.8, 8], [49.9, 10]], cur: [50.05, 12], route: [] };
  const before = JSON.stringify(view);
  const u = F.unreportedOf(view);
  assert.ok(u.length >= 8 && u.length <= 64, 'one point per 150 km of the arc, between 8 and 64 points');
  deq(u[0], ALPHA, 'starts at the departure airport');
  assert.ok(Math.abs(u[u.length - 1][0] - 49.8) < 1e-9 && Math.abs(u[u.length - 1][1] - 8) < 1e-9, 'ends at the oldest trail point');
  assert.ok(u.every((p) => onArc(ALPHA, p, [49.8, 8])), 'every point lies on the great circle');
  assert.ok(u[Math.floor(u.length / 2)][0] > 49.9, 'the middle bows poleward: a great circle, not a straight lat/lon line');
  // Across the dateline the short way round is drawn, not the way round the globe.
  const dl = F.unreportedOf({ origin: [10, 179], trail: [[10, -179]] });
  assert.ok(dl.every((p) => Math.abs(p[1]) > 170 && onArc([10, 179], p, [10, -179])), 'dateline: the short arc');
  // A continuous trail past 180 (Auckland to Los Angeles over the date line): the arc is not empty, starts at the origin, ends at the trail's start.
  const akl = [-37, 174.8], past = F.unreportedOf({ origin: akl, trail: [[-30, 185], [-20, 200]] });
  assert.ok(past.length >= 8, 'past 180: an arc is drawn');
  deq(past[0], akl, 'past 180: starts at the origin');
  assert.ok(Math.abs(past[past.length - 1][0] + 30) < 1e-9 && Math.abs(past[past.length - 1][1] - 185) < 1e-9, 'past 180: ends at the trail start, as given');
  // Origin and trail start under a kilometre apart: nothing drawn (and no second try).
  deq(F.unreportedOf({ origin: [10, 180.0001], trail: [[10, 180.0002]] }), [], 'under a kilometre: nothing drawn');
  // Nothing drawn without the origin or without any trail point (no error).
  deq(F.unreportedOf({ origin: null, trail: view.trail }), [], 'no origin: nothing drawn');
  deq(F.unreportedOf({ origin: ALPHA, trail: [] }), [], 'no trail: nothing drawn');
  deq(F.unreportedOf(null), [], 'no view: nothing drawn');
  assert.equal(JSON.stringify(view), before, 'the view and its trail are not changed');
  // GeoJSON for the popup map: one line ([lon, lat]) from the airport to the oldest point; none without origin or trail.
  const gu = F.mapGeo(view).unreported.features;
  assert.equal(gu.length, 1, 'one unreported line');
  assert.equal(gu[0].geometry.coordinates.length, u.length, 'the line has the arc\'s points');
  deq(gu[0].geometry.coordinates[0], [4, 50], 'the line starts at the airport, [lon, lat]');
  assert.equal(F.mapGeo({ cur: [50.05, 12], origin: null, destination: null, trail: [[49.8, 8]], route: [] }).unreported.features.length, 0, 'no origin: no line');
  assert.equal(F.mapGeo({ cur: [50.05, 12], origin: ALPHA, destination: null, trail: [], route: [] }).unreported.features.length, 0, 'no trail: no line');
  // Both maps ask the same function: the popup's GeoJSON calls F.unreportedOf (the saver is checked in dev/unit/screensaver_flights.mjs).
  const real = F.unreportedOf;
  let calls = 0;
  F.unreportedOf = (x) => { calls += 1; return real(x); };
  F.mapGeo(view);
  F.unreportedOf = real;
  assert.equal(calls, 1, 'the popup map uses the shared function');
  // The bounds hold the arc: its middle bows north of the other points (origin 60N 0E, oldest point 60N 40E).
  const bow = { origin: [60, 0], trail: [[60, 40]], cur: [60, 20], destination: [50, 60], route: [] };
  const arcMaxLat = Math.max(...F.unreportedOf(bow).map((p) => p[0]));
  assert.ok(arcMaxLat > 61, 'the arc bows north of 60');
  assert.ok(F.mapBounds(bow)[1][1] >= arcMaxLat, 'popup bounds hold the arc');
  // Dateline: neighbouring GeoJSON longitudes of the line never differ by 180 or more; the line ends at -179 taken as 181.
  // The view carries its arc, and the arc keeps its start and end while the aircraft glides and the trail's end is cut back.
  {
    const hs = house(), nw = moving(hs, fl('w1'));
    const mv = F.mapView(hs, 'sensor.a', 'w1', nw);
    assert.ok(mv.unreported && mv.unreported.length >= 8, 'the view holds the Unreported part');
    deq(mv.unreported[0], mv.origin, 'it starts at the origin airport');
    deq(mv.unreported[mv.unreported.length - 1], mv.trail[0], 'and ends at the oldest trail point');
    const glided = F.mapViewAt(mv, [mv.cur[0] - 0.01, mv.cur[1] - 0.01], 90);
    deq(F.unreportedOf(glided), mv.unreported, 'a glide does not move the Unreported part');
    const lone = F.mapViewAt({ ...mv, trail: [mv.cur] }, [mv.cur[0] - 0.01, mv.cur[1]], 90);
    deq(lone.trail, [], 'a glide cuts the trail end that equals the new fix');
  }
  const dlc = F.mapGeo({ cur: [10, -179], heading: null, origin: [10, 179], destination: null, trail: [[10, -179]], route: [] }).unreported.features[0].geometry.coordinates;
  for (let i = 1; i < dlc.length; i++) assert.ok(Math.abs(dlc[i][0] - dlc[i - 1][0]) < 180, 'no jump across the map at point ' + i);
  assert.ok(Math.abs(dlc[dlc.length - 1][0] - 181) < 1e-9, 'the line ends at -179 taken as 181, the short way');
}

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
assert.match(F.listRows(hass2, { pin: '' }), /XY123/, 'textual row stays without airports');
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
const gBare = F.mapGeo({ cur: [10, 20], heading: null, origin: null, destination: null, trail: [], route: [] });
assert.equal(gBare.points.features[0].properties.arrow, 0, 'no heading: no arrow');
assert.equal(gBare.trail.features.length, 0, 'no line for no trail');
assert.equal(F.mapGeo(null).points.features.length, 0, 'nothing to draw');
const b = F.mapBounds(v);
assert.ok(b[0][0] <= 4 && b[1][0] >= 20 && b[0][1] <= 49.8 && b[1][1] >= 50.05, 'bounds hold every point');
assert.equal(F.mapBounds(null), null, 'no view, no bounds');
// The Remaining route: one dashed line from the aircraft to the destination; none without a destination or under 1 km.
// The route is part of the view (F.mapView), so the layers and the box read it and never compute it again.
{
  let n = 0;
  const viewOf = (extra) => { const hs = house(); const id = 'r' + (++n); const t = moving(hs, fl(id, extra), 'sensor.r' + n); return F.mapView(hs, 'sensor.r' + n, id, t); };
  const lonsOf = (line) => line.map((c) => c[0]);
  const steps = (line) => line.slice(1).map((c, i) => Math.abs(c[0] - line[i][0]));
  assert.ok(v.route.length > 2, 'the view holds the route points');
  deq(v.route[0], v.cur, 'the route starts at the aircraft');
  deq(v.route[v.route.length - 1], v.destination, 'the route ends at the destination');
  assert.equal(g.route.features.length, 1, 'a route to the destination is one line');
  const rc = g.route.features[0].geometry.coordinates;
  deq(rc[0], [12, 50.05], 'the route starts at the aircraft ([lon, lat])');
  deq(rc[rc.length - 1], [20, 50], 'the route ends at the destination');
  assert.equal(gNoAir.route.features.length, 1, 'the destination is enough (the origin may be missing)');
  assert.equal(gBare.route.features.length, 0, 'no destination: no route');
  assert.equal(F.mapGeo(null).route.features.length, 0, 'no view: no route');
  deq(viewOf({ airport_destination_latitude: undefined, airport_destination_longitude: undefined }).route, [], 'no destination: no route points');
  const close = viewOf({ airport_destination_latitude: 50.05, airport_destination_longitude: 12.005 });
  deq(close.route, [], 'under 1 km: no route points');
  assert.equal(F.mapGeo(close).route.features.length, 0, 'under 1 km: no route line');
  // The first view includes the destination and the whole curve, which bows north of both ends.
  const far = viewOf({ latitude: 52.31, longitude: 4.76, coordinates: [[52.2, 4.5]], airport_origin_latitude: 52.31, airport_origin_longitude: 4.76,
    airport_destination_latitude: 40.64, airport_destination_longitude: -73.78 });
  const bf = F.mapBounds(far);
  assert.ok(bf[0][0] <= -73.78 && bf[1][0] >= 4.76 && bf[0][1] <= 40.64, 'bounds hold the destination');
  const apex = Math.max(...F.mapGeo(far).route.features[0].geometry.coordinates.map((c) => c[1]));
  assert.ok(apex > 54 && bf[1][1] >= apex, 'bounds hold the top of the curve, north of both ends');
  // Date line, aircraft not yet across (Tokyo to Los Angeles): the destination dot sits where the route ends (past 180).
  const pac = viewOf({ latitude: 35.55, longitude: 139.78, coordinates: [], airport_origin_latitude: undefined, airport_origin_longitude: undefined,
    airport_destination_latitude: 33.94, airport_destination_longitude: -118.41 });
  const pg = F.mapGeo(pac), pb = F.mapBounds(pac);
  assert.ok(pg.points.features.find((x) => x.properties.role === 'airport').geometry.coordinates[0] > 180, 'the destination dot sits where the route ends');
  assert.ok(pb[1][0] > 180 && pb[1][0] - pb[0][0] < 180, 'the box spans the short way over the date line');
  // Date line, aircraft already across: trail, origin, route and destination all follow the aircraft's longitude.
  const east = viewOf({ latitude: 40, longitude: -170, coordinates: [[38, 170], [39, 178], [40, -170]],
    airport_origin_latitude: 35.55, airport_origin_longitude: 139.78, airport_destination_latitude: 33.94, airport_destination_longitude: -118.41 });
  const eg = F.mapGeo(east), eb = F.mapBounds(east);
  assert.ok(eb[1][0] - eb[0][0] < 180, 'eastbound, crossed: the box is under 180 degrees wide: ' + (eb[1][0] - eb[0][0]));
  assert.ok(Math.max(...steps(eg.trail.features[0].geometry.coordinates)) < 30, 'eastbound, crossed: the trail line is continuous');
  assert.ok(Math.max(...steps(eg.route.features[0].geometry.coordinates)) < 30, 'eastbound, crossed: the route line is continuous');
  assert.ok(Math.min(...lonsOf(eg.trail.features[0].geometry.coordinates)) < -180, 'eastbound, crossed: the trail runs on below -180');
  const eo = eg.points.features[0].geometry.coordinates[0];
  assert.ok(Math.abs(eo - eg.trail.features[0].geometry.coordinates[0][0]) < 90, 'eastbound, crossed: the origin dot is next to the trail');
  // The mirror: westbound over the date line, from Los Angeles to Tokyo.
  const west = viewOf({ latitude: 40, longitude: 170, coordinates: [[38, -170], [39, -178], [40, 170]],
    airport_origin_latitude: 33.94, airport_origin_longitude: -118.41, airport_destination_latitude: 35.55, airport_destination_longitude: 139.78 });
  const wg = F.mapGeo(west), wb = F.mapBounds(west);
  assert.ok(wb[1][0] - wb[0][0] < 180, 'westbound, crossed: the box is under 180 degrees wide: ' + (wb[1][0] - wb[0][0]));
  assert.ok(Math.max(...steps(wg.trail.features[0].geometry.coordinates)) < 30, 'westbound, crossed: the trail line is continuous');
  assert.ok(Math.max(...steps(wg.route.features[0].geometry.coordinates)) < 30, 'westbound, crossed: the route line is continuous');
  assert.ok(Math.max(...lonsOf(wg.trail.features[0].geometry.coordinates)) > 180, 'westbound, crossed: the trail runs on past 180');
  // An ordinary flight keeps its longitudes as reported.
  deq(v.trail, F.trailOf(fl('w1')), 'no date line: the trail is as reported');
}

// ── the popup and the tile: progress text and the map's place; text stays without the map ─────────────────────────
ctx._casoraSoftKit = { secCard: (watch, code) => ({ watch, code }), layout: (o) => o };
const pop = F.flightPopup(hass.states, hass, { source: 'sensor.a', flight: 'w1' });
assert.ok(pop.fields.map && pop.fields.prog, 'popup has the map and the progress');
assert.deepEqual(JSON.parse(JSON.stringify(pop.top)), ['line', 'map', 'prog'], 'the map is the one stage, under the head line and over the progress row');
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
assert.doesNotMatch(F.sec('fprog', { src: 'sensor.a', flight: 'w2' }, hass.states, hass), /progressbar/, 'no progress bar without the airports');
assert.match(F.sec('fline', { src: 'sensor.a', flight: 'w2' }, hass.states, hass), /STAGE/, 'route text stays');
assert.match(F.sec('fair', { src: 'sensor.a', flight: 'w1' }, hass.states, hass), /Testair/, 'details stay');
// The tile shows no flight info and no progress: the list popup rows carry the progress text and the decorative bar.
const tile = F.liveHtml(hass, '', nowB);
assert.doesNotMatch(tile, /Ungefährer Fortschritt|data-flights-bar|role="progressbar"/, 'tile: no progress text, bar or progressbar');
const listRows = F.listRows(hass, { pin: '' });
assert.match(listRows, new RegExp('Ungefährer Fortschritt: ' + v.progress), 'list row: the progress text');
assert.match(listRows, new RegExp('data-flights-bar[^>]*width:' + v.progress + '%'), 'list row: bar at the popup value');
assert.doesNotMatch(listRows, /role="progressbar"/, 'list row: the bar has no progressbar role (it is decorative)');

// ── the element: draws on HA's map, follows the flight, and hides when the map is missing or fails ───────────────
const fakeMl = () => {
  const ml = { sources: {}, layers: {}, fits: [], images: [], handlers: {}, styleLoaded: true, loadedFlag: true, tiles: 0,
    isStyleLoaded() { return this.styleLoaded; }, loaded() { return this.loadedFlag; },
    addSource(id, o) { this.sources[id] = { data: o.data, setData(d) { this.data = d; } }; },
    getSource(id) { return this.sources[id]; }, addLayer(o) { this.layers[o.id] = o; this.order = (this.order || []).concat(o.id); }, addImage(id) { this.images.push(id); },
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
  {
    const ids = Object.keys(ml.layers), at = (id) => ids.indexOf(id);
    const rl = ml.layers['casora-flight-route'], rc = ml.layers['casora-flight-route-casing'];
    assert.ok(rl && rc, 'the Remaining route has its layers');
    assert.ok(Array.isArray(rl.paint['line-dasharray']) && Array.isArray(rc.paint['line-dasharray']), 'the route is dashed, its casing too');
    assert.equal(ml.layers['casora-flight-trail'].paint['line-dasharray'], undefined, 'the Flown trail stays solid');
    assert.ok(at('casora-flight-route') < at('casora-flight-airports') && at('casora-flight-route') < at('casora-flight-aircraft')
      && at('casora-flight-route-casing') < at('casora-flight-route'), 'the route lies under the airport dots and the aircraft');
    assert.ok(at('casora-flight-route') < at('casora-flight-arrow') || at('casora-flight-arrow') === -1, 'and under the arrow');
    const rt = ml.sources['casora-flight-route'].data.features;
    assert.equal(rt.length, 1, 'the route data is set');
    deq(rt[0].geometry.coordinates.slice(-1)[0], [20, 50], 'the route ends at the destination');
  }
  // The Unreported part: fainter than the trail, drawn under it, one line from the airport to the oldest trail point.
  assert.ok(ml.layers['casora-flight-unreported'], 'unreported layer added');
  assert.equal(ml.layers['casora-flight-unreported'].paint['line-opacity'], 0.45, 'unreported part at 45 % opacity');
  assert.ok(ml.order.indexOf('casora-flight-unreported') < ml.order.indexOf('casora-flight-trail-casing'), 'drawn under the trail');
  const uc = ml.layers['casora-flight-unreported-casing'];
  assert.ok(uc, 'the Unreported part has a casing layer');
  assert.equal(uc.source, 'casora-flight-unreported', 'the casing draws the same source');
  assert.equal(uc.paint['line-color'], '#000000', 'the casing is dark, so the arc reads on light tiles');
  assert.ok(uc.paint['line-width'] > ml.layers['casora-flight-unreported'].paint['line-width'], 'the casing is wider than the arc');
  assert.ok(ml.order.indexOf('casora-flight-unreported-casing') < ml.order.indexOf('casora-flight-unreported'), 'the casing lies under the arc');
  assert.equal(ml.sources['casora-flight-unreported'].data.features.length, 1, 'unreported part drawn');
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
  const styled = () => shadow.kids.filter((c) => c.textContent && c.textContent.includes('.maplibregl-ctrl-attrib,.leaflet-control-attribution{'));
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
