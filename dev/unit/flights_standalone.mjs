// @deckt: custom_components/casora/scripts/local/49-flights.js#submit,addView,stop,stopView,airborne,liveHtml,liveHidden,sources,resolve,controls,flight,details,mapView,progressOf
// @deckt: custom_components/casora/scripts/local/46-screensaver.js#has,flightRows,html,context,offered,mount
// The standalone suite: Home Assistant, Casora and FlightRadar24 only, no household automation, calendar, template, helper or
// script in the house. Configure, Add, scheduled and connecting, observed airborne movement, the tile, the details, the map and
// the screensaver showing the same flight, Stop tracking with list-confirmed outcomes. Then the edge cases over the same
// boundary: stale coordinates, reconnection, landing, replaced and reused IDs, several instances, a missing pinned source,
// failed and unconfirmed commands, and an independent external actor changing the tracked list. Controlled clock; synthetic
// entries; no browser, no Test HA, no real FlightRadar24 or notification service.
//   node dev/unit/flights_standalone.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const FLIGHTS_SRC = read('custom_components/casora/scripts/local/49-flights.js');
const SAVER_SRC = read('custom_components/casora/scripts/local/46-screensaver.js');
const TURN = 300000, MOVE_WINDOW = 600000;
// The clock's anchor: an even five-minute slot. The Flights kind alone has no turn; its first flight is on show.
const SLOT0 = Math.floor(Date.UTC(2026, 10, 18, 12, 0, 0) / (2 * TURN)) * 2 * TURN;
const T0 = SLOT0 + 1000;
const SRC = 'sensor.fr24_tracked';
const SRC_B = 'sensor.fr24_second';
const flush = () => new Promise((r) => setImmediate(r));
const plain = (x) => JSON.parse(JSON.stringify(x)); // the module runs in its own realm: copy before deepStrictEqual

// A fresh runtime per case: the movement evidence lives in the module, so no case may see another's.
const runtime = () => {
  const handlers = {};
  const conn = { addEventListener: (t, fn) => { (handlers[t] || (handlers[t] = [])).push(fn); }, fire: (t) => (handlers[t] || []).forEach((fn) => fn()) };
  const waits = [], ticks = [];
  const box = {
    console, Intl, Date, Math, parseFloat, isFinite, isNaN, parseInt, String, Number, JSON, Array, Object, Promise, Set, Map, Error, RegExp,
    setTimeout: (fn, ms) => { const w = { fn, ms, live: true }; waits.push(w); return w; },
    clearTimeout: (w) => { if (w) w.live = false; },
    setInterval: (fn, ms) => { ticks.push({ fn, ms, live: true }); return ticks.length; },
    clearInterval: (id) => { if (ticks[id - 1]) ticks[id - 1].live = false; },
    location: { search: '', pathname: '/' }, addEventListener() {},
    localStorage: { getItem: () => null, setItem() {} }, HTMLElement: class {}, customElements: { get: () => undefined, define() {} },
  };
  box.window = box;
  box.document = { nodeType: 1, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} } };
  box.casoraLocale = () => 'en-US';
  box._casoraUI = { section: (k, b) => b,  empty: (o) => o.text, stage: (k, o) => o.text };
  vm.createContext(box);
  vm.runInContext(FLIGHTS_SRC, box);
  vm.runInContext(SAVER_SRC, box);
  const R = { box, S: box._casoraSaver, F: box._casoraFlights, conn, waits, ticks, clock: { t: T0 }, vars: {}, calls: [], reply: null };
  R.hass = {
    config: { time_zone: 'Europe/Amsterdam' }, locale: { time_format: '24' }, themes: { darkMode: true }, connection: conn,
    entities: {}, devices: {}, states: {}, calls: R.calls,
    callService: (domain, service, data, target) => { R.calls.push({ domain, service, data, target }); return R.reply ? R.reply() : Promise.resolve(); },
  };
  R.host = { innerHTML: '', getRootNode: () => box.document };
  R.api = R.S.mount(R.host, null, { every: 3600000, kind: () => R.vars.kind || 'flights',
    context: () => ({ hass: R.hass, vars: R.vars, now: new Date(R.clock.t) }) });
  return R;
};
// The module's bounded waits (add, stop, the hide wake-up) are fired by hand, never slept.
const fire = (R) => { const due = R.waits.filter((w) => w.live); R.waits.length = 0; due.forEach((w) => { w.live = false; w.fn(); }); };
const saver = (R) => { R.api.update(); return R.host.innerHTML; }; // the screensaver's own update at the controlled clock
const flightOf = (html) => (html.match(/XY(\d+)/) || [])[1];
const kindOf = (html) => (html.match(/data-kind="([a-z]+)"/) || [])[1];
// The tile is visible while a flight is in the air (its text is the state line); the flight values are on the list popup's rows.
const tile = (R) => (R.F.liveHtml(R.hass, '', R.clock.t) ? R.F.listRows(R.hass, { pin: '', now: R.clock.t }) : '');
const shown = (R) => plain(R.F.airborne(R.hass, '', R.clock.t).map((r) => r.key));

