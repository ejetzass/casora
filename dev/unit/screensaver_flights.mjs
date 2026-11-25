// @deckt: custom_components/casora/scripts/local/46-screensaver.js#kindAt,pool,has,offered,context,html,sample,mount,vars,flightPick,routeFrame,routeSvg
// The Flights screensaver kind (46-screensaver.js with the shared rule of 49-flights.js): eligibility and native fallback,
// the native five-minute turns of „mix“ (every flight and both layouts take their turn, no timer of its own), a single
// Flights kind (one flight per native turn, in a fixed order; the map and the details alternate per round, and the next
// start moves on too). Covered: updates that do not reset the turn, removal and reconnection, flights joining and leaving
// (also within a turn), an empty list that comes back, a fresh start at the wrap (also with one flight), the preview with
// its own choice, the local route picture (no tiles, no links), the preview with nothing to show (the sky, no invented
// flight), mount and unmount. Controlled clock; synthetic flights; no browser.
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
const f456 = (step, o = {}) => entry('456', step, { flight_number: 'XY456', callsign: 'XYZ456', ...o });
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
const layoutOf = (html) => (/cs-fl-map/.test(html) ? 'map' : /cs-fl-rows/.test(html) ? 'detail' : '?');
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
    if (kindOf(h) === 'flights') seen.push({ flight: flightOf(h), layout: layoutOf(h) });
    else assert.equal(kindOf(h), 'wort', 'the other turn shows its own kind');
  }
  assert.deepEqual(seen, [
    { flight: '1', layout: 'map' }, { flight: '456', layout: 'map' }, { flight: '1', layout: 'detail' }, { flight: '456', layout: 'detail' },
  ], 'flight 1 and 456 on the map, then both in detail: fair over the native turns');
  assert.notEqual(R.S.turnOf('mix', SLOT0 + 3 * TURN, ['flights', 'wort']), R.S.turnOf('mix', SLOT0, ['flights', 'wort']),
    'in mix the turn counts the five minutes');
  assert.equal(R.timers.filter((t) => t.live).length, 1, 'only the screensaver\'s own update timer (no flight timer)');
}

// A single Flights kind: one flight per native five-minute turn, in a fixed order (scheduled departure, then the flight ID),
// round and round. A full round on the map, then a full round in detail, and so on. No timer of its own: the native turn
// (TURN_MS) moves it on.
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  const three = (step) => [entry('1', step), f456(step), entry('789', step)];
  move(R, 0, three(0));
  at(R, SLOT0);
  const seen = [];
  for (let i = 0; i < 8; i++) {
    move(R, 1 + i, three(1 + i));
    const h = at(R, SLOT0 + i * TURN + 1000);
    seen.push({ kind: kindOf(h), flight: flightOf(h), layout: layoutOf(h) });
  }
  assert.deepEqual(seen.map((x) => x.flight), ['1', '456', '789', '1', '456', '789', '1', '456'], 'one flight per turn, in order, wrapping round');
  assert.deepEqual(seen.map((x) => x.layout), ['map', 'map', 'map', 'detail', 'detail', 'detail', 'map', 'map'],
    'a full round on the map (3 turns), then a full round in detail, then the map again');
  assert.ok(seen.every((x) => x.kind === 'flights'), 'every turn is the Flights saver');
  assert.equal(R.S.turnOf('flights', SLOT0), R.S.turnOf('flights', SLOT0 + 3 * TURN), 'a single kind has no turn of its own');
  assert.equal(R.timers.filter((t) => t.live).length, 1, 'only the screensaver\'s own update timer (no flight timer)');
}

// The order is the scheduled departure, then the flight ID: an earlier departure first, equal departures by ID.
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  const dep = (t) => ({ time_scheduled_departure: SLOT0 / 1000 + t });
  const list = (step) => [entry('1', step, dep(3600)), entry('456', step, { ...dep(600), flight_number: 'XY456' }), entry('789', step, dep(3600))];
  move(R, 0, list(0));
  at(R, SLOT0);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    move(R, 1 + i, list(1 + i));
    seen.push(flightOf(at(R, SLOT0 + i * TURN + 1000)));
  }
  assert.deepEqual(seen, ['456', '1', '789', '456'], 'departure first, then ID, then round again');
}

