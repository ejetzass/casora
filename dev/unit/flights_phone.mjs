// Tracked flights on a phone dashboard (49-flights.js): a phone dashboard (<name>-mobile) with no Flights
// setting of its own takes the one of its desktop twin (<name>), read with casora/partner_info. That read is async: until it
// has answered, the phone resolves nothing (no tile, no rows, no guess), and then the flight cards are drawn again. A failed
// read is retried later, not on every render. A pinned source that is gone stays missing on the phone, as on the desktop.
// Controlled fake page: the twin's answer is a promise the test settles by hand. Synthetic data only.
//   node dev/unit/flights_phone.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#setting,ready,resolve,model,tile,airborne,liveHidden,kickFlights,twinOf,fetchTwin
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const FLIGHTS = read('custom_components/casora/scripts/local/49-flights.js');
const now = 1800000000000;
const tick = () => new Promise((r) => setImmediate(r));

// A hass with two source sensors (each one flight). New objects on every change, as HA sends them.
const house = () => {
  const hass = { entities: {}, states: {}, callService() { return Promise.resolve(); } };
  hass.add = (id, flights) => {
    hass.entities = { ...hass.entities, [id]: { entity_id: id, platform: 'flightradar24', device_id: 'd' + id, translation_key: 'additional_tracked' } };
    hass.states = { ...hass.states, [id]: { entity_id: id, state: String(flights.length), attributes: { flights } } };
  };
  return hass;
};
const flight = (id) => ({ id, flight_number: 'XY' + id, tracked_type: 'live', on_ground: 0, latitude: 50, longitude: 4, heading: 90 });

// A fake page: where the browser is, the open dashboard's own variables, the hass, the cards on it and the twin reads.
const page = ({ pathname = '/qa-arbeit-mobile/0', own = {} } = {}) => {
  const P = { reads: [], waiting: [], kicked: [], cards: [], own, hass: house() };
  const ha = { get hass() { return P.hass; } };
  const ctx = {
    console, Intl, Date, Math, JSON, Object, Array, Promise, Set, Map, String, Number, Error,
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 0, clearTimeout() {}, addEventListener() {},
    location: { pathname, search: '' },
    document: { nodeType: 1, querySelector: (s) => (s === 'home-assistant' ? ha : null), querySelectorAll: (s) => (s === '*' || s === 'button-card' ? P.cards : []),
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} } },
    casoraKick: (el) => P.kicked.push(el),
    _casoraLovelaceCfg: () => ({ views: [{ cards: [{ variables: P.own }] }] }),
    _casoraPartnerInfo: (hass, url) => { P.reads.push(url); return new Promise((resolve, reject) => P.waiting.push({ resolve, reject })); },
    casoraLocale: () => 'en-US',
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(FLIGHTS, ctx);
  P.F = ctx._casoraFlights;
  return P;
};
// The twin's answer (or a refusal), then the callbacks run.
const answer = async (P, value) => { P.waiting.shift().resolve(value); await tick(); };
const refuse = async (P) => { P.waiting.shift().reject(new Error('offline')); await tick(); };
const JS = (x) => JSON.parse(JSON.stringify(x));
const KEY = 'casora_flights_source';

// ── A desktop dashboard: its own value, no twin read ──
let P = page({ pathname: '/qa-arbeit/0' });
P.hass.add('sensor.a', [flight('1')]);
P.hass.add('sensor.b', [flight('2')]);
assert.equal(P.F.resolve(P.hass, P.F.setting()).state, 'choose', 'desktop, no value: several sources, no guess');
assert.deepEqual(P.reads, [], 'a desktop reads no twin');
P.own[KEY] = 'sensor.b';
assert.equal(P.F.setting(), 'sensor.b');
assert.equal(P.F.resolve(P.hass, P.F.setting()).state, 'pinned');
assert.deepEqual(P.reads, [], 'a desktop reads no twin, even with a pin');

// ── A phone with no value of its own: nothing is resolved until the twin has answered ──
P = page({});
P.hass.add('sensor.a', [flight('1')]);
P.hass.add('sensor.b', [flight('2')]);
assert.equal(P.F.setting(), '', 'no value yet');
assert.equal(P.F.resolve(P.hass, P.F.setting()).state, 'loading', 'not a guess: the twin is not in yet');
assert.equal(P.F.ready(), false);
assert.deepEqual(JS(P.F.airborne(P.hass, P.F.setting(), now)), [], 'no flights in the air while loading');
assert.equal(P.F.tile(P.hass, P.F.setting()), '', 'the Manage tile says nothing while loading');
assert.equal(P.F.liveHidden(P.hass, now), true, 'the Flights tile stays hidden while loading');
assert.deepEqual(P.reads, ['qa-arbeit'], 'the twin is read once, by its desktop name');
P.F.setting(); P.F.resolve(P.hass, '');
assert.deepEqual(P.reads, ['qa-arbeit'], 'a render during the read asks again: no second read');