// ── Synthetic FlightRadar24 entries. Positions follow `step`: the same step again is no movement ─────────────────────
const entry = (id, step, o = {}) => ({
  id, flight_number: 'XY123', callsign: 'XYZ123', aircraft_registration: 'AB-CDE', tracked_type: 'live', on_ground: 0,
  latitude: 50.2 + 0.01 * step, longitude: 10.1 + 0.02 * step, altitude: 35000, ground_speed: 450, heading: 90, vertical_speed: -500,
  airline_short: 'Example Air', aircraft_model: 'Type 100',
  airport_origin_name: 'Airport A', airport_origin_latitude: 50, airport_origin_longitude: 4,
  airport_origin_timezone_offset: 3600, airport_origin_timezone_abbr: 'CET',
  airport_destination_name: 'Airport B', airport_destination_latitude: 52, airport_destination_longitude: 20,
  airport_destination_timezone_offset: 7200, airport_destination_timezone_abbr: 'EET',
  time_scheduled_arrival: T0 / 1000 + 5400, time_estimated_arrival: T0 / 1000 + 5000,
  coordinates: [[50, 4], [50.1, 5]], ...o,
});
// The integration's update: a new state object with the list. Positions that differ are movement when they are seen.
// The card redraws on every state change, so each update is read at its time (that read is when movement is seen).
const setList = (R, flights, id = SRC) => {
  R.hass.states[id] = { entity_id: id, state: String(flights.length), attributes: { flights } };
  R.F.liveHtml(R.hass, '', R.clock.t);
};

// One FlightRadar24 instance: its source and its own add, remove and scanning controls, all on one device.
const instance = (R, src, dev, prefix, flights = []) => {
  const ent = {
    [src]: { entity_id: src, platform: 'flightradar24', device_id: dev, translation_key: 'additional_tracked', entity_category: null },
    ['text.' + prefix + '_add']: { entity_id: 'text.' + prefix + '_add', platform: 'flightradar24', device_id: dev, translation_key: 'add_track', entity_category: 'config' },
    ['text.' + prefix + '_remove']: { entity_id: 'text.' + prefix + '_remove', platform: 'flightradar24', device_id: dev, translation_key: 'remove_track', entity_category: 'config' },
    ['switch.' + prefix + '_scanning']: { entity_id: 'switch.' + prefix + '_scanning', platform: 'flightradar24', device_id: dev, translation_key: 'scanning', entity_category: 'config' },
  };
  R.hass.devices = { ...R.hass.devices, [dev]: { name: 'Tracker ' + prefix } };
  R.hass.entities = { ...R.hass.entities, ...ent }; // a new object: the module's registry index is rebuilt
  ['text.' + prefix + '_add', 'text.' + prefix + '_remove', 'switch.' + prefix + '_scanning'].forEach((id) => { R.hass.states[id] = { entity_id: id, state: 'on', attributes: {} }; });
  setList(R, flights, src);
};
const dropInstance = (R, src, prefix) => {
  const ent = { ...R.hass.entities };
  [src, 'text.' + prefix + '_add', 'text.' + prefix + '_remove', 'switch.' + prefix + '_scanning'].forEach((id) => { delete ent[id]; delete R.hass.states[id]; });
  R.hass.entities = ent;
};
const standalone = (R) => instance(R, SRC, 'd1', 'fr24');
const ctl = (prefix) => ({ add: 'text.' + prefix + '_add', remove: 'text.' + prefix + '_remove' });
const setCall = (target, value) => ({ domain: 'text', service: 'set_value', data: { value }, target: { entity_id: target } });

