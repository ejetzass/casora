// Tracked flights in the Studio preview (#423): no preview action sends a FlightRadar24 call, also when the Studio is
// opened straight from its URL (the panel is on the page, but casora-core.js is not: no casoraInStudio).
//   node dev/unit/flights_preview_guard.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#inStudio,submit,stop,open,openList,paint
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SRC = fs.readFileSync(new URL('../../custom_components/casora/scripts/local/49-flights.js', import.meta.url), 'utf8');
const ctx = {
  console,
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => null, querySelectorAll: () => [] },
  setTimeout: () => ({ live: false }), clearTimeout() {},
  addEventListener() {},
  _casoraNotifyOpenViaCard: () => { ctx.opened = true; },
  _casoraUI: { stage: () => '', empty: () => '', line: () => '', group: () => '' },
  casoraLocale: () => 'de-DE',
  _casoraStudioPanel: { isConnected: true, _state: { compact: { rooms: [] } } }, // no casoraInStudio: no casora-core.js
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const F = ctx._casoraFlights;

const calls = [];
const fl = { id: 'f1', flight_number: 'XY123', callsign: 'TST123', aircraft_registration: 'T-AAAA', tracked_type: 'live', on_ground: 0 };
const hass = { entities: {}, states: {}, callService: (d, s, data, t) => { calls.push({ d, s, data, t }); return Promise.resolve(); } };
const add = (id, dev, key, state, attrs = {}) => {
  hass.entities[id] = { entity_id: id, platform: 'flightradar24', device_id: dev, translation_key: key, entity_category: key === 'additional_tracked' ? null : 'config' };
  hass.states[id] = { entity_id: id, state, attributes: attrs };
};
add('sensor.a', 'd1', 'additional_tracked', '1', { flights: [fl] });
add('text.add_a', 'd1', 'add_track', '');
add('text.remove_a', 'd1', 'remove_track', '');
add('switch.a', 'd1', 'scanning', 'on');

assert.equal(ctx.casoraInStudio, undefined, 'the test page has no casoraInStudio');
assert.equal(F.submit(hass, 'sensor.a', 'AB999'), null, 'Add is not sent');
assert.equal(F.stop(hass, 'sensor.a', 'f1'), null, 'Stop is not sent');
assert.equal(F.open(hass, 'sensor.a', 'f1'), null, 'a row tap does not open');
assert.equal(F.openList(hass, 'sensor.a'), null, 'the list does not open');
assert.equal(ctx.opened, undefined, 'no popup was opened');
assert.deepEqual(calls, [], 'the preview sends no service call');

// Outside the Studio the same calls do send (the guard is the panel, nothing else).
ctx._casoraStudioPanel = undefined;
assert.ok(F.submit(hass, 'sensor.a', 'AB999'), 'outside the Studio Add is sent');
assert.equal(calls.length, 1, 'outside the Studio one call went out');

console.log('flights_preview_guard: all checks passed');
