// @deckt: custom_components/casora/scripts/local/46-screensaver.js#kindAt,pool,has,offered,context,html,sample,mount,vars
// The Flights screensaver kind (46-screensaver.js with the shared rule of 49-flights.js): eligibility and native fallback,
// the native five-minute turns of „mix“ (every flight and both layouts take their turn, no timer of its own), a single
// Flights kind with no turn (the first flight, on the map), updates that do not reset the turn, removal and reconnection,
// the local route picture (no tiles, no links), the preview with nothing to show (the sky, no invented flight), mount and
// unmount. Controlled clock; synthetic flights; no browser.
//   node dev/unit/screensaver_flights.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const FLIGHTS_SRC = read('custom_components/casora/scripts/local/49-flights.js');
const SAVER_SRC = read('custom_components/casora/scripts/local/46-screensaver.js');
const TURN = 300000;
// An even turn number at the anchor: in „mix“ with two kinds, the flights take the odd turns.
const SLOT0 = Math.floor(Date.UTC(2026, 10, 18, 12, 0, 0) / (2 * TURN)) * 2 * TURN;
const SRC = 'sensor.fr24';
const J = (x) => JSON.parse(JSON.stringify(x));

// A fresh runtime per case: the movement evidence lives in the module, so no case may see another's.
const runtime = () => {
  const handlers = {};
  const conn = { addEventListener: (t, fn) => { (handlers[t] || (handlers[t] = [])).push(fn); }, fire: (t) => (handlers[t] || []).forEach((fn) => fn()) };
  const timers = [];
  const box = {
    console, Intl, Date, Math, parseFloat, isFinite, isNaN, parseInt, String, Number, JSON, Array, Object, Promise, Set, Map, Error, RegExp,
    setInterval: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; },
    clearInterval: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
    setTimeout: () => 0, clearTimeout() {}, location: { search: '', pathname: '/' }, addEventListener() {},
    localStorage: { getItem: () => null, setItem() {} }, HTMLElement: class {}, customElements: { get: () => undefined, define() {} },
  };
  box.window = box;
  box.document = { nodeType: 1, getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} } };
  box.casoraLocale = () => 'en-US';
  vm.createContext(box);
  vm.runInContext(FLIGHTS_SRC, box);
  vm.runInContext(SAVER_SRC, box);
  const R = { S: box._casoraSaver, F: box._casoraFlights, conn, timers, clock: { t: SLOT0 + 1000 }, vars: {}, step: 0 };
  R.hass = house(R);
  R.host = { innerHTML: '', getRootNode: () => box.document };
  R.api = R.S.mount(R.host, null, { every: 3600000, kind: () => R.vars.kind || 'mix',
    context: () => ({ hass: R.hass, vars: R.vars, now: new Date(R.clock.t) }) });
  return R;
};