// ── 1. Standalone baseline: only the FlightRadar24 contracts exist in the house ──────────────────────────────────────
{
  const R = runtime();
  standalone(R);
  assert.ok(Object.values(R.hass.entities).every((e) => e.platform === 'flightradar24'), 'every entity in this house is FlightRadar24\'s');
  assert.equal(Object.keys(R.hass.entities).length, 4, 'source, add, remove and scanning: nothing else');
  const r = R.F.resolve(R.hass, '');
  assert.equal(r.state, 'auto', 'exactly one source: selected by itself');
  assert.equal(r.id, SRC);
  const c = plain(R.F.controls(R.hass, SRC));
  assert.deepEqual([c.add, c.remove, c.scanning, c.missing, c.ambiguous], ['text.fr24_add', 'text.fr24_remove', 'switch.fr24_scanning', [], []],
    'the controls are found by their translation keys in the source\'s own device');
  assert.equal(tile(R), '', 'an empty list: no tile row');
  assert.equal(kindOf(saver(R)), 'himmel', 'an empty list: the screensaver shows the native sky, no flight');
  assert.equal(R.S.has('flights', { hass: R.hass, vars: {}, now: new Date(R.clock.t) }), false);
  assert.equal(R.calls.length, 0, 'configuring and rendering write nothing');
}

