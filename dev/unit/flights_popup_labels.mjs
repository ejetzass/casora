// The flight popup's label rows (49-flights.js pairs): each label goes through the translation once. A label that is
// already translated by its caller is translated again by pairs(), which shows the words twice in a language that has them.
//   node dev/unit/flights_popup_labels.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#pairs,flightSec,timePlates
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');
const MIN = 60000;
const T0 = 1800000000000;

// A translation that marks every call: a label translated twice shows the marks twice.
const ctx = {
  console, localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => null, querySelectorAll: () => [] },
  setTimeout: () => ({ live: false }), clearTimeout() {},
  addEventListener() {}, _casoraNotifyOpenViaCard() {},
  _casoraUI: { stage: (type, o) => 'STAGE[' + type + ']', empty: () => 'EMPTY' },
  _casoraLovelaceCfg: () => null, casoraLocale: () => 'en-US',
  casoraTr: (s) => '~' + s + '~',
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const F = ctx._casoraFlights;

const hass = { entities: {}, states: {}, calls: [] };
const source = (id, flights) => {
  hass.entities = { ...hass.entities, [id]: { entity_id: id, platform: 'flightradar24', device_id: 'd', translation_key: 'additional_tracked' } };
  hass.states = { ...hass.states, [id]: { entity_id: id, state: String(flights.length), attributes: { flights } } };
};
// The popup reads the real clock, so the scheduled times are relative to it (Unix seconds).
const NOW_S = Math.floor(Date.now() / 1000);
const fl = (extra = {}) => ({ id: 'p1', flight_number: 'XY123', callsign: 'TST123', aircraft_registration: 'T-AAAA', aircraft_model: 'Example 900',
  tracked_type: 'live', on_ground: 0, latitude: 10, longitude: 20, altitude: 35000, ground_speed: 450, heading: 270, vertical_speed: -2000,
  airline_short: 'Testair', airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB', airport_origin_name: 'Airport Alpha',
  airport_origin_terminal: '2', airport_destination_name: 'Airport Beta',
  time_scheduled_departure: NOW_S - 3600, time_scheduled_arrival: NOW_S + 3600,
  airport_origin_timezone_offset: 3600, airport_origin_timezone_abbr: 'CET', airport_destination_timezone_offset: 7200,
  airport_destination_timezone_abbr: 'CEST', ...extra });
source('sensor.a', [fl()]); F.airborne(hass, '', T0);
source('sensor.a', [fl({ latitude: 10.05 })]);
const c = { src: 'sensor.a', flight: 'p1' };

// Each label appears once, marked once: no "~~Label~~" from a second translation.
const labels = { fmove: ['Höhe', 'Geschwindigkeit über Grund', 'Vertikalgeschwindigkeit', 'Kurs über Grund'],
  fair: ['Fluggesellschaft', 'Flugzeugmodell', 'Registrierung', 'Rufzeichen'], fdep: ['Abflug'], farr: ['Ankunft'] };
for (const part of Object.keys(labels)) {
  const html = F.sec(part, c, hass.states, hass);
  assert.doesNotMatch(html, /~~/, part + ': no label is translated twice');
  for (const l of labels[part]) assert.ok(html.includes('~' + l + '~'), part + ': "' + l + '" is translated');
}
console.log('ok flights_popup_labels');