// One flight in the list: it stays, and its layout alternates turn by turn (a round is one flight).
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  move(R, 0, [entry('1', 0)]);
  at(R, SLOT0);
  const layouts = [];
  for (let i = 0; i < 4; i++) {
    move(R, 1 + i, [entry('1', 1 + i)]);
    const h = at(R, SLOT0 + i * TURN + 1000);
    assert.equal(flightOf(h), '1', 'turn ' + i + ': the only flight stays');
    layouts.push(layoutOf(h));
  }
  assert.deepEqual(layouts, ['map', 'detail', 'map', 'detail'], 'one flight: map and details alternate, one turn each');
}

// Two flights: each gets the map for one round (two turns) and then the details for one round.
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  move(R, 0);
  at(R, SLOT0);
  const seen = [];
  for (let i = 0; i < 5; i++) {
    move(R, 1 + i);
    const h = at(R, SLOT0 + i * TURN + 1000);
    seen.push(flightOf(h) + ' ' + layoutOf(h));
  }
  assert.deepEqual(seen, ['1 map', '456 map', '1 detail', '456 detail', '1 map'], 'both flights on the map, then both in detail');
}

// A fresh start of the saver moves on to the next flight and keeps the layout (no reset to the map).
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  move(R, 0);
  at(R, SLOT0);
  move(R, 1);
  assert.equal(flightOf(at(R, SLOT0 + 1000)), '1', 'the first start: flight 1');
  const restart = (ms) => {
    const host = { innerHTML: '', getRootNode: () => R.host.getRootNode() };
    R.S.mount(host, null, { every: 3600000, kind: () => 'flights', context: () => ({ hass: R.hass, vars: R.vars, now: new Date(ms) }) });
    return host.innerHTML;
  };
  const second = restart(SLOT0 + 2000);
  assert.equal(flightOf(second), '456', 'a fresh start shows the next flight');
  assert.match(second, /cs-fl-map/, 'and keeps the layout of the round: the map, mid-round');
}

// A fresh start that wraps (it starts on the last flight's place, so it moves on to the first) flips the layout too.
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  const three = (step) => [entry('1', step), f456(step), entry('789', step)];
  move(R, 0, three(0));
  at(R, SLOT0);
  move(R, 1, three(1));
  at(R, SLOT0 + 1000); // flight 1, map
  move(R, 2, three(2));
  at(R, SLOT0 + TURN + 1000); // flight 456, map
  move(R, 3, three(3));
  assert.equal(layoutOf(at(R, SLOT0 + 2 * TURN + 1000)), 'map', 'flight 789 on the map: the last of the round');
  const restart = (ms) => {
    const host = { innerHTML: '', getRootNode: () => R.host.getRootNode() };
    R.S.mount(host, null, { every: 3600000, kind: () => 'flights', context: () => ({ hass: R.hass, vars: R.vars, now: new Date(ms) }) });
    return host.innerHTML;
  };
  const wrapped = restart(SLOT0 + 2 * TURN + 2000);
  assert.equal(flightOf(wrapped), '1', 'the fresh start moves on from 789 to flight 1');
  assert.equal(layoutOf(wrapped), 'detail', 'the wrap flips the layout: the details');
}

// A fresh start with one flight in the list flips the layout at every start: the one flight is its own round.
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  move(R, 0, [entry('1', 0)]);
  at(R, SLOT0);
  move(R, 1, [entry('1', 1)]);
  assert.equal(layoutOf(at(R, SLOT0 + 1000)), 'map', 'turn 0: flight 1 on the map');
  const restart = (ms) => {
    const host = { innerHTML: '', getRootNode: () => R.host.getRootNode() };
    R.S.mount(host, null, { every: 3600000, kind: () => 'flights', context: () => ({ hass: R.hass, vars: R.vars, now: new Date(ms) }) });
    return host.innerHTML;
  };
  const layouts = [restart(SLOT0 + 2000), restart(SLOT0 + 3000), restart(SLOT0 + 4000)].map((h) => layoutOf(h));
  assert.deepEqual(layouts, ['detail', 'map', 'detail'], 'each start flips: the only flight is its own round');
  assert.equal(flightOf(restart(SLOT0 + 5000)), '1', 'and it stays flight 1');
}