// ── 2. The journey: Add → scheduled → connecting → observed airborne movement → tile, details, map, screensaver → Stop ───
{
  const R = runtime();
  standalone(R);
  R.vars = { kind: 'flights' };
  // Add: one command, the identifier, to this instance's own add control.
  const a = R.F.submit(R.hass, SRC, ' xy123 ');
  assert.equal(a.state, 'pending', 'the Add button sends one command');
  assert.deepEqual(plain(R.calls), [setCall('text.fr24_add', 'XY123')], 'the identifier is normalised; it goes to this instance\'s add control');
  // FlightRadar24 takes it on: a scheduled stub first. Not airborne: no tile row, no screensaver flight.
  setList(R, [entry('f1', 0, { tracked_type: 'schedule', on_ground: 1 })]);
  assert.equal(R.F.addView(R.hass, SRC).state, 'confirmed', 'a new FlightRadar24 ID with the identifier confirms the addition');
  assert.equal(tile(R), '', 'scheduled: no tile row');
  assert.equal(R.S.has('flights', { hass: R.hass, vars: R.vars, now: new Date(R.clock.t) }), false, 'scheduled: not in the screensaver');
  // Connecting: on the ground at the gate, then airborne. The first airborne sighting is only a baseline.
  setList(R, [entry('f1', 1, { on_ground: 1 })]);
  setList(R, [entry('f1', 1)]);
  assert.equal(tile(R), '', 'first airborne sighting: withheld until it moves');
  assert.equal(R.S.has('flights', { hass: R.hass, vars: R.vars, now: new Date(R.clock.t) }), false, 'first sighting: not in the screensaver');
  // Observed movement: the tile, the details, the map and the screensaver show the same flight.
  R.clock.t += 60000;
  setList(R, [entry('f1', 2)]);
  const row = tile(R);
  assert.match(row, /XY123/, 'the tile shows the flight');
  const feet = (row.match(/(\d{1,3}(?:,\d{3})+ ft)/) || [])[1];
  assert.equal(feet, '35,000\u00a0ft', 'the tile shows altitude in the source unit (feet) by default');
  const eta = (row.match(/Voraussichtliche Ankunft ([^<]+)</) || [])[1];
  assert.ok(eta, 'the estimated arrival is on the tile');
  const f = R.F.flight(R.hass, SRC, 'f1', R.clock.t);
  assert.ok(f, 'the popup\'s check of the same flight passes');
  assert.equal(R.F.details(f.entry).model, 'Type 100', 'the details read the same entry');
  assert.ok(R.F.mapView(R.hass, SRC, 'f1', R.clock.t), 'the map has the flight\'s position');
  const sv = saver(R);
  assert.equal(kindOf(sv), 'flights', 'the screensaver shows the flight');
  assert.equal(flightOf(sv), '123', 'the same flight');
  assert.ok(sv.includes(feet), 'the screensaver shows the same altitude as the tile');
  assert.ok(sv.includes(eta), 'and the same estimated arrival time as the tile');
  // Stop tracking: one command with the row's identifier to this instance's remove control; the list confirms it.
  const s = R.F.stop(R.hass, SRC, 'f1');
  assert.equal(s.state, 'pending', 'Stop tracking sends one command for the selected row');
  assert.equal(R.calls[1] && R.calls[1].target.entity_id, 'text.fr24_remove', 'to this instance\'s remove control');
  assert.equal(R.calls[1].data.value, 'XY123', 'by the row\'s identifier');
  assert.equal(R.F.stopView(R.hass, SRC).state, 'pending', 'still listed: still pending');
  await new Promise((r) => setImmediate(r)); // the command has ended before the list is seen
  setList(R, []);
  assert.equal(R.F.stopView(R.hass, SRC).state, 'confirmed', 'the row is gone and no entry carries the identifier: confirmed');
  assert.equal(tile(R), '', 'the tile row is gone at once');
  const after = saver(R);
  assert.ok(!/XY123/.test(after), 'and the screensaver no longer shows it');
  assert.equal(R.calls.length, 2, 'exactly the two commands of the journey, and no others');
  assert.equal(R.ticks.filter((t) => t.live).length, 1, 'the screensaver\'s own update is the only timer; Flights has no timer of its own');
}

// ── 3. Stale coordinates: detail refreshes and entity updates with the same position do not renew the evidence ────────
{
  const R = runtime();
  standalone(R);
  setList(R, [entry('f1', 1)]);
  R.clock.t = T0 + 60000;
  setList(R, [entry('f1', 2)]);
  const movedAt = R.clock.t;
  for (let i = 1; i <= 9; i++) { // nine updates, one a minute: fresh detail timestamps, the same coordinates
    R.clock.t = movedAt + i * 60000;
    setList(R, [entry('f1', 2, { details_updated_at: R.clock.t, last_polled: R.clock.t })]);
  }
  assert.match(tile(R), /XY123/, 'nine minutes on: still shown, the detail updates did not renew it');
  R.clock.t = movedAt + MOVE_WINDOW - 1000;
  assert.match(tile(R), /XY123/, 'just inside the ten minutes');
  assert.equal(saver(R).includes('XY123'), true, 'the screensaver agrees');
  R.clock.t = movedAt + MOVE_WINDOW;
  assert.equal(tile(R), '', 'ten minutes after the last movement: hidden on the tile');
  assert.equal(R.F.liveHidden(R.hass, R.clock.t), true, 'and the rule says hidden');
  assert.ok(!/XY123/.test(saver(R)), 'and hidden in the screensaver');
}

