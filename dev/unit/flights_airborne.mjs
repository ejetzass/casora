// Tracked flights, the Flights tile's rule (49-flights.js): which entries are airborne, how movement evidence starts,
// lasts and resets, and how a flight is shown. Controlled clock: the time is passed in, and the ten-minute hide is a
// timer the test fires by hand. Synthetic flights only.
//   node dev/unit/flights_airborne.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#airborne,liveHtml,liveHidden,fmt,observe,qualifies,arm,redrawFlights,watchConn,resetLive
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');
const MIN = 60000;
const HIDE = 600000; // ten minutes without observed movement
const T0 = 1800000000000; // a fixed instant; every time below is T0 plus an offset

// A fresh module per runtime: a new vm context is a page reload. Timers and cards are the test's fake page.
let F, ctx, timers = [], kicked = [], cards = [];
const runtime = () => {
  timers = [];
  ctx = {
    console,
    localStorage: { getItem: () => null, setItem() {} },
    document: { querySelector: () => null, querySelectorAll: (sel) => (sel === 'button-card' ? cards : []) },
    setTimeout: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.live = false; },
    casoraKick: (el) => kicked.push(el),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  F = ctx._casoraFlights;
  return F;
};
const fireDue = () => { const due = timers.filter((t) => t.live); timers = []; due.forEach((t) => { t.live = false; t.fn(); }); return due.length; };
// The module runs in its own realm: copy results so deepStrictEqual compares values, not prototypes.
const show = (hass, pin, now) => JSON.parse(JSON.stringify(F.airborne(hass, pin, now)));
const ids = (rows) => rows.map((r) => r.key);

// Hass with a source sensor per call (a new state object each time, as HA sends one) and a droppable connection.
const house = () => {
  const listeners = {};
  const hass = {
    entities: {}, states: {}, calls: [],
    connection: { addEventListener: (n, fn) => { (listeners[n] = listeners[n] || []).push(fn); }, fire: (n) => (listeners[n] || []).forEach((fn) => fn()) },
    callService: (...a) => { hass.calls.push(a); return Promise.resolve(); },
  };
  hass.source = (id, flights, state = String(flights.length)) => {
    hass.entities = { ...hass.entities, [id]: { entity_id: id, platform: 'flightradar24', device_id: 'd' + id, translation_key: 'additional_tracked' } };
    hass.states = { ...hass.states, [id]: { entity_id: id, state, attributes: { flights } } };
  };
  return hass;
};
// A live, airborne synthetic flight. Detail fields may change while the position stands still.
const fl = (id, extra = {}) => ({
  id, flight_number: 'XY123', callsign: 'TST123', aircraft_registration: 'T-AAAA', tracked_type: 'live', on_ground: 0,
  latitude: 10, longitude: 20, altitude: 31000, ground_speed: 450, heading: 90, vertical_speed: 0,
  airline_short: 'Testair', airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB', details_updated_at: T0, ...extra,
});
const at = (f, dLat = 0.05) => ({ ...f, latitude: f.latitude + dLat }); // the same flight, one step further

// ── Eligibility: anything that is not a live, airborne flight with a position never shows, even after it moves ──
const bad = {
  'landed (on_ground 1)': { on_ground: 1 },
  'ground flag missing': { on_ground: undefined },
  'ground flag as text 1': { on_ground: '1' },
  'schedule stub': { tracked_type: 'schedule' },
  'registration stub with leftover coordinates': { tracked_type: 'aircraft' },
  'tracked type missing': { tracked_type: undefined },
  'restored identity without position': { latitude: undefined, longitude: undefined },
  'latitude NaN': { latitude: NaN },
  'latitude out of range': { latitude: 91 },
  'longitude out of range': { longitude: -181 },
  'coordinate as text': { latitude: '10' },
  'position exactly (0, 0), no fix': { latitude: 0, longitude: 0 },
};
for (const [name, extra] of Object.entries(bad)) {
  runtime(); const hass = house();
  hass.source('sensor.a', [fl('b1', extra)]);
  assert.deepEqual(show(hass, '', T0), [], `${name}: not shown`);
  hass.source('sensor.a', [at(fl('b1', extra))]);
  assert.deepEqual(show(hass, '', T0 + MIN), [], `${name}: not shown even when it moves`);
}
// An unavailable source keeps no evidence: coming back starts again, with no inherited movement.
runtime(); let hass = house();
hass.source('sensor.a', [fl('g1')]); show(hass, '', T0);
hass.source('sensor.a', [at(fl('g1'))], 'unavailable');
assert.deepEqual(show(hass, '', T0 + MIN), [], 'unavailable source: nothing');
hass.source('sensor.a', [fl('g1', { latitude: 10.1 })]);
assert.deepEqual(show(hass, '', T0 + 2 * MIN), [], 'back after unavailable: a baseline, no inherited evidence');
hass.source('sensor.a', [fl('g1', { latitude: 10.2 })]);
assert.deepEqual(ids(show(hass, '', T0 + 3 * MIN)), ['g1'], 'a valid entry shows after movement');