// Synthetic FlightRadar24 entries: positions move with each step, so each new step is an observed movement.
const entry = (id, step, o = {}) => ({
  id, flight_number: 'XY' + id, callsign: 'XYZ' + id, tracked_type: 'live', on_ground: 0,
  latitude: 50.2 + 0.01 * step, longitude: 10.1 + 0.02 * step, altitude: 35000, ground_speed: 450, heading: 90, vertical_speed: -500,
  airline: 'Example Air', airline_short: 'Example Air', aircraft_model: 'Type 100', aircraft_registration: 'AB-CDE',
  airport_origin_name: 'Airport A', airport_origin_terminal: 'T1', airport_origin_latitude: 50, airport_origin_longitude: 4,
  airport_origin_timezone_offset: 3600, airport_origin_timezone_abbr: 'CET',
  airport_destination_name: 'Airport B', airport_destination_latitude: 52, airport_destination_longitude: 20,
  airport_destination_timezone_offset: 7200, airport_destination_timezone_abbr: 'EET',
  time_scheduled_arrival: SLOT0 / 1000 + 5400, time_estimated_arrival: SLOT0 / 1000 + 5000,
  coordinates: [[50, 4], [50.1, 5]], ...o,
});
const twoFlights = (step) => [entry('1', step), entry('456', step, { flight_number: 'XY456', callsign: 'XYZ456', airport_origin_name: 'Airport C' })];
const house = (R) => ({
  config: { time_zone: 'Europe/Amsterdam' }, locale: { time_format: '24' }, themes: { darkMode: true }, connection: R.conn,
  entities: { [SRC]: { platform: 'flightradar24', translation_key: 'additional_tracked', device_id: 'd1' } },
  devices: { d1: { name: 'Tracker' } },
  states: { [SRC]: { state: '2', attributes: { flights: twoFlights(R.step) } } },
});
// A new state object with new positions: an observed movement for every flight in it.
const move = (R, step, flights) => { R.step = step; R.hass.states[SRC] = { state: '2', attributes: { flights: flights || twoFlights(step) } }; };
const at = (R, ms) => { R.clock.t = ms; R.api.update(); return R.host.innerHTML; };
// The first sight of a source is only a baseline: one call before the movement that counts.
const warm = (R, kind = 'flights') => { R.vars = { kind }; at(R, SLOT0); };
const kindOf = (html) => (html.match(/data-kind="([a-z]+)"/) || [])[1];
const flightOf = (html) => (html.match(/XY(\d+)/) || [])[1];
// „mix“ with Flights and wort: Flights takes every other turn, and its map and details alternate between those turns.
// Returns the first Flights screen in the details layout (flightsOf(step) gives the flights of each step, each a movement).
const mixDetail = (flightsOf) => {
  const R = runtime();
  R.vars = { casora_screensaver_mix: ['flights', 'wort'] };
  at(R, SLOT0); // the first sight is a baseline
  for (let i = 0; i < 6; i++) {
    move(R, 1 + i, flightsOf(1 + i));
    const h = at(R, SLOT0 + i * TURN + 1000);
    if (kindOf(h) === 'flights' && /cs-fl-rows/.test(h)) return { html: h, R };
  }
  throw new Error('no details turn for Flights in the mix');
};