// ── 4. Reconnection and browser reload start unverified; landing hides at once and a new takeoff starts unverified ────────
{
  const R = runtime();
  standalone(R);
  setList(R, [entry('f1', 1)]);
  R.clock.t += 60000; setList(R, [entry('f1', 2)]);
  assert.match(tile(R), /XY123/);
  R.conn.fire('disconnected');
  setList(R, [entry('f1', 2)]);
  assert.equal(tile(R), '', 'reconnected at the same position: withheld');
  R.clock.t += 60000; setList(R, [entry('f1', 3)]);
  assert.match(tile(R), /XY123/, 'once it moves again: shown');
  R.clock.t += 60000; setList(R, [entry('f1', 3, { on_ground: 1 })]);
  assert.equal(tile(R), '', 'landed: hidden at once');
  R.clock.t += 60000; setList(R, [entry('f1', 4)]);
  assert.equal(tile(R), '', 'a new takeoff is a baseline again');
  R.clock.t += 60000; setList(R, [entry('f1', 5)]);
  assert.match(tile(R), /XY123/);
}

// ── 5. Replaced FR24 IDs, reused numbers, removal and re-addition: no inherited freshness ──────────────────────────────
{
  const R = runtime();
  standalone(R);
  setList(R, [entry('f1', 1)]);
  R.clock.t += 60000; setList(R, [entry('f1', 2)]);
  assert.deepEqual(shown(R), ['f1']);
  // The same flight number under a replacement FR24 ID: a different lifecycle, so the new ID is withheld.
  R.clock.t += 60000; setList(R, [entry('f9', 3)]);
  assert.deepEqual(shown(R), [], 'a replacement ID is not the old flight: withheld');
  R.clock.t += 60000; setList(R, [entry('f9', 4)]);
  assert.deepEqual(shown(R), ['f9'], 'the replacement shows once it moves');
  // Removed, then added again under the same ID at the last seen position: no inherited evidence.
  R.clock.t += 60000; setList(R, []);
  assert.deepEqual(shown(R), []);
  R.clock.t += 60000; setList(R, [entry('f9', 4)]);
  assert.deepEqual(shown(R), [], 're-added at the last position: withheld');
  R.clock.t += 60000; setList(R, [entry('f9', 5)]);
  assert.deepEqual(shown(R), ['f9']);
  // Two flights with one number and two IDs: each is its own lifecycle; a Stop press by number is refused (ambiguous).
  R.clock.t += 60000; setList(R, [entry('f9', 6), entry('f10', 1)]);
  R.clock.t += 60000; setList(R, [entry('f9', 7), entry('f10', 2)]);
  assert.deepEqual(shown(R).sort(), ['f10', 'f9'], 'both flights qualify on their own evidence');
  const before = R.calls.length;
  const st = R.F.stop(R.hass, SRC, 'f9');
  assert.equal(st.state, 'ambiguous', 'two entries share the identifier: nothing is sent');
  assert.equal(R.calls.length, before, 'no command');
}

// ── 6. Several instances: one source each, no cross-instance writes, a missing pinned source never falls back ─────────────
{
  const R = runtime();
  instance(R, SRC, 'd1', 'fr24', [entry('f1', 1)]);
  instance(R, SRC_B, 'd2', 'fr24b', []);
  assert.equal(R.F.resolve(R.hass, '').state, 'choose', 'two sources: an explicit choice, no guess');
  assert.equal(R.F.resolve(R.hass, SRC_B).state, 'pinned');
  assert.equal(R.F.stop(R.hass, SRC_B, 'f1').state, 'stale', 'a row of instance A is no row of instance B');
  assert.equal(R.F.submit(R.hass, SRC_B, 'XY999').state, 'pending');
  assert.deepEqual(plain(R.calls), [setCall('text.fr24b_add', 'XY999')], 'the write goes to B\'s own control only');
  R.F.submit(R.hass, SRC, '');  // an empty text sends nothing
  assert.equal(R.calls.length, 1, 'an empty identifier is not sent');
  // Instance A's own flight and its remove control.
  R.clock.t += 60000; setList(R, [entry('f1', 2)]);
  setList(R, [entry('f1', 2)]);
  assert.equal(R.F.stop(R.hass, SRC, 'f1').state, 'pending');
  assert.equal(R.calls[1].target.entity_id, 'text.fr24_remove', 'A\'s control, not B\'s');
  // A pinned source that is gone: no flights and no fallback to the other instance.
  R.vars = { kind: 'flights', casora_flights_source: 'sensor.gone' };
  assert.equal(R.F.resolve(R.hass, 'sensor.gone').state, 'missing');
  assert.equal(R.F.airborne(R.hass, 'sensor.gone', R.clock.t).length, 0, 'a missing pinned source shows nothing');
  assert.equal(R.S.has('flights', { hass: R.hass, vars: R.vars, now: new Date(R.clock.t) }), false, 'the screensaver shows the sky, not B');
  // The config entry of A is removed: the pinned A is gone (no fallback); with no pin, B is the only source left.
  dropInstance(R, SRC, 'fr24');
  assert.equal(R.F.resolve(R.hass, SRC).state, 'missing', 'the pinned A is missing after its removal');
  assert.equal(R.F.resolve(R.hass, '').state, 'auto', 'without a pin the one remaining source is chosen');
  assert.equal(R.F.resolve(R.hass, '').id, SRC_B);
}