// The list empties and comes back: the layout survives, and flips only when the old flight was the last one of the round.
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  const three = (step) => [entry('1', step), f456(step), entry('789', step)];
  move(R, 0, three(0));
  at(R, SLOT0);
  move(R, 1, three(1));
  assert.equal(layoutOf(at(R, SLOT0 + 1000)), 'map', 'flight 1 on the map');
  move(R, 2, []);
  assert.equal(kindOf(at(R, SLOT0 + TURN + 1000)), 'himmel', 'empty: the sky');
  move(R, 3, three(3));
  assert.equal(kindOf(at(R, SLOT0 + 2 * TURN + 1000)), 'himmel', 'back: a baseline first');
  move(R, 4, three(4));
  const back = at(R, SLOT0 + 2 * TURN + 2000);
  assert.equal(flightOf(back), '456', 'back and moving: the next flight, flight 456 (1 was not the last)');
  assert.equal(layoutOf(back), 'map', 'the layout survives the empty list');
}

// The same, but the old flight was the last one of the round: it comes back and the round ends there.
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  const three = (step) => [entry('1', step), f456(step), entry('789', step)];
  move(R, 0, three(0));
  at(R, SLOT0);
  move(R, 1, three(1));
  at(R, SLOT0 + 1000);
  move(R, 2, three(2));
  at(R, SLOT0 + TURN + 1000);
  move(R, 3, three(3));
  assert.equal(flightOf(at(R, SLOT0 + 2 * TURN + 1000)), '789', 'flight 789 on the map, the last of the round');
  move(R, 4, []);
  assert.equal(kindOf(at(R, SLOT0 + 3 * TURN + 1000)), 'himmel', 'empty: the sky');
  move(R, 5, three(5));
  at(R, SLOT0 + 3 * TURN + 2000);
  move(R, 6, three(6));
  const back = at(R, SLOT0 + 4 * TURN + 1000);
  assert.equal(flightOf(back), '1', 'back: the round wraps to flight 1');
  assert.equal(layoutOf(back), 'detail', 'the old flight was last: the layout flips');
}

// The Studio preview reads the choice and keeps nothing: it shows the map, and the saver's own turn is not moved by it.
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  move(R, 0);
  at(R, SLOT0);
  move(R, 1);
  at(R, SLOT0 + 1000); // flight 1, map
  move(R, 2);
  at(R, SLOT0 + TURN + 1000); // flight 456, map
  move(R, 3);
  at(R, SLOT0 + 2 * TURN + 1000); // flight 1, details: a round has gone by
  const sample = { host: { innerHTML: '', getRootNode: () => R.host.getRootNode() } };
  sample.api = R.S.mount(sample.host, null, { sample: true, every: 3600000, kind: () => 'flights',
    context: () => ({ hass: R.hass, vars: R.vars, now: new Date(SLOT0 + 3 * TURN + 1000) }) });
  assert.equal(flightOf(sample.host.innerHTML), '456', 'the preview shows the flight the next turn would');
  assert.match(sample.host.innerHTML, /cs-fl-map/, 'the preview stays on the map');
  sample.api.destroy();
  assert.match(at(R, SLOT0 + 3 * TURN + 2000), /cs-fl-rows/, 'the saver is in detail on its next turn: the preview kept nothing');
  assert.equal(flightOf(at(R, SLOT0 + 3 * TURN + 2000)), '456', 'and it is flight 456');
}

// A flight that leaves at the round boundary ends the round at the end of the list: 789 was last on the map, so the details start.
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  const three = (step, ids) => ids.map((id) => (id === '456' ? f456(step) : entry(id, step)));
  const shown = (ms) => { const h = at(R, ms); return flightOf(h) + ' ' + layoutOf(h); };
  move(R, 0, three(0, ['1', '456', '789']));
  at(R, SLOT0);
  const seen = [];
  move(R, 1, three(1, ['1', '456', '789']));
  seen.push(shown(SLOT0 + 1000));
  move(R, 2, three(2, ['1', '456', '789']));
  seen.push(shown(SLOT0 + TURN + 1000));
  move(R, 3, three(3, ['1', '456', '789']));
  seen.push(shown(SLOT0 + 2 * TURN + 1000));
  move(R, 4, three(4, ['1', '456']));
  seen.push(shown(SLOT0 + 3 * TURN + 1000));
  assert.deepEqual(seen, ['1 map', '456 map', '789 map', '1 detail'], '789 left: the round ends, the next flight is in detail');
}