// ── Initial connection: the first position is a baseline; only an observed change counts ──
runtime(); hass = house();
hass.source('sensor.a', [fl('a1')]);
assert.deepEqual(show(hass, '', T0), [], 'first sight: withheld');
hass.source('sensor.a', [fl('a1', { altitude: 31500, details_updated_at: T0 + 5000 })]);
assert.deepEqual(show(hass, '', T0 + 5000), [], 'frozen position, other attributes changed: still withheld');
hass.source('sensor.a', [at(fl('a1', { altitude: 31500 }))]);
const rows = show(hass, '', T0 + 10000);
assert.deepEqual(ids(rows), ['a1'], 'first observed movement: shown');
assert.equal(rows[0].label, 'XY123');
assert.equal(rows[0].route, 'AAA → BBB');
assert.match(rows[0].altitude, /^31[.,]500 ft$/, 'altitude in feet, grouped');
assert.equal(rows[0].speed, '450\u00a0kn', 'ground speed in knots');

// ── Movement window: frozen position, redraws and other attributes do not renew it; ten minutes hide it ──
const M = T0 + 10000; // the movement above
hass.source('sensor.a', [at(fl('a1', { altitude: 31000, details_updated_at: M + 1000 }))]);
assert.deepEqual(ids(show(hass, '', M + 1000)), ['a1'], 'frozen position at +1 s: still shown');
hass.source('sensor.a', [at(fl('a1', { altitude: 32000, details_updated_at: M + 5 * MIN }))]);
assert.deepEqual(ids(show(hass, '', M + 5 * MIN)), ['a1'], 'redraw with the same position at +5 min: not renewed, still shown');
assert.deepEqual(ids(show(hass, '', M + HIDE - 1)), ['a1'], 'one millisecond before ten minutes: shown');
assert.deepEqual(show(hass, '', M + HIDE), [], 'ten minutes without movement: hidden');
// Recovery: only renewed movement shows it again.
hass.source('sensor.a', [at(fl('a1', { latitude: 10.1 }), 0.1)]);
hass.source('sensor.a', [fl('a1', { latitude: 10.2 })]);
assert.deepEqual(ids(show(hass, '', M + 11 * MIN)), ['a1'], 'renewed movement: shown again');
hass.source('sensor.a', [fl('a1', { latitude: 10.2, altitude: 33000 })]);
assert.deepEqual(show(hass, '', M + 11 * MIN + HIDE), [], 'then frozen for ten minutes: hidden again');

// ── Connection drop and reconnection: unverified until movement, even with the same state object ──
runtime(); hass = house();
hass.source('sensor.a', [fl('r1')]); show(hass, '', T0);
hass.source('sensor.a', [at(fl('r1'))]);
assert.deepEqual(ids(show(hass, '', T0 + MIN)), ['r1'], 'moving before the drop');
hass.connection.fire('disconnected');
assert.deepEqual(show(hass, '', T0 + 2 * MIN), [], 'dropped: hidden');
hass.states = { ...hass.states }; // reconnected: the same positions come again
assert.deepEqual(show(hass, '', T0 + 3 * MIN), [], 'reconnected: unverified at first sight');
hass.connection.fire('ready');
hass.source('sensor.a', [at(fl('r1'), 0.1)]);
assert.deepEqual(show(hass, '', T0 + 4 * MIN), [], 'ready: the first position after it is a baseline again');
hass.source('sensor.a', [at(fl('r1'), 0.2)]);
assert.deepEqual(ids(show(hass, '', T0 + 5 * MIN)), ['r1'], 'reconnected and moved: shown');
const hass2 = { ...hass, connection: { addEventListener() {} } };
assert.deepEqual(show(hass2, '', T0 + 6 * MIN), [], 'a new connection object: unverified');