// The answer arrives: the phone takes the desktop's source, and the flight cards draw again.
P.cards.push({ localName: 'button-card', _config: { state_display: "[[[ const F = window._casoraFlights; return F ? F.tile(hass, F.setting()) : ''; ]]]" } });
P.cards.push({ localName: 'button-card', _config: { state_display: "[[[ return 'other tile'; ]]]" } });
await answer(P, { confirm: { ids: [], names: {}, views: [] }, scenes: {}, flights: { [KEY]: 'sensor.b', casora_flights_altitude_unit: 'm' } });
assert.equal(P.F.setting(), 'sensor.b', 'the desktop value is the phone value');
assert.equal(P.F.setting('casora_flights_altitude_unit'), 'm', 'the units come along');
assert.equal(P.F.ready(), true);
assert.equal(P.F.resolve(P.hass, P.F.setting()).state, 'pinned');
assert.equal(P.F.resolve(P.hass, P.F.setting()).id, 'sensor.b');
assert.equal(P.F.tile(P.hass, P.F.setting()) !== '', true, 'the tile shows the source now');
assert.deepEqual(P.kicked, [P.cards[0]], 'only the flight cards are drawn again');
assert.deepEqual(P.reads, ['qa-arbeit'], 'the answer is kept: no further read');

// ── Desktop automatic: the phone follows it, one source is automatic, several need a choice ──
P = page({});
P.hass.add('sensor.a', [flight('1')]);
const pending = P.F.setting();
await answer(P, { confirm: { ids: [], names: {}, views: [] }, scenes: {}, flights: {} });
assert.equal(pending, '');
assert.equal(P.F.resolve(P.hass, P.F.setting()).state, 'auto', 'desktop Automatic, one source: automatic on the phone too');
P.hass.add('sensor.b', [flight('2')]);
assert.equal(P.F.resolve(P.hass, P.F.setting()).state, 'choose', 'desktop Automatic, two sources: the phone asks too');

// ── A phone with its own value: its own wins, and no twin read is needed ──
P = page({ own: { [KEY]: 'sensor.b' } });
P.hass.add('sensor.a', [flight('1')]);
P.hass.add('sensor.b', [flight('2')]);
assert.equal(P.F.setting(), 'sensor.b');
assert.equal(P.F.resolve(P.hass, P.F.setting()).state, 'pinned', 'own value resolves at once');
assert.deepEqual(P.reads, [], 'no read when the phone has its own value');

// ── The desktop's pinned source is gone: missing on the phone, never another source ──
P = page({});
P.hass.add('sensor.a', [flight('1')]);
P.hass.add('sensor.b', [flight('2')]);
P.F.setting();
await answer(P, { confirm: { ids: [], names: {}, views: [] }, scenes: {}, flights: { [KEY]: 'sensor.gone' } });
const gone = P.F.resolve(P.hass, P.F.setting());
assert.equal(gone.state, 'missing', 'a missing pin stays missing');
assert.equal(gone.id, 'sensor.gone');
assert.deepEqual(JS(P.F.airborne(P.hass, P.F.setting(), now)), [], 'no fallback to another source');

// ── A failed read: nothing is resolved, and it is not read again on every render ──
P = page({});
P.hass.add('sensor.a', [flight('1')]);
P.F.setting();
await refuse(P);
assert.equal(P.F.resolve(P.hass, P.F.setting()).state, 'loading', 'one source, but no guess after a failed read');
assert.equal(P.F.setting(), '');
assert.deepEqual(P.reads, ['qa-arbeit'], 'no second read within the retry time');

// ── An older integration answers without the Flights part: nothing is resolved either ──
P = page({});
P.hass.add('sensor.a', [flight('1')]);
P.F.setting();
await answer(P, { confirm: { ids: [], names: {}, views: [] }, scenes: {} });
assert.equal(P.F.resolve(P.hass, P.F.setting()).state, 'loading', 'no Flights part is no answer');

// ── No desktop dashboard (the read answers nothing): the phone's own config rules, as before ──
P = page({});
P.hass.add('sensor.a', [flight('1')]);
P.F.setting();
await answer(P, null);
assert.equal(P.F.resolve(P.hass, P.F.setting()).state, 'auto', 'no twin: the own config (empty) is Automatic');

// ── No Home Assistant yet: no read is made, and the next render makes it ──
P = page({});
P.hass.add('sensor.a', [flight('1')]);
const hass0 = P.hass; P.hass = null; // the page has no hass yet
assert.equal(P.F.setting(), '');
assert.deepEqual(P.reads, [], 'no hass, no read');
P.hass = hass0;
P.F.setting();
assert.deepEqual(P.reads, ['qa-arbeit'], 'the next render reads the twin');
await answer(P, { confirm: { ids: [], names: {}, views: [] }, scenes: {}, flights: {} });

console.log('ok flights_phone');
