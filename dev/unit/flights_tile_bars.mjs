// The list popup's progress bars (49-flights.js listRows; the tile itself shows no bar): one airborne flight with airport
// coordinates gives one bar; without the coordinates there is none; when they come back there is again one, not two.
//   node dev/unit/flights_tile_bars.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#listRows,airborne,liveHidden,progressOf,progress,progressBar
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');
const MIN = 60000;
const T0 = 1800000000000;

const ctx = {
  _casoraUI: { empty: (o) => o.text },
  console, Date, Math, Intl, JSON,
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => null, querySelectorAll: () => [] },
  setTimeout: () => ({ live: false }), clearTimeout() {},
  addEventListener() {},
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const F = ctx._casoraFlights;

const hass = { entities: {}, states: {} };
const setSource = (flights) => {
  hass.entities = { 'sensor.a': { entity_id: 'sensor.a', platform: 'flightradar24', device_id: 'd1', translation_key: 'additional_tracked' } };
  hass.states = { 'sensor.a': { entity_id: 'sensor.a', state: String(flights.length), attributes: { flights } } };
};
// One live, airborne flight; its airports' coordinates are optional (null removes them).
const fl = (extra = {}) => ({
  id: 'h1', flight_number: 'XY123', callsign: 'TST123', aircraft_registration: 'T-AAAA', tracked_type: 'live', on_ground: 0,
  latitude: 51, longitude: 4.5, altitude: 31000, ground_speed: 450, heading: 90, vertical_speed: 0, airline_short: 'Testair',
  airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB', details_updated_at: T0,
  airport_origin_latitude: 50, airport_origin_longitude: 4, airport_destination_latitude: 52, airport_destination_longitude: 5, ...extra,
});
// The tile is observed at a first time, the flight moves, and the tile is drawn after that. Each call starts later in time.
let base = T0;
const tile = (f) => {
  base += 10 * MIN;
  setSource([f]);
  F.liveHidden(hass, base);
  setSource([{ ...f, latitude: f.latitude + 0.05 }]);
  F.liveHidden(hass, base + 2 * MIN);
  return F.listRows(hass, { pin: '', now: base + 3 * MIN });
};
const bars = (html) => (html.match(/data-flights-bar/g) || []).length;

assert.equal(bars(tile(fl())), 1, 'one airborne flight with coordinates: one progress bar in the list');
assert.equal(bars(tile(fl({ airport_origin_latitude: null, airport_origin_longitude: null }))), 0, 'without the origin coordinates: no bar');
assert.equal(bars(tile(fl())), 1, 'the coordinates return: one progress bar in the list, not two');

console.log('ok: flights tile bars');