// A flight that leaves within its own turn: 789 was last on the map, flight 1 takes its place in that turn, and the round
// ends there too, so flight 1 starts the details (no fourth map turn).
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  const three = (step) => [entry('1', step), f456(step), entry('789', step)];
  move(R, 0, three(0));
  at(R, SLOT0);
  move(R, 1, three(1));
  assert.equal(layoutOf(at(R, SLOT0 + 1000)), 'map', 'turn 0: flight 1 on the map');
  move(R, 2, three(2));
  assert.equal(layoutOf(at(R, SLOT0 + TURN + 1000)), 'map', 'turn 1: flight 456 on the map');
  move(R, 3, three(3));
  assert.equal(flightOf(at(R, SLOT0 + 2 * TURN + 1000)), '789', 'turn 2: flight 789 on the map');
  move(R, 4, [entry('1', 4), f456(4)]);
  const leftInTurn = at(R, SLOT0 + 2 * TURN + 2000);
  assert.equal(flightOf(leftInTurn), '1', 'same turn: 789 left, flight 1 takes its place');
  assert.equal(layoutOf(leftInTurn), 'detail', 'the round ended at the end of the list: the details start');
  move(R, 5, [entry('1', 5), f456(5)]);
  assert.equal(layoutOf(at(R, SLOT0 + 3 * TURN + 1000)), 'detail', 'turn 3: flight 456 in detail');
  move(R, 6, [entry('1', 6), f456(6)]);
  assert.equal(layoutOf(at(R, SLOT0 + 4 * TURN + 1000)), 'map', 'turn 4: the next round starts on the map');
}

// A flight that comes in mid-round joins the round in its place: no early flip.
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  move(R, 0);
  at(R, SLOT0);
  move(R, 1);
  assert.match(at(R, SLOT0 + 1000), /cs-fl-map/, 'turn 0: flight 1 on the map');
  move(R, 2, [entry('1', 2), f456(2), entry('789', 2)]);
  const h1 = at(R, SLOT0 + TURN + 1000);
  assert.equal(flightOf(h1), '456', 'turn 1: flight 456');
  assert.match(h1, /cs-fl-map/, 'still the map: 789 joined the round');
  move(R, 3, [entry('1', 3), f456(3), entry('789', 3)]);
  const h2 = at(R, SLOT0 + 2 * TURN + 1000);
  assert.equal(flightOf(h2), '789', 'turn 2: flight 789');
  assert.match(h2, /cs-fl-map/, 'still the map');
  move(R, 4, [entry('1', 4), f456(4), entry('789', 4)]);
  const h3 = at(R, SLOT0 + 3 * TURN + 1000);
  assert.equal(flightOf(h3), '1', 'turn 3: the round wraps to flight 1');
  assert.match(h3, /cs-fl-rows/, 'and the round has ended: the details');
}

// No flight: the sky, every turn. When one comes back, it shows at its next turn with no empty turn in between.
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  move(R, 0, [entry('1', 0)]);
  at(R, SLOT0);
  for (let i = 1; i <= 2; i++) {
    move(R, i, []);
    assert.equal(kindOf(at(R, SLOT0 + i * TURN + 1000)), 'himmel', 'turn ' + i + ': no flight, the sky');
  }
  move(R, 3, [entry('1', 3)]); // first sight is a baseline
  assert.equal(kindOf(at(R, SLOT0 + 3 * TURN + 1000)), 'himmel', 'the returning flight is a baseline first');
  move(R, 4, [entry('1', 4)]);
  assert.equal(flightOf(at(R, SLOT0 + 3 * TURN + 2000)), '1', 'then it shows, in the same turn');
}