// ── Eligibility and the native fallback ─────────────────────────────────────────────────────────────────────────────
{
  const R = runtime(), { S } = R;
  const k = S.KINDS.find((x) => x.id === 'flights');
  assert.ok(k && /^mdi:/.test(k.icon) && /^#[0-9A-F]{6}$/i.test(k.tone) && k.needs, 'Flights is a kind with icon, tone and its needs text');
  const none = { states: {}, entities: {}, devices: {}, config: {}, locale: {} };
  assert.ok(!S.offered(none).some((x) => x.id === 'flights'), 'no integration: Studio does not offer Flights');
  assert.ok(S.offered(R.hass).some((x) => x.id === 'flights'), 'integration present: Studio offers Flights');
  assert.equal(S.has('flights', { hass: none, vars: {}, now: new Date(SLOT0) }), false, 'no integration: no data');
  assert.equal(S.has('flights', { hass: R.hass, vars: {}, now: new Date(SLOT0) }), false, 'first sight is a baseline: not yet qualifying');
  move(R, 1);
  assert.equal(S.has('flights', { hass: R.hass, vars: {}, now: new Date(SLOT0 + 1000) }), true, 'observed movement: qualifying');
  assert.ok(!S.pool({ casora_screensaver_mix: ['flights', 'wort'] }, (id) => S.has(id, { hass: none, vars: {}, now: new Date(SLOT0) })).includes('flights'),
    'no integration: out of the alternation');
  // Grounded flights and schedule stubs do not qualify: the native sky shows, never an empty card.
  const grounded = { states: { [SRC]: { state: '1', attributes: { flights: [entry('9', 1, { on_ground: 1 }), entry('8', 1, { tracked_type: 'schedule' })] } } },
    entities: R.hass.entities, devices: R.hass.devices, config: {}, locale: {} };
  assert.equal(S.has('flights', { hass: grounded, vars: {}, now: new Date(SLOT0 + 1000) }), false, 'grounded or schedule stubs do not qualify');
  assert.equal(kindOf(S.html('flights', S.context({ hass: grounded, now: new Date(SLOT0 + 1000), kind: 'flights', vars: {}, events: [], rooms: [] }))), 'himmel',
    'nothing qualifying: the native sky');
}

// ── On by default: with no flight in the air the other kinds keep their turns; one flight in the air takes a turn ─────
// With nothing in the air, the rotation is the other kinds alone, in KINDS order.
const OLD_ROTATION = ['himmel', 'land', 'wort', 'linie', 'woche', 'ruhe', 'kalender'];
const defaultHas = (R) => (id) => R.S.has(id, { hass: R.hass, vars: {}, rooms: [], now: new Date(R.clock.t) });
{
  const R = runtime(), { S } = R;
  const has = defaultHas(R);
  assert.equal(has('flights'), false, 'first sight: no flight qualifies yet');
  assert.deepEqual(J(S.pool({}, has)), OLD_ROTATION, 'default mix, FlightRadar24 present, no flight: Flights not in the pool, the others as before');
  // Over two rounds of the rotation the screensaver shows the kind the rotation of the other kinds gives for each turn.
  R.vars = {};
  for (let i = 0; i < 2 * OLD_ROTATION.length; i++) {
    const t = SLOT0 + i * TURN + 1000;
    assert.equal(kindOf(at(R, t)), OLD_ROTATION[Math.floor(t / TURN) % OLD_ROTATION.length], 'turn ' + i + ': the kind as before');
  }
}
{
  const R = runtime(), { S } = R;
  const has = defaultHas(R);
  assert.equal(has('flights'), false, 'first sight: a baseline');
  move(R, 1, [entry('1', 1)]); // one flight in the air, and it moves
  assert.equal(has('flights'), true, 'one flight in the air and moving: qualifies');
  assert.deepEqual(J(S.pool({}, has)), ['himmel', 'land', 'wort', 'linie', 'woche', 'ruhe', 'flights', 'kalender'],
    'default mix: Flights takes its turn after the house at rest, by its place in the list');
}

// ── The native turns: every flight and both layouts, one per five-minute turn, no timer of its own ──────────────────
{
  const R = runtime();
  R.vars = { casora_screensaver_mix: ['flights', 'wort'] };
  const seen = [];
  for (let i = 0; i < 8; i++) {
    move(R, 1 + i); // each turn the flights move on: observed movement, so they keep qualifying
    const h = at(R, SLOT0 + i * TURN + 1000);
    if (kindOf(h) === 'flights') seen.push({ flight: flightOf(h), layout: /cs-fl-map/.test(h) ? 'map' : /cs-fl-rows/.test(h) ? 'detail' : '?' });
    else assert.equal(kindOf(h), 'wort', 'the other turn shows its own kind');
  }
  assert.deepEqual(seen, [
    { flight: '1', layout: 'map' }, { flight: '456', layout: 'map' }, { flight: '1', layout: 'detail' }, { flight: '456', layout: 'detail' },
  ], 'flight 1 and 456 on the map, then both in detail: fair over the native turns');
  assert.notEqual(R.S.turnOf('mix', SLOT0 + 3 * TURN, ['flights', 'wort']), R.S.turnOf('mix', SLOT0, ['flights', 'wort']),
    'in mix the turn counts the five minutes');
  assert.equal(R.timers.filter((t) => t.live).length, 1, 'only the screensaver\'s own update timer (no flight timer)');
}

// A single Flights kind has no turn, as the other single kinds have none: the first flight, on the map, at every time.
{
  const R = runtime();
  warm(R);
  const seen = [];
  for (let i = 0; i < 8; i++) {
    move(R, 1 + i); // the flights keep moving: both stay on the list
    const h = at(R, SLOT0 + i * TURN + 1000);
    seen.push({ kind: kindOf(h), flight: flightOf(h), layout: /cs-fl-map/.test(h) ? 'map' : /cs-fl-rows/.test(h) ? 'detail' : '?' });
  }
  assert.deepEqual(seen, Array.from({ length: 8 }, () => ({ kind: 'flights', flight: '1', layout: 'map' })),
    'every turn: flight 1 on the map, no clock in it');
  assert.equal(R.S.turnOf('flights', SLOT0), R.S.turnOf('flights', SLOT0 + 3 * TURN), 'a single kind has no turn of its own');
}

// A routine position update keeps the flight and its layout; a single kind keeps its flight at the next turn too.
{
  const R = runtime();
  warm(R);
  move(R, 1);
  const first = at(R, SLOT0 + 1000);
  move(R, 2);
  const again = at(R, SLOT0 + 90000);
  assert.equal(flightOf(again), flightOf(first), 'a routine position update keeps the flight on show');
  assert.match(again, /cs-fl-map/, 'and its layout');
  const later = at(R, SLOT0 + TURN + 1000);
  assert.equal(flightOf(later), '1', 'a single kind has no turn: the first flight is still on show');
  assert.match(later, /cs-fl-map/, 'and on the map');
}

// Removal is immediate; the other flight takes the turn, and with none left the native sky.
{
  const R = runtime();
  warm(R);
  move(R, 1);
  assert.equal(flightOf(at(R, SLOT0 + 1000)), '1');
  move(R, 2, [entry('456', 2, { flight_number: 'XY456', callsign: 'XYZ456' })]);
  assert.equal(flightOf(at(R, SLOT0 + 2000)), '456', 'flight 1 left the source: the remaining one shows at once');
  move(R, 3, []);
  assert.equal(kindOf(at(R, SLOT0 + 3000)), 'himmel', 'no flights left: the native sky');
}

// Reconnection starts unverified: after a disconnect, positions are a baseline again until they move.
{
  const R = runtime();
  warm(R);
  move(R, 1);
  assert.equal(kindOf(at(R, SLOT0 + 1000)), 'flights');
  R.conn.fire('disconnected');
  move(R, 1);
  assert.equal(kindOf(at(R, SLOT0 + 2000)), 'himmel', 'reconnected with the same position: withheld');
  move(R, 2);
  assert.equal(kindOf(at(R, SLOT0 + 3000)), 'flights', 'once it moves again: shown');
}

// Ten minutes without an observed change: the flight leaves the display (controlled clock, no waiting).
{
  const R = runtime();
  warm(R);
  move(R, 1);
  at(R, SLOT0 + 1000);
  assert.equal(kindOf(at(R, SLOT0 + 1000 + 599000)), 'flights', 'inside the window');
  assert.equal(kindOf(at(R, SLOT0 + 1000 + 601000)), 'himmel', 'after ten minutes without movement: gone');
}

// Layouts: the map shows identity and route, altitude, ground speed, progress and the estimated arrival; the detail shows the
// aircraft, airports, heading, vertical speed and times. Units follow the saved units. Missing details are left out.
{
  const R = runtime();
  warm(R);
  move(R, 1);
  at(R, SLOT0 + 1000);
  const map = at(R, SLOT0 + 2000);
  assert.match(map, /XY1\b/); assert.match(map, /35,000\u00a0ft/); assert.match(map, /450\u00a0kn/);
  assert.match(map, /Ungefährer Fortschritt/); assert.match(map, /Voraussichtliche Ankunft/);
  const { html: detail } = mixDetail((s) => [entry('1', s)]); // the details come in the mix, on Flights' own turns
  assert.match(detail, /cs-fl-rows/);
  assert.match(detail, /Example Air/); assert.match(detail, /AB-CDE/); assert.match(detail, /XYZ1/); assert.match(detail, /90°/);
  assert.match(detail, /-500\u00a0ft\/min/); assert.match(detail, /Airport A/); assert.match(detail, /Airport B/); assert.match(detail, /T1/);
  assert.match(detail, /<span>Ankunft<\/span><b>Voraussichtlich: /); // a timing row names its side; its text names the kind
  assert.match(detail, /<span>Ankunft<\/span><b>Geplant: /); // scheduled and estimated arrival stay two rows
  assert.match(detail, /Zeit am Zielort/);
}
// The timing rows are the popup's own rows (49-flights.js timeRows): the same labels and texts, so the saver and the popup read alike.
{
  const dep = { time_scheduled_departure: SLOT0 / 1000 - 1800, time_real_departure: SLOT0 / 1000 - 1700 };
  const cases = [
    ['all airport times', dep],
    ['no airport zone: local times only', { ...dep, airport_origin_timezone_offset: undefined, airport_destination_timezone_offset: undefined }],
  ];
  cases.forEach(([label, o]) => {
    const { html: h, R } = mixDetail((s) => [entry('1', s, o)]);
    assert.match(h, /cs-fl-rows/, label);
    const want = R.F.timeRows(R.hass, entry('1', 1, o), false);
    assert.ok(want.some(([l]) => l === 'Abflug') && want.some(([l]) => l === 'Ankunft'), label + ': departure and arrival rows');
    want.forEach(([l, t]) => assert.ok(h.includes('<span>' + l + '</span><b>' + t + '</b>'), label + ': the popup row ' + l + ': ' + t));
  });
}
{
  const R = runtime();
  warm(R);
  R.vars = { kind: 'flights', casora_flights_altitude_unit: 'm', casora_flights_speed_unit: 'kmh' };
  move(R, 1);
  at(R, SLOT0 + 1000);
  const h = at(R, SLOT0 + 2000);
  assert.match(h, /10,668\u00a0m/, 'saved altitude unit');
  assert.match(h, /833\u00a0km\/h/, 'saved speed unit');
}
{
  const bare = (step) => [entry('1', step, { airline: undefined, airline_short: undefined, aircraft_registration: undefined, callsign: undefined,
    heading: undefined, vertical_speed: undefined, airport_origin_terminal: undefined })];
  const { html: h } = mixDetail(bare);
  assert.match(h, /cs-fl-rows/);
  assert.ok(!/Registrierung|Rufzeichen|Kurs|Vertikalgeschwindigkeit|Fluggesellschaft|Terminal T/.test(h), 'missing details are left out, not shown as blank or zero');
}

// The route picture is local: no link, no image, no map tiles. A route over the dateline stays a small picture.
{
  const R = runtime();
  warm(R);
  const dl = (step) => [entry('1', step, { longitude: 179.9 + 0.05 * step, airport_origin_longitude: 179, airport_destination_longitude: -179,
    coordinates: [[50, 178.5], [50, 179.5]] })];
  move(R, 1, dl(1));
  at(R, SLOT0 + 1000);
  move(R, 2, dl(2));
  const h = at(R, SLOT0 + 2000);
  assert.ok(!/https?:|url\(|<img|<image|ha-map|maplibre|<link/i.test(h), 'no external content');
  const vb = (h.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) || []).slice(1).map(Number);
  assert.equal(vb.length, 2, 'a picture with a box');
  assert.ok(vb[0] > 0 && vb[0] < 20, 'the dateline route is drawn across the line, not across the globe: ' + vb);
  assert.match(h, /<line class="cs-fl-route"[^>]*vector-effect="non-scaling-stroke"/, 'the route outline does not grow with map scale');
  assert.match(h, /<circle class="cs-fl-ap"[^>]*vector-effect="non-scaling-stroke"/, 'airport outlines do not cover the picture');
}

// The aircraft marker has one fixed size on every map: a lone flight (a small picture) and a long route (a big one).
// It is an element in the screen's units, not a part of the picture, so the route's span cannot shrink it.
{
  const sizeOf = (h) => (h.match(/<div class="cs-fl-mk"[^>]*style="[^"]*width:([\d.]+)cqmin/) || [])[1];
  const R1 = runtime();
  warm(R1);
  const solo = (step) => [entry('1', step, { airport_origin_latitude: null, airport_origin_longitude: null,
    airport_destination_latitude: null, airport_destination_longitude: null, coordinates: [] })];
  move(R1, 1, solo(1));
  at(R1, SLOT0 + 1000);
  move(R1, 2, solo(2));
  const h1 = at(R1, SLOT0 + 2000);
  const R2 = runtime();
  warm(R2);
  const wide = (step) => [entry('1', step, { latitude: 50 + 0.5 * step, longitude: 4 + 9 * step, coordinates: [[40, -20], [45, -10]] })];
  move(R2, 1, wide(1));
  at(R2, SLOT0 + 1000);
  move(R2, 2, wide(2));
  const h2 = at(R2, SLOT0 + 2000);
  const lone = sizeOf(h1), route = sizeOf(h2);
  assert.ok(lone && route, 'both maps draw an aircraft marker with a size in the screen units');
  assert.equal(lone, route, 'the marker has the same size on a lone flight and on a long route');
  assert.equal(lone, (40 / 8.2).toFixed(3), 'the marker is u(40) of the saver');
  assert.ok(!/<path class="cs-fl-ac"/.test(h2), 'the marker is no longer a shape in the picture, which scales with the route');
}