// ── 7. Empty and absent integration: no tile, no flights, no offer ───────────────────────────────────────────────────
{
  const R = runtime();
  assert.equal(R.F.present(R.hass), false, 'no FlightRadar24 in the house');
  assert.equal(tile(R), '', 'no tile');
  assert.equal(R.F.resolve(R.hass, '').state, 'none');
  assert.ok(!R.S.offered(R.hass).some((k) => k.id === 'flights'), 'Studio does not offer Flights');
}

// ── 8. Failures and waits: a refused command, an unavailable or missing control, an unconfirmed outcome ──────────────────
{
  const R = runtime();
  standalone(R);
  R.reply = () => Promise.reject(new Error('permission denied'));
  R.F.submit(R.hass, SRC, 'XY123');
  await flush();
  assert.equal(R.F.addView(R.hass, SRC).state, 'failed', 'a refused command is reported as failed');
  R.reply = null;
  const u = R.F.submit(R.hass, SRC, 'XY123');
  assert.equal(u.state, 'pending', 'a retry is a new attempt, sent by the user only');
  fire(R);
  assert.equal(R.F.addView(R.hass, SRC).state, 'unconfirmed', 'no list change within the wait: not confirmed');
  setList(R, [entry('f1', 0, { tracked_type: 'schedule', on_ground: 1 })]);
  assert.equal(R.F.addView(R.hass, SRC).state, 'confirmed', 'a later list update still confirms the addition');
}
{
  const R = runtime();
  standalone(R);
  R.hass.states['text.fr24_add'] = { entity_id: 'text.fr24_add', state: 'unavailable', attributes: {} };
  assert.equal(R.F.submit(R.hass, SRC, 'XY123').state, 'unavailable', 'an unavailable add control: no command');
  R.hass.states['text.fr24_add'] = { entity_id: 'text.fr24_add', state: '', attributes: {} };
  R.hass.entities = Object.fromEntries(Object.entries(R.hass.entities).filter(([id]) => id !== 'text.fr24_remove'));
  setList(R, [entry('f1', 1)]);
  assert.equal(R.F.stop(R.hass, SRC, 'f1').state, 'missing_ctl', 'a disabled remove control: nothing sent');
  assert.equal(R.calls.length, 0);
}

// ── 9. Units and the same flight on every surface: the saved units reach the tile and the screensaver alike ───────────
{
  const R = runtime();
  standalone(R);
  R.box._casoraLovelaceCfg = () => ({ views: [{ cards: [{ variables: { casora_flights_altitude_unit: 'm', casora_flights_speed_unit: 'kmh' } }] }] });
  R.vars = { kind: 'flights', casora_flights_altitude_unit: 'm', casora_flights_speed_unit: 'kmh' };
  setList(R, [entry('f1', 1)]);
  R.clock.t += 60000; setList(R, [entry('f1', 2)]);
  assert.match(tile(R), /10,668\u00a0m/, 'the tile in metres');
  assert.match(tile(R), /833\u00a0km\/h/, 'and in km/h');
  const sv = saver(R);
  assert.match(sv, /10,668\u00a0m/, 'the screensaver in the same metres');
  assert.match(sv, /833\u00a0km\/h/);
}

