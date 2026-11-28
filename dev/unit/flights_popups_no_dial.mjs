// The flights list popup and the Manage flights popup have no stage (no status dial): the list popup is one section whose heading
// carries the count ("Flüge · 2 in der Luft"), the Manage popup is the add field, then the list (49-flights.js). Synthetic flights.
//   node dev/unit/flights_popups_no_dial.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#listPopup,listRows,popup,sec
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');
const T0 = 1800000000000;

let clock = T0;
class FakeDate extends Date { static now() { return clock; } }
const ctx = {
  console, Date: FakeDate, Math, Intl, JSON,
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => null, querySelectorAll: () => [] },
  setTimeout: () => ({ live: false }), clearTimeout() {}, addEventListener() {},
  _casoraUI: {
    stage: (type) => 'STAGE[' + type + ']', empty: (o) => 'EMPTY[' + o.text + ']', line: () => '', group: () => '',
    section: (kind, body, label) => 'SECTION[' + label + ']' + body,
  },
  _casoraSoftKit: { secCard: (watch, code) => ({ watch, code }), layout: (o) => o },
  casoraLocale: () => 'en-US',
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const F = ctx._casoraFlights;

const fl = (id) => ({
  id, flight_number: 'XY' + id, callsign: 'TST' + id, tracked_type: 'live', on_ground: 0, latitude: 10, longitude: 20, altitude: 35000, ground_speed: 450,
  airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB',
});
let hass;
const setup = (flights) => {
  hass = { config: { time_zone: 'UTC' }, entities: { 'sensor.a': { entity_id: 'sensor.a', platform: 'flightradar24', device_id: 'da', translation_key: 'additional_tracked' },
    'text.add': { entity_id: 'text.add', platform: 'flightradar24', device_id: 'da', translation_key: 'add_to_track' } }, states: {} };
  const put = (list) => { hass.states = { 'sensor.a': { entity_id: 'sensor.a', state: String(list.length), attributes: { flights: list } } }; };
  put(flights); F.airborne(hass, '', T0);
  put(flights.map((f) => ({ ...f, latitude: f.latitude + 0.05 })));
};
const deep = (x) => JSON.parse(JSON.stringify(x));
let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message.split('\n')[0]); }
};

test('list popup: no stage field, one list field', () => {
  setup([fl('1'), fl('2')]);
  const pop = F.listPopup(hass.states, hass, {});
  assert.deepEqual(Object.keys(deep(pop.fields)), ['list']);
  assert.equal(pop.stage, undefined);
});

test('list popup: the heading counts the flights, the rows follow, no dial', () => {
  setup([fl('1'), fl('2')]);
  const html = F.listRows(hass, { pin: '' });
  assert.match(html, /^SECTION\[Flüge · 2 in der Luft\]/);
  assert.equal((html.match(/data-flights-row/g) || []).length >= 2, true);
  assert.doesNotMatch(html, /STAGE\[/);
  assert.equal(F.listStage, undefined, 'the list popup has no stage part any more');
});

test('Manage popup: no stage field; the add field above the list', () => {
  setup([fl('1')]);
  const pop = F.popup(hass.states, hass, {});
  assert.equal(pop.fields.stage, undefined);
  assert.equal(pop.stage, undefined);
  assert.deepEqual(Object.keys(deep(pop.fields)).sort(), ['add', 'list']);
  assert.deepEqual(deep(pop.top), ['add']);
  assert.deepEqual(deep(pop.right), ['list']);
  assert.equal(F.sec('stage', { pin: '' }, hass.states, hass), '', 'no stage text either');
});

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('flights_popups_no_dial: all checks passed');