// Preview: with FlightRadar24 there but nothing qualifying, the preview shows the sky, as at runtime, and no invented flight.
// A flight that qualifies shows in the preview as well.
{
  const R = runtime();
  const now = new Date(SLOT0 + 1000);
  const none = { states: {}, entities: {}, devices: {}, config: {}, locale: {} };
  const ex = R.S.sample(R.S.context({ hass: R.hass, now, kind: 'flights', vars: {}, events: [], rooms: [] }));
  assert.equal((ex.flights || []).length, 0, 'nothing qualifies: no example flight is made up');
  const html = R.S.html('flights', ex);
  assert.equal(kindOf(html), 'himmel', 'the preview shows the sky');
  assert.ok(!/XY123|Example Air|Beispiel/.test(html), 'no example text in the preview');
  const bare = R.S.sample(R.S.context({ hass: none, now, kind: 'flights', vars: {}, events: [], rooms: [] }));
  assert.equal(kindOf(R.S.html('flights', bare)), 'himmel', 'no integration: the sky, as at runtime');
  warm(R);
  move(R, 1, [entry('1', 1)]);
  at(R, SLOT0 + 1000);
  move(R, 2, [entry('1', 2)]);
  at(R, SLOT0 + 2000); // the movement is seen here
  const live = R.S.sample(R.S.context({ hass: R.hass, now: new Date(SLOT0 + 3000), kind: 'flights', vars: {}, events: [], rooms: [] }));
  assert.equal(live.flights.length, 1, 'a flight that qualifies is shown');
  assert.equal(live.flights[0].label, 'XY1', 'and it is the real one');
  assert.equal(live.flights[0].example, undefined, 'not an example');
}