// ── Reload: a new runtime has no evidence, even for a position that moved before ──
runtime(); hass = house();
hass.source('sensor.a', [at(fl('p1'))]);
assert.deepEqual(show(hass, '', T0), [], 'after a reload: withheld until movement is seen');

// ── Landing and removal: hidden at once; a return needs movement again ──
runtime(); hass = house();
hass.source('sensor.a', [fl('l1')]); show(hass, '', T0);
hass.source('sensor.a', [at(fl('l1'))]);
assert.equal(show(hass, '', T0 + MIN).length, 1);
hass.source('sensor.a', [fl('l1', { on_ground: 1 })]);
assert.deepEqual(show(hass, '', T0 + 2 * MIN), [], 'landed: hidden at once');
hass.source('sensor.a', [fl('l1', { on_ground: 0, latitude: 10.2 })]);
assert.deepEqual(show(hass, '', T0 + 3 * MIN), [], 'airborne again: a baseline, not shown');
hass.source('sensor.a', [fl('l1', { latitude: 10.3 })]);
assert.deepEqual(ids(show(hass, '', T0 + 4 * MIN)), ['l1'], 'then movement: shown');
hass.source('sensor.a', []);
assert.deepEqual(show(hass, '', T0 + 5 * MIN), [], 'removed from the list: hidden at once');
hass.source('sensor.a', [fl('l1', { latitude: 10.3 })]);
assert.deepEqual(show(hass, '', T0 + 6 * MIN), [], 're-added with the same ID: no inherited evidence');

// ── Reused flight numbers, replacement IDs, and the same identifier on another source ──
runtime(); hass = house();
hass.source('sensor.a', [fl('n1')]); show(hass, '', T0);
hass.source('sensor.a', [at(fl('n1'))]);
assert.deepEqual(ids(show(hass, '', T0 + MIN)), ['n1']);
hass.source('sensor.a', [fl('n1'), fl('n2', { latitude: 30 })]);
assert.deepEqual(ids(show(hass, '', T0 + 2 * MIN)), ['n1'], 'a new ID with the same number: withheld');
// n2 was listed since T0+2 min (a baseline there), so its move at T0+3 min counts; n1's evidence is gone with n1.
hass.source('sensor.a', [fl('n2', { latitude: 30.1 })]);
assert.deepEqual(ids(show(hass, '', T0 + 3 * MIN)), ['n2'], 'n1 gone, n2 moved since its own baseline: only n2');
// A replacement that was never listed before starts at a baseline, whatever its number.
hass.source('sensor.a', [fl('n3', { latitude: 40 })]);
assert.deepEqual(show(hass, '', T0 + 4 * MIN), [], 'a new ID replacing n2: withheld, no inherited movement');
hass.source('sensor.a', [fl('n3', { latitude: 40.1 })]);
assert.deepEqual(ids(show(hass, '', T0 + 5 * MIN)), ['n3'], 'the new ID moving: shown');
hass.source('sensor.b', [fl('n3', { latitude: 40.1 })]);
assert.deepEqual(show(hass, 'sensor.b', T0 + 5 * MIN), [], 'the same ID on another source: its own baseline');
assert.deepEqual(ids(show(hass, 'sensor.a', T0 + 5 * MIN)), ['n3'], 'and the first source is unchanged');

// Two entries with one FR24 ID are no flight that can be followed: neither is shown.
runtime(); hass = house();
hass.source('sensor.a', [fl('d1'), fl('d1', { flight_number: 'XY999' })]); show(hass, '', T0);
hass.source('sensor.a', [at(fl('d1')), at(fl('d1', { flight_number: 'XY999' }))]);
assert.deepEqual(show(hass, '', T0 + MIN), [], 'a duplicate ID: nothing shown');