// A flight lands during its turn: the next flight in the order takes the rest of the turn (no blank), and the turn after
// that moves on from it.
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  const three = (step) => [entry('1', step), f456(step), entry('789', step)];
  move(R, 0, three(0));
  at(R, SLOT0); // the first sight is a baseline
  move(R, 1, three(1));
  assert.equal(flightOf(at(R, SLOT0 + 1000)), '1', 'turn 0: flight 1');
  move(R, 2, three(2));
  assert.equal(flightOf(at(R, SLOT0 + TURN + 1000)), '456', 'turn 1: flight 456');
  move(R, 3, [entry('1', 3), entry('789', 3)]); // 456 lands, mid-turn
  const landed = at(R, SLOT0 + TURN + 2000);
  assert.equal(flightOf(landed), '789', 'the next flight takes the rest of the turn');
  assert.match(landed, /cs-fl-map/, 'and it is drawn, not a blank');
  move(R, 4, [entry('1', 4), entry('789', 4)]);
  assert.equal(flightOf(at(R, SLOT0 + 2 * TURN + 1000)), '1', 'the next turn wraps round from 789');
}

// The list changes between turns (landings, new flights): every turn shows a flight that qualifies now, and never the same
// flight twice in a row while another flight is there. A new flight first shows once it has moved (its baseline first).
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  const lists = [['1', '456'], ['1', '456', '789'], ['456', '789'], ['0', '456', '789'], ['0', '789'], ['789'], ['456', '789'],
    ['0', '1', '456', '789'], ['1', '456', '789']];
  const shownAll = new Set();
  let prev = null;
  move(R, 0, lists[0].map((id) => entry(id, 0)));
  at(R, SLOT0);
  lists.forEach((ids, i) => {
    move(R, 1 + i, ids.map((id) => entry(id, 1 + i)));
    const now = SLOT0 + i * TURN + 1000;
    const h = at(R, now);
    const qual = R.S.flightRows(R.hass, R.vars, new Date(now)).map((r) => r.key);
    if (!qual.length) { assert.equal(kindOf(h), 'himmel', 'turn ' + i + ': nothing qualifies, the sky'); prev = null; return; }
    const shown = flightOf(h);
    assert.ok(qual.includes(shown), 'turn ' + i + ': the flight on show qualifies now');
    if (qual.length > 1 && prev !== null) assert.notEqual(shown, prev, 'turn ' + i + ': not the same flight twice in a row');
    shownAll.add(shown);
    prev = shown;
  });
  assert.ok(shownAll.size >= 3, 'over the changes, several flights are shown: ' + [...shownAll]);
}

// Each start of the saver moves on to the next flight; a preview (Studio) reads the choice without moving the saver on.
{
  const R = runtime();
  R.vars = { kind: 'flights' };
  move(R, 0);
  at(R, SLOT0);
  move(R, 1);
  assert.equal(flightOf(at(R, SLOT0 + 1000)), '1', 'the first flight on the first turn');
  const sample = { host: { innerHTML: '', getRootNode: () => R.host.getRootNode() } };
  sample.api = R.S.mount(sample.host, null, { sample: true, every: 3600000, kind: () => 'flights',
    context: () => ({ hass: R.hass, vars: R.vars, now: new Date(SLOT0 + TURN + 1000) }) });
  assert.equal(flightOf(sample.host.innerHTML), '456', 'the preview shows the flight the next turn would');
  assert.equal(flightOf(at(R, SLOT0 + TURN + 2000)), '456', 'the saver itself is still on its first flight, so it moves on now');
  move(R, 2);
  const h = at(R, SLOT0 + 2 * TURN + 1000);
  assert.equal(flightOf(h), '1', 'and the turn after wraps round');
  sample.api.destroy();
  const second = { innerHTML: '', getRootNode: () => R.host.getRootNode() };
  R.S.mount(second, null, { every: 3600000, kind: () => 'flights', context: () => ({ hass: R.hass, vars: R.vars, now: new Date(SLOT0 + 2 * TURN + 2000) }) });
  assert.equal(flightOf(second.innerHTML), '456', 'the next time the saver starts, it shows the next flight');
}

// A routine position update keeps the flight and its layout within its turn.
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
  assert.equal(flightOf(later), '456', 'the next turn: the next flight');
  assert.match(later, /cs-fl-map/, 'and on the map');
}