// ── 10. A bare entry: missing optional data is left out everywhere, never shown as blank or zero; no map is no progress ──
{
  const R = runtime();
  standalone(R);
  const bare = (step) => [entry('f1', step, { time_estimated_arrival: undefined, airport_origin_latitude: undefined,
    airport_origin_longitude: undefined, airline_short: undefined, aircraft_model: undefined, heading: undefined })];
  setList(R, bare(1));
  R.clock.t += 60000; setList(R, bare(2));
  const row = tile(R);
  assert.match(row, /XY123/, 'the flight still shows with its identity and movement');
  assert.ok(!/Voraussichtliche Ankunft/.test(row), 'no estimated arrival: no line, not the schedule relabelled');
  assert.ok(!/Ungefährer Fortschritt/.test(row), 'no airport position: no progress');
  assert.ok(!/Kurs|Fluggesellschaft|Flugzeugmodell/.test(saver(R)), 'the screensaver leaves out what is missing');
}

// ── 11. Screensaver under combined updates: a flight joining in the same turn does not switch the flight on show ─────────
{
  const R = runtime();
  instance(R, SRC, 'd1', 'fr24', [entry('f1', 1), entry('f2', 1, { flight_number: 'XY456', callsign: 'XYZ456' })]);
  R.vars = { kind: 'flights' };
  setList(R, [entry('f1', 1), entry('f2', 1, { flight_number: 'XY456', callsign: 'XYZ456' })]);
  saver(R); // the first sighting of both is a baseline
  R.clock.t += 60000;
  setList(R, [entry('f1', 2), entry('f2', 2, { flight_number: 'XY456', callsign: 'XYZ456' })]);
  const first = flightOf(saver(R));
  assert.ok(first === '123' || first === '456', 'one of the two flights is on show');
  R.clock.t += 60000;
  setList(R, [entry('f1', 3), entry('f2', 3, { flight_number: 'XY456', callsign: 'XYZ456' }), entry('f3', 1, { flight_number: 'XY789', callsign: 'XYZ789' })]);
  assert.equal(flightOf(saver(R)), first, 'a flight joining later in the turn does not switch the one on show');
  assert.equal(R.ticks.filter((t) => t.live).length, 1, 'no timer for flights; the screensaver\'s update only');
}

// ── 12. An independent external actor changes the tracked list; Casora reads it, writes nothing, and reconciles ─────────────
{
  const R = runtime();
  standalone(R);
  // Another tool (an automation, or the user in FlightRadar24) adds a flight through the integration: no Casora command.
  setList(R, [entry('f1', 0, { tracked_type: 'schedule', on_ground: 1 })]);
  setList(R, [entry('f1', 1)]);
  R.clock.t += 60000; setList(R, [entry('f1', 2)]);
  assert.match(tile(R), /XY123/, 'the external addition is shown once it moves');
  assert.equal(R.calls.length, 0, 'no Casora write for the external change');
  // The same external actor removes it while a Casora Stop is pending: the list confirms the removal, nothing is repeated.
  R.F.stop(R.hass, SRC, 'f1');
  await new Promise((r) => setImmediate(r)); // the command has ended
  setList(R, []);
  assert.equal(R.F.stopView(R.hass, SRC).state, 'confirmed', 'the removal is confirmed from the list');
  assert.equal(R.calls.length, 1, 'one command, from Casora only');
  // Re-added by the external actor later: a new lifecycle, not a Casora result.
  R.clock.t += 60000; setList(R, [entry('f1', 3)]);
  assert.equal(tile(R), '', 're-added: no inherited freshness');
  assert.equal(R.F.stopView(R.hass, SRC), null, 'a confirmed result of a list update is dropped at the next render');
}

console.log('ok flights_standalone');