// ── Several flights: every qualifying one, in source order, no silent cap ──
runtime(); hass = house();
const many = Array.from({ length: 12 }, (_, i) => fl('m' + i, { flight_number: 'XY' + (100 + i), latitude: 10 + i }));
hass.source('sensor.a', [...many, fl('x', { on_ground: 1 })]); show(hass, '', T0);
hass.source('sensor.a', [...many.map((f) => at(f)), fl('x', { on_ground: 1 })]);
const all = show(hass, '', T0 + MIN);
assert.equal(all.length, 12, 'all twelve listed');
assert.deepEqual(ids(all), many.map((f) => f.id), 'source order');

// ── Formatting: zero is a value; missing or invalid readings are left out ──
runtime(); hass = house();
const z = [fl('z1', { altitude: 0, ground_speed: 0 }), fl('z2', { altitude: -150, ground_speed: 450.6 }),
  fl('z3', { altitude: undefined, ground_speed: NaN, airport_destination_code_iata: undefined })];
hass.source('sensor.a', z); show(hass, '', T0);
hass.source('sensor.a', z.map((f) => at(f)));
const out = show(hass, '', T0 + MIN);
assert.equal(out[0].altitude, '0\u00a0ft', 'zero altitude is shown');
assert.equal(out[0].speed, '0\u00a0kn', 'zero ground speed is shown');
assert.equal(out[1].altitude, '-150\u00a0ft', 'negative altitude');
assert.equal(out[1].speed, '451\u00a0kn', 'rounded to whole knots');
assert.equal(out[2].altitude, '', 'missing altitude is omitted');
assert.equal(out[2].speed, '', 'NaN speed is omitted');
assert.equal(out[2].route, '', 'a route needs both airports');
assert.equal(F.fmt.altitude(31000), '31,000\u00a0ft', 'grouping follows the page locale, default');
ctx.casoraLocale = () => 'de-DE';
assert.equal(F.fmt.altitude(31000), '31.000\u00a0ft', 'German grouping through the page locale');

// ── Tile output: rows are escaped; hidden without any flight ──
runtime(); hass = house();
hass.source('sensor.a', [fl('h1', { flight_number: '<i>XY</i>' })]);
assert.equal(F.liveHidden(hass, T0), true, 'nothing verified yet: the tile is hidden');
assert.equal(F.liveHtml(hass, '', T0), '');
hass.source('sensor.a', [fl('h1', { flight_number: '<i>XY</i>', altitude: 31100 })]);
assert.equal(F.liveHidden(hass, T0 + MIN), true, 'frozen position: still hidden');
hass.source('sensor.a', [at(fl('h1', { flight_number: '<i>XY</i>' }))]);
assert.equal(F.liveHidden(hass, T0 + 2 * MIN), false, 'moving flight: shown');
const html = F.liveHtml(hass, '', T0 + 3 * MIN);
assert.match(html, /&lt;i&gt;XY&lt;\/i&gt;/, 'label is escaped');
assert.doesNotMatch(html, /<i>/);
assert.match(html, /AAA → BBB/);
assert.match(html, /31,000\u00a0ft · 450\u00a0kn/);

// ── The hide happens on a timer: one wake-up at the earliest hide time, redrawing only Flights tiles ──
runtime(); hass = house();
cards = [
  { _config: { state_display: '[[[ return window._casoraFlights.liveHtml(hass) ]]]' } },
  { _config: { state_display: '[[[ return window._casoraFlights.tile(hass) ]]]' } },
];
kicked = [];
hass.source('sensor.a', [fl('t1')]); show(hass, '', T0);
hass.source('sensor.a', [at(fl('t1'))]);
show(hass, '', T0 + MIN);
const armed = timers.filter((t) => t.live);
assert.equal(armed.length, 1, 'one wake-up armed');
assert.equal(armed[0].ms, (T0 + MIN + HIDE) - (T0 + MIN), 'at the hide time of the last movement');
assert.equal(fireDue(), 1);
assert.deepEqual(kicked, [cards[0]], 'only the Flights tile is redrawn');