// Removal is immediate; the other flight takes the turn, and with none left the native sky.
{
  const R = runtime();
  warm(R);
  move(R, 1);
  assert.equal(flightOf(at(R, SLOT0 + 1000)), '1');
  move(R, 2, [f456(2)]);
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

// The drawn route picture is local: no link, no image, no map tiles (the map element that the map layout may add on top has its
// own test, screensaver_flights_map.mjs: the saver's HTML around it stays free of images, links and URLs). A route over the dateline
// stays a small picture.
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
  assert.match(h, /<polyline class="cs-fl-route"[^>]*vector-effect="non-scaling-stroke"/, 'the route outline does not grow with map scale');
  assert.match(h, /<circle class="cs-fl-ap"[^>]*vector-effect="non-scaling-stroke"/, 'airport outlines do not cover the picture');
}

// The Remaining route: exactly one dashed line on the map, from the aircraft to the destination. The old straight line from
// the origin airport to the destination is gone; the origin dot stays.
{
  const mapOf = (o) => {
    const R = runtime();
    warm(R);
    const f = (step) => [entry('1', step, o)];
    move(R, 1, f(1));
    at(R, SLOT0 + 1000);
    move(R, 2, f(2));
    return at(R, SLOT0 + 2000);
  };
  const nums = (s) => s.trim().split(/\s+/).map((p) => p.split(',').map(Number));
  const picture = (h) => {
    const [W, H] = h.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
    const mk = h.match(/<div class="cs-fl-mk"[^>]*style="[^"]*left:([\d.]+)%;top:([\d.]+)%/);
    const dots = [...h.matchAll(/<circle class="cs-fl-ap"[^>]*cx="([\d.-]+)" cy="([\d.-]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const routes = [...h.matchAll(/<[a-z]+ class="cs-fl-route"[^>]*>/g)].map((m) => m[0]);
    const trails = [...h.matchAll(/<polyline class="cs-fl-trail"[^>]*points="([^"]+)"/g)].map((m) => nums(m[1]));
    return { aircraft: [Number(mk[1]) / 100 * W, Number(mk[2]) / 100 * H], dots, routes, trails, lines: (h.match(/<line\b/g) || []).length };
  };
  const near = (a, b, label) => assert.ok(Math.abs(a[0] - b[0]) < 0.02 && Math.abs(a[1] - b[1]) < 0.02, label + ': ' + a + ' vs ' + b);
  const long = { latitude: 55, longitude: -30, airport_origin_latitude: 52.3, airport_origin_longitude: 4.8,
    airport_destination_latitude: 40.6, airport_destination_longitude: -73.8, coordinates: [[53.5, -12], [54.5, -22]] };
  for (const [label, o] of [['short flight', {}], ['long flight, trail far from the origin', long]]) {
    const h = mapOf(o), p = picture(h);
    assert.equal(p.routes.length, 1, label + ': exactly one dashed line');
    assert.match(p.routes[0], /^<polyline /, label + ': the Remaining route is a path, not the straight origin-to-destination line');
    assert.equal(p.lines, 0, label + ': no straight line element is left');
    assert.match(p.routes[0], /stroke-dasharray:[\d.]+cqmin [\d.]+cqmin/, label + ': the Remaining route is dashed');
    assert.match(p.routes[0], /stroke-width:[\d.]+cqmin/, label + ': and has a width from the shared style');
    const pts = nums(p.routes[0].match(/points="([^"]+)"/)[1]);
    near(pts[0], p.aircraft, label + ': the dashed line starts at the aircraft');
    near(pts[pts.length - 1], p.dots[1], label + ': and ends at the destination dot');
    assert.equal(p.dots.length, 2, label + ': origin and destination dots show');
    // The dashed line never touches the origin dot (the old line started there).
    pts.forEach((q) => assert.ok(Math.hypot(q[0] - p.dots[0][0], q[1] - p.dots[0][1]) > 0.02, label + ': the dashed line does not reach the origin dot'));
  }
  {
    const p = picture(mapOf({ airport_destination_latitude: null, airport_destination_longitude: null }));
    assert.equal(p.routes.length, 0, 'no destination: no dashed line');
    assert.equal(p.lines, 0, 'no destination: no line from the origin either');
    assert.equal(p.dots.length, 1, 'the origin dot still shows');
  }
  {
    const p = picture(mapOf({ airport_origin_latitude: null, airport_origin_longitude: null }));
    assert.equal(p.routes.length, 1, 'no origin: the Remaining route still shows');
  }
}

// The Unreported part: a fainter line from the departure airport to the oldest trail point, under the Flown trail. It comes
// from the same function as the popup map (F.unreportedOf); nothing without an origin or without a trail point.
{
  const unrep = (h) => (h.match(/<polyline class="cs-fl-unrep"[^>]*points="([^"]*)"/) || [])[1];
  const run = (o) => {
    const R = runtime();
    warm(R);
    const fl = (step) => [entry('1', step, { coordinates: [[48, 6], [49, 7]], ...o })];
    move(R, 1, fl(1));
    at(R, SLOT0 + 1000);
    move(R, 2, fl(2));
    return { R, h: at(R, SLOT0 + 2000) };
  };
  const { R, h } = run({});
  const pts = unrep(h);
  assert.ok(pts, 'the unreported part is drawn');
  assert.ok(pts.split(' ').length >= 8, 'a curve of at least 8 points (the shared great circle)');
  assert.ok(h.indexOf('class="cs-fl-unrep"') < h.indexOf('class="cs-fl-trail"'), 'drawn under the Flown trail');
  assert.equal((h.match(/class="cs-fl-trail"[^>]*points="([^"]*)"/) || [])[1].split(' ').length, 2, 'the Flown trail is unchanged');
  assert.ok(SAVER_SRC.includes('.cs-sv .cs-fl-unrep{stroke:rgba(246,239,230,.45);'), 'fainter: off-white at 45 %');
  const real = R.F.unreportedOf;
  let calls = 0;
  R.F.unreportedOf = (x) => { calls += 1; return real(x); };
  at(R, SLOT0 + 3000);
  assert.ok(calls > 0, 'the saver uses the shared function');
  R.F.unreportedOf = real;
  // The picture box holds the arc too, where it bows north of every other point (origin 60N 0E, oldest point 60N 40E).
  const bow = { origin: [60, 0], trail: [[60, 40]], cur: [60, 20], destination: [50, 60] };
  const fr = runtime().S.routeFrame(bow);
  const inside = real(bow).every((p) => fr.X(p) >= 0 && fr.X(p) <= fr.W && fr.Y(p) >= 0 && fr.Y(p) <= fr.H);
  assert.ok(inside, 'the arc is inside the picture box');
  // A long flight whose trail starts far from the origin, next to the Remaining route: the arc runs from the origin dot to the
  // first trail point, and the dashed Remaining route still starts at the aircraft (the three lines do not replace each other).
  {
    const long = { latitude: 55, longitude: -30, airport_origin_latitude: 52.3, airport_origin_longitude: 4.8,
      airport_destination_latitude: 40.6, airport_destination_longitude: -73.8, coordinates: [[53.5, -12], [54.5, -22]] };
    const { h: hl } = run(long);
    const nums = (t) => t.trim().split(/\s+/).map((q) => q.split(',').map(Number));
    const arcPts = nums(unrep(hl)), trailPts = nums(hl.match(/<polyline class="cs-fl-trail"[^>]*points="([^"]+)"/)[1]);
    const dot = [...hl.matchAll(/<circle class="cs-fl-ap"[^>]*cx="([\d.-]+)" cy="([\d.-]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const close = (a, b, label) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.02, label + ': ' + a + ' vs ' + b);
    close(arcPts[0], dot[0], 'the arc starts at the origin dot');
    close(arcPts[arcPts.length - 1], trailPts[0], 'and ends at the first (oldest) trail point');
    assert.equal((hl.match(/class="cs-fl-route"/g) || []).length, 1, 'the one dashed Remaining route is still drawn');
    assert.ok(hl.indexOf('class="cs-fl-unrep"') < hl.indexOf('class="cs-fl-trail"'), 'the arc lies under the Flown trail');
  }
  assert.equal(unrep(run({ airport_origin_latitude: null, airport_origin_longitude: null }).h), undefined, 'no origin: nothing drawn');
  assert.equal(unrep(run({ coordinates: [] }).h), undefined, 'no trail: nothing drawn');
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
