// @deckt: custom_components/casora/scripts/local/46-screensaver.js#kindAt,pool,has,offered,context,html,sample,mount,vars,flightPick,flightColumnHtml,arrivalHtml custom_components/casora/scripts/local/49-flights.js#estimateOf,timeRows,timeHtml,pairs,moment
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
  const R = { box, S: box._casoraSaver, F: box._casoraFlights, conn, timers, clock: { t: SLOT0 + 1000 }, vars: {}, step: 0 };
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
const layoutOf = (html) => (/cs-meta/.test(html) ? 'map' : /cs-fl-rows/.test(html) ? 'detail' : '?');
// „mix“ with Flights and wort: Flights takes every other turn, and its map and details alternate between those turns.
// Returns the first Flights screen in the details layout (flightsOf(step) gives the flights of each step, each a movement).
const mixDetail = (flightsOf, loc) => {
  const R = runtime();
  if (loc) R.box.casoraLocale = () => loc;
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
  assert.match(second, /cs-meta/, 'and keeps the layout of the round: the map, mid-round');
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
  assert.match(sample.host.innerHTML, /cs-meta/, 'the preview stays on the map');
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
  assert.match(at(R, SLOT0 + 1000), /cs-meta/, 'turn 0: flight 1 on the map');
  move(R, 2, [entry('1', 2), f456(2), entry('789', 2)]);
  const h1 = at(R, SLOT0 + TURN + 1000);
  assert.equal(flightOf(h1), '456', 'turn 1: flight 456');
  assert.match(h1, /cs-meta/, 'still the map: 789 joined the round');
  move(R, 3, [entry('1', 3), f456(3), entry('789', 3)]);
  const h2 = at(R, SLOT0 + 2 * TURN + 1000);
  assert.equal(flightOf(h2), '789', 'turn 2: flight 789');
  assert.match(h2, /cs-meta/, 'still the map');
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
  assert.match(landed, /cs-meta/, 'and it is drawn, not a blank');
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
  assert.match(again, /cs-meta/, 'and its layout');
  const later = at(R, SLOT0 + TURN + 1000);
  assert.equal(flightOf(later), '456', 'the next turn: the next flight');
  assert.match(later, /cs-meta/, 'and on the map');
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
  assert.match(map, /<span>\d+(?:\u202f| )?%<\/span>/); assert.match(map, /<div class="cs-cap">Voraussichtliche Ankunft<\/div>/);
  const { html: detail } = mixDetail((s) => [entry('1', s)]); // the details come in the mix, on Flights' own turns
  assert.match(detail, /cs-fl-rows/);
  assert.match(detail, /Example Air/); assert.match(detail, /AB-CDE/); assert.match(detail, /XYZ1/); assert.match(detail, /90°/);
  assert.match(detail, /<div class="cs-fl-lbl">Kurs über Grund<\/div><div class="cs-fl-val">90°<\/div>/); // the heading value is the ground track, labelled so
  assert.match(detail, /-500\u00a0ft\/min/); assert.match(detail, /Airport A/); assert.match(detail, /Airport B/); assert.match(detail, /T1/);
  assert.match(detail, /<div class="cs-fl-lbl">Voraussichtliche Ankunft<\/div><div class="cs-fl-val">/); // a timing row's label names side and kind
  assert.match(detail, /<div class="cs-fl-lbl">Geplante Ankunft<\/div><div class="cs-fl-val">/); // scheduled and estimated arrival stay two rows
  assert.match(detail.replace(/<span class="cs-fl-nw">([^<]*)<\/span>/g, '$1'), /<div class="cs-fl-lbl">Voraussichtliche Ankunft<\/div><div class="cs-fl-val">[^<]*<div class="cs-fl-arrsub">[^<]*Amsterdam<\/div><\/div>/); assert.doesNotMatch(detail, /Zeit am Zielort|Ortszeit/); // two times: the home city names the second
}
// The saver's timing rows (49-flights.js timeRows) label side and kind and show the time(s) only; the popup keeps its plates.
{
  const dep = { time_scheduled_departure: SLOT0 / 1000 - 1800, time_real_departure: SLOT0 / 1000 - 1700 };
  const cases = [
    ['all airport times', dep],
    ['no airport zone: local times only', { ...dep, airport_origin_timezone_offset: undefined, airport_destination_timezone_offset: undefined }],
  ];
  cases.forEach(([label, o]) => {
    const { html: h, R } = mixDetail((s) => [entry('1', s, o)]);
    assert.match(h, /cs-fl-rows/, label);
    const want = R.F.timeRows(R.hass, entry('1', 1, o), false, R.clock.t);
    assert.ok(want.some(([l]) => l === 'Geplanter Abflug') && want.some(([l]) => l === 'Geplante Ankunft'), label + ': departure and arrival rows');
    want.forEach(([l, [air, home]]) => assert.ok(h.replace(/<span class="cs-fl-nw">([^<]*)<\/span>/g, '$1').includes('<div class="cs-fl-lbl">' + l + '</div><div class="cs-fl-val">' + air + (home ? '<div class="cs-fl-arrsub">' + home + '</div>' : '') + '</div></div>'), label + ': the row ' + l + ': ' + air + ' / ' + home));
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

// ── Time labels: the detail rows name side and kind, the map layout's arrival is a caption block ───────────────────────
// Expected texts are literal. House zone Europe/Amsterdam (UTC+1 in November), locale en-US (12-hour clock).
{
  const U = (d, h, m) => Date.UTC(2026, 10, d, h, m) / 1000;
  const NBSP = ' ';
  // Same offset: the destination is on the house's clock, so every time is one bare clock.
  const same = { airport_destination_timezone_offset: 3600, airport_destination_city: 'Amsterdam', time_scheduled_departure: U(18, 7, 15),
    time_real_departure: U(18, 8, 29), time_scheduled_arrival: U(18, 16, 35), time_estimated_arrival: U(18, 17, 3) };
  // Different offset: Paramaribo (UTC-3) against the house.
  const diff = { ...same, airport_destination_timezone_offset: -10800, airport_destination_timezone_abbr: 'SRT', airport_destination_city: 'Paramaribo' };
  const plain = (h) => h.replace(/<span class="cs-fl-nw">([^<]*)<\/span>/g, '$1');
  // A row's value as text: the home time's line element becomes a line break.
  const flat = (h) => plain(h).replace(/<div class="cs-fl-arrsub">([^<]*)<\/div>/g, '\n$1');
  const rowsOf = (html) => [...flat(html).matchAll(/<div class="cs-fl-row"><div class="cs-fl-lbl">([^<]*)<\/div><div class="cs-fl-val">([^<]*)<\/div><\/div>/g)].map((m) => [m[1], m[2]]);
  const timeRowsOf = (o) => rowsOf(mixDetail((s) => [entry('1', s, o)]).html)
    .filter(([l]) => /^(Geplanter|Tatsächlicher|Geplante|Voraussichtliche) (Abflug|Ankunft)$/.test(l));
  assert.deepEqual(timeRowsOf(same), [
    ['Geplanter Abflug', '08:15' + NBSP + 'AM'], ['Tatsächlicher Abflug', '09:29' + NBSP + 'AM'],
    ['Geplante Ankunft', '05:35' + NBSP + 'PM'], ['Voraussichtliche Ankunft', '06:03' + NBSP + 'PM'],
  ], 'detail layout, one time per row: the label names side and kind, the value is the bare clock');
  assert.deepEqual(timeRowsOf(diff), [
    ['Geplanter Abflug', '08:15' + NBSP + 'AM'], ['Tatsächlicher Abflug', '09:29' + NBSP + 'AM'],
    ['Geplante Ankunft', '01:35' + NBSP + 'PM' + NBSP + 'Paramaribo' + '\n05:35' + NBSP + 'PM' + NBSP + 'Amsterdam'],
    ['Voraussichtliche Ankunft', '02:03' + NBSP + 'PM' + NBSP + 'Paramaribo' + '\n06:03' + NBSP + 'PM' + NBSP + 'Amsterdam'],
  ], 'detail layout, two times: the home time on its own line, no separator, both carry their city');

  // Map layout: the arrival block.
  const mapOf = (o, loc) => { const R = runtime(); if (loc) R.box.casoraLocale = () => loc; warm(R); move(R, 1, [entry('1', 1, o)]); at(R, SLOT0 + 1000); return at(R, SLOT0 + 2000); };
  const block = (html) => (flat(html).match(/<div class="cs-fl-arr">[\s\S]*?<\/div><\/div>/) || [''])[0];
  const rawBlock = (html) => (html.match(/<div class="cs-fl-arr">.*?<\/div><\/div><\/div>/) || [''])[0];
  assert.equal(block(mapOf(same)),
    '<div class="cs-fl-arr"><div class="cs-cap">Voraussichtliche Ankunft</div><div class="cs-fl-arrval">06:03' + NBSP + 'PM</div></div>',
    'map layout, one time: caption, one bare clock, no colon, no city, no zone word');
  assert.equal(block(mapOf(diff)),
    '<div class="cs-fl-arr"><div class="cs-cap">Voraussichtliche Ankunft</div><div class="cs-fl-arrval">02:03' + NBSP + 'PM' + NBSP + 'Paramaribo'
    + '\n06:03' + NBSP + 'PM' + NBSP + 'Amsterdam</div></div>',
    'map layout, two times: airport time with its city, the home time with its city under it');
  assert.equal(block(mapOf({ ...diff, time_estimated_arrival: U(19, 17, 3) })),
    '<div class="cs-fl-arr"><div class="cs-cap">Voraussichtliche Ankunft' + NBSP + '·' + NBSP + 'Thu,' + NBSP + 'Nov' + NBSP + '19</div><div class="cs-fl-arrval">02:03' + NBSP + 'PM' + NBSP + 'Paramaribo'
    + '\n06:03' + NBSP + 'PM' + NBSP + 'Amsterdam</div></div>',
    'map layout, arrival not today (now is Nov 18): the date joins the caption, the lines carry no date');
  // Line breaks (the list row's rule): a time, its city and its date never break inside. The saver wraps each time in an
  // unbreakable span; with two times the home time is its own line.
  // A Dutch date has hyphens ("18-11"), at which a browser would otherwise break.
  {
    const part = '<span class="cs-fl-nw">[^<]+<\\/span>';
    const two = { ...diff, time_scheduled_arrival: U(18, 17, 40), time_estimated_arrival: U(18, 17, 3) };
    const { html: dnl } = mixDetail((s) => [entry('1', s, two)], 'nl-NL');
    const raw = [...dnl.matchAll(/<div class="cs-fl-lbl">Geplante Ankunft<\/div><div class="cs-fl-val">(.*?<\/span>(?:<div class="cs-fl-arrsub">.*?<\/span><\/div>)?)<\/div><\/div>/g)].map((m) => m[1]);
    assert.equal(raw.length, 1, 'one planned-arrival row');
    assert.match(raw[0], new RegExp('^' + part + '<div class="cs-fl-arrsub">' + part + '</div>$'), 'detail row: the home time in its own line element, each line one unbreakable span');
    assert.doesNotMatch(raw[0], /\u00b7/, 'detail row: no separator between the two times');
    const nl = mapOf(two, 'nl-NL');
    assert.match(rawBlock(nl), new RegExp('<div class="cs-fl-arrval">' + part + '<div class="cs-fl-arrsub">' + part + '</div></div>'),
      'map arrival lines: each one unbreakable');
    assert.match(SAVER_SRC, /\.cs-fl-nw\{white-space:nowrap;\}/, 'the stylesheet: a part does not wrap');
  }
  // Dutch: the caption date is short weekday, day, short month (head date style). It pins behaviour; it was not red first.
  const nl = mapOf({ ...same, time_estimated_arrival: U(28, 17, 3) }, 'nl-NL');
  assert.match(block(nl), /Voraussichtliche Ankunft\u00a0·\u00a0za\u00a028\u00a0nov<\/div>/, 'Dutch: the date reads za 28 nov');
}

// ── Time labels, review fixes: the head date style in the rows, one source for the arrival, one row helper ─────────────
{
  const U = (d, h, m) => Date.UTC(2026, 10, d, h, m) / 1000;
  const NBSP = ' ';
  const diff = { airport_destination_timezone_offset: -10800, airport_destination_timezone_abbr: 'SRT', airport_destination_city: 'Paramaribo',
    time_scheduled_departure: U(18, 7, 15), time_scheduled_arrival: U(28, 17, 40), time_estimated_arrival: U(28, 17, 3) };
  const plain = (h) => h.replace(/<span class="cs-fl-nw">([^<]*)<\/span>/g, '$1');
  const flat = (h) => plain(h).replace(/<div class="cs-fl-arrsub">([^<]*)<\/div>/g, '\n$1');
  const valueOf = (html, label) => { const m = flat(html).match(new RegExp('<div class="cs-fl-lbl">' + label + '</div><div class="cs-fl-val">([^<]*)</div>')); return m && m[1]; };
  const mapOf = (o, loc) => { const R = runtime(); if (loc) R.box.casoraLocale = () => loc; warm(R); move(R, 1, [entry('1', 1, o)]); at(R, SLOT0 + 1000); return { html: at(R, SLOT0 + 2000), R }; };
  // The side's date stands before the time (rows have no place line); no "19-11" form; the home line has no date of its own.
  const nl = mixDetail((s) => [entry('1', s, diff)], 'nl-NL').html;
  assert.equal(valueOf(nl, 'Voraussichtliche Ankunft'), 'za' + NBSP + '28' + NBSP + 'nov' + NBSP + '14:03' + NBSP + 'Paramaribo\n18:03' + NBSP + 'Amsterdam', 'Dutch: date, time, city; the home time under it');
  assert.equal(valueOf(nl, 'Geplante Ankunft'), 'za' + NBSP + '28' + NBSP + 'nov' + NBSP + '14:40' + NBSP + 'Paramaribo\n18:40' + NBSP + 'Amsterdam', 'Dutch: the planned arrival too');
  assert.equal(valueOf(nl, 'Geplanter Abflug'), '08:15', 'a departure that is today at home has no date');
  const en = mixDetail((s) => [entry('1', s, diff)]).html;
  assert.equal(valueOf(en, 'Voraussichtliche Ankunft'), 'Sat,' + NBSP + 'Nov' + NBSP + '28' + NBSP + '02:03' + NBSP + 'PM' + NBSP + 'Paramaribo\n06:03' + NBSP + 'PM' + NBSP + 'Amsterdam', 'English: the same shape');
  // The arrival block comes from F.estimateOf: the same date, air and home, and the date is not hidden near midnight.
  const m1 = mapOf({ ...diff, time_estimated_arrival: U(18, 17, 3) });
  assert.equal(typeof m1.R.F.estimateOf, 'function', 'F.estimateOf is public');
  const midnight = { ...diff, time_estimated_arrival: U(19, 2, 30) }; // 23:30 in Paramaribo on Nov 18 (today), 03:30 on Nov 19 at home
  const mm = mapOf(midnight);
  const est = mm.R.F.estimateOf(mm.R.hass, midnight, SLOT0 + 2000);
  assert.equal(est.date, '', 'the arrival is today at the airport: no caption date');
  assert.match(plain(mm.html), new RegExp('<div class="cs-fl-arrsub">03:30' + NBSP + 'AM' + NBSP + 'Thu,' + NBSP + 'Nov' + NBSP + '19' + NBSP + 'Amsterdam</div>'), 'the home line keeps its own date');
  // The caption separator is the protected-space form: no line starts with the dot.
  const far = mapOf({ ...diff, time_estimated_arrival: U(19, 17, 3) });
  assert.match(far.html, new RegExp('Voraussichtliche Ankunft' + NBSP + '·' + NBSP + 'Thu,' + NBSP + 'Nov' + NBSP + '19</div>'), 'caption: the dot has a protected space on both sides, so no line starts or ends with it');
  // The label is dimmed, the value is not: no descendant selector reaches the spans inside a value.
  assert.doesNotMatch(SAVER_SRC, /\.cs-fl-row span\{/, 'no descendant selector on the row');
  // The row helper is shared with the popup.
  assert.equal(typeof far.R.F.pairs, 'function', 'F.pairs is the shared row helper');
  // Text from the data is escaped once, in the label rows and in a time (the allow-list relies on it).
  const evil = far.R.F.pairs([['Rufzeichen', '<b>X&Y</b>'], ['Ankunft', ['<i>a</i>', 'R&D <u>']]], true);
  assert.ok(!/<b>|<i>|<u>/.test(evil), 'no markup from a value gets through');
  assert.ok(evil.includes('&lt;b&gt;X&amp;Y&lt;/b&gt;') && evil.includes('R&amp;D &lt;u&gt;'), 'escaped once, not twice');
}

console.log('ok screensaver_flights');