// The open flight popup expires with the same wake-up: its parts are redrawn at the hide time, not on the next state change.
runtime(); hass = house();
const popCard = { _config: { custom_fields: { c: '[[[\n return window._casoraFlights ? window._casoraFlights.sec("fstage", {"src":"sensor.a","flight":"t2"}, states, hass) : "";\n]]]' } } };
cards = [popCard, { _config: { state_display: '[[[ return window._casoraFlights.tile(hass) ]]]' } }];
kicked = [];
hass.source('sensor.a', [fl('t2')]); show(hass, '', T0);
hass.source('sensor.a', [at(fl('t2'))]);
show(hass, '', T0 + MIN);
assert.equal(fireDue(), 1, 'one wake-up at the hide time');
assert.deepEqual(kicked, [popCard], 'the open flight popup is redrawn at the hide time; the plain card is not');

// ── Wiring: the Dashboard tile reads only the shared rule, and the Studio offers it where the source exists ──
const tpl = JSON.parse(read('dashboards/casora/button_card_templates.json')).casora_flights_airborne;
assert.deepEqual(tpl.template, ['casora_entity'], 'a plain entity-less tile: no popup, the native tile tap');
assert.ok(tpl.state_display.includes('F.liveHtml(hass, F.setting(), Date.now(), variables.casora_default_name)'), 'the rows come from the shared rule, named by the template');
assert.ok(tpl.hidden.includes('liveHidden(hass)'), 'hidden unless a flight qualifies');
// No entity and no popup: a tap on the tile body does nothing, and holding does nothing. button-card then marks the card
// "disabled" (pointer-events none), so the card's own style turns hit-testing back on: the rows stay tappable.
assert.deepEqual(tpl.tap_action, { action: 'none' }, 'a tap on the tile body does nothing');
assert.deepEqual(tpl.hold_action, { action: 'none' }, 'a hold on the tile body does nothing');
assert.ok(tpl.styles.card.some((s) => s['pointer-events'] === 'auto'), 'the card stays hit-testable: the rows take the pointer');
const types = read('custom_components/casora/panel/casora-panel-types.js');
assert.match(types, /id: "casora_flights_airborne", label: "Flights", template: "casora_flights_airborne"/);

// ── Reading is never a write ──
assert.equal(hass.calls.length, 0, 'the tile never sends a service call');
// ── Many flights: every row is listed, and the list scrolls inside the tile instead of spilling out of the card ──
runtime(); hass = house();
const nineAt = (dy) => Array.from({ length: 9 }, (_, i) => fl("n" + i, { flight_number: "XN" + i, latitude: 10 + i, longitude: 20 + dy }));
hass.source("sensor.a", nineAt(0)); F.airborne(hass, "", T0);
hass.source("sensor.a", nineAt(0.05));
const tileMany = F.liveHtml(hass, '', T0 + MIN);
// Desktop with two or more flights: one line on the tile, no rows. The list popup's rows: flights_tile_desktop.mjs.
assert.equal(F.airborne(hass, '', T0 + MIN).length, 9, 'nine flights in the air');
assert.equal(tileMany.replace(/<[^>]*>/g, ''), '9 in der Luft', 'nine flights: one line on the tile');
assert.doesNotMatch(tileMany, /data-flights-row/, 'nine flights: no rows on the tile');
// The tile's CSS is not in the text: it is in the card (casora-flight-list), so it cannot reach the card's name.
assert.doesNotMatch(tileMany, /<style/, 'the tile text carries no style element');
const tileCss = F._tileCss;
assert.match(tileCss, /#container\{[^}]*height:100%[^}]*grid-template-rows:min-content min-content minmax\(0,1fr\)/, 'the desktop grid limits the list to the card');
assert.match(tileCss, /@media[^}]*#container\{grid-template-rows:min-content minmax\(0,1fr\)/, 'the phone grid also limits the list to the card');
assert.match(tileCss, /#state\{[^}]*min-height:0[^}]*overflow:hidden/, 'flight rows cannot paint over neighboring tiles');
assert.match(tileCss, /\[data-flights-row\]:focus-visible[^{]*\{[^}]*outline:\s*2px/, 'a row shows a 2px focus ring');
assert.doesNotMatch(tileMany, /opacity:\.75/, 'secondary text keeps its contrast');

console.log('ok flights_airborne');