// Mount: destroy stops the one timer and empties the host.
{
  const R = runtime();
  warm(R);
  move(R, 1);
  at(R, SLOT0 + 1000);
  R.api.destroy();
  assert.equal(R.host.innerHTML, '', 'the host is emptied');
  assert.equal(R.timers.filter((t) => t.live).length, 0, 'the update timer is stopped');
}

// A source change: a pinned source that is not there shows no flights (no fallback to another source), so the sky shows.
{
  const R = runtime();
  warm(R);
  move(R, 1);
  assert.equal(kindOf(at(R, SLOT0 + 1000)), 'flights');
  R.vars = { kind: 'flights', casora_flights_source: 'sensor.gone' };
  assert.equal(kindOf(at(R, SLOT0 + 2000)), 'himmel', 'a missing pinned source: no flights, the sky');
  assert.equal(R.S.flightRows(R.hass, { casora_flights_source: 'sensor.gone' }, new Date(SLOT0 + 2000)).length, 0);
}

// A tap on the Flights saver wakes the dashboard: the saver goes at once, and the tap does not reach the tile underneath.
// The boot code of 46-screensaver.js runs only in a real document, so this case has a small fake DOM (a node tree, a
// queue of timeouts) and a document node type 9. Controlled hass states; no browser.
{
  class Fake {
    constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = {}; this.className = ''; this.textContent = ''; this.parent = null; }
    get isConnected() { let n = this; while (n.parent) n = n.parent; return n.tagName === 'body' || n.tagName === 'head'; }
    appendChild(c) { this.children.push(c); c.parent = this; return c; }
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    addEventListener(t, fn) { (this.listeners[t] || (this.listeners[t] = [])).push(fn); }
    dispatch(t) { (this.listeners[t] || []).forEach((fn) => fn({ type: t, target: this, currentTarget: this, composedPath: () => [this], preventDefault() {}, stopPropagation() {} })); }
    closest() { return null; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
  }
  const timers = [];
  const ha = { hass: null };
  let clock = SLOT0 + 1000; // a controlled clock, as in runtime(): the fixture times are the test's own
  class ClockDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock); }
    static now() { return clock; }
  }
  const body = new Fake('body'), head = new Fake('head');
  const doc = { nodeType: 9, hidden: false, head, body, createElement: (t) => new Fake(t), getElementById: () => null,
    querySelector: (sel) => (sel === 'home-assistant' ? ha : null), querySelectorAll: () => [], addEventListener() {} };
  const box = {
    console, Intl, Date: ClockDate, Math, parseFloat, isFinite, isNaN, parseInt, String, Number, JSON, Array, Object, Promise, Set, Map, Error, RegExp,
    setInterval: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; },
    clearInterval: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true, once: true }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
    location: { search: '', pathname: '/' }, addEventListener() {}, localStorage: { getItem: () => null, setItem() {} },
    HTMLElement: class {}, customElements: { get: () => undefined, define() {} }, casoraLocale: () => 'en-US',
  };
  box.window = box;
  box.document = doc;
  vm.createContext(box);
  vm.runInContext(FLIGHTS_SRC, box);
  vm.runInContext(SAVER_SRC, box);
  const S = box._casoraSaver;
  const conn = { addEventListener() {} }; // one connection: a new one would restart the movement evidence
  const hassAt = (step) => house({ step, conn });
  ha.hass = hassAt(1);
  clock = SLOT0 + 1000;
  const cfg = { views: [{ cards: [{ variables: { casora_screensaver: '5', casora_screensaver_kind: 'flights', casora_flights_source: SRC } }] }] };
  const mark = timers.length; // the page's own boot interval (no hui-root here) is not this saver's
  S.show(cfg);
  const layer = body.children.find((c) => c.className === 'cs-sv-layer');
  assert.ok(layer, 'the saver layer is on the page');
  const mine = () => timers.slice(mark).filter((t) => t.live && !t.once && t.ms === 5000);
  const tick = () => mine().forEach((t) => t.fn());
  tick(); // the baseline of the flight
  clock = SLOT0 + 2000;
  ha.hass = hassAt(2); // the aircraft has moved: seen at this update, shown at the next
  tick();
  clock = SLOT0 + 3000;
  tick();
  assert.match(layer.children[0].innerHTML, /data-kind="flights"/, 'the Flights saver is what shows');
  layer.dispatch('pointerdown');
  assert.equal(layer.style.opacity, '0', 'the layer fades at once on a tap');
  timers.filter((t) => t.live && t.once && t.ms === 1500).forEach((t) => { t.live = false; t.fn(); });
  assert.equal(body.children.filter((c) => c.className === 'cs-sv-layer').length, 0, 'and is gone when the tap is over');
  assert.equal(S.shown(), false, 'the saver reports it is not shown');
  assert.equal(mine().length, 0, 'its update timer is stopped');
}

console.log('ok screensaver_flights');
