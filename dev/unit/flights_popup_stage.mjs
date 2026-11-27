// The flight popup's one stage (49-flights.js): the map is the only stage, wide over both columns; the route stands in the
// head's status line (or "Nicht verfügbar"); the progress row sits under the map; departure and movement in the left column,
// arrival and aircraft in the right. Controlled clock; synthetic flights.
//   node dev/unit/flights_popup_stage.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#flightPopup,flightSec,timePlates,progressHtml,flight
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');
const MIN = 60000;
const T0 = 1800000000000;
const S0 = T0 / 1000;

let clock = T0;
class FakeDate extends Date { static now() { return clock; } }
const ctx = {
  console, Date: FakeDate, Math, Intl, JSON,
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => null, querySelectorAll: () => [] },
  setTimeout: () => ({ live: false }), clearTimeout() {}, addEventListener() {},
  _casoraUI: { stage: (type, o) => 'STAGE[' + type + ']', line: (main) => 'LINE[' + main + ']', empty: () => 'EMPTY' },
  _casoraSoftKit: { secCard: (watch, code) => ({ watch, code }), layout: (o) => o },
  casoraLocale: () => 'en-US',
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const F = ctx._casoraFlights;

// An airborne flight 1:30 into a 4:00 flight, both airports known (progress known).
const fl = (id, extra = {}) => ({
  id, flight_number: 'XY123', callsign: 'TST123', aircraft_registration: 'T-AAAA', aircraft_model: 'Example 900', airline_short: 'Testair',
  tracked_type: 'live', on_ground: 0, latitude: 10, longitude: 20, altitude: 35000, ground_speed: 450, heading: 270, vertical_speed: -2000,
  airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB', airport_origin_name: 'Airport Alpha', airport_destination_name: 'Airport Beta',
  airport_origin_latitude: 10, airport_origin_longitude: 0, airport_destination_latitude: 10, airport_destination_longitude: 40,
  airport_destination_timezone_offset: 7200,
  time_real_departure: S0 - 90 * 60, time_estimated_arrival: S0 + 150 * 60, ...extra,
});
const deep = (x) => JSON.parse(JSON.stringify(x));
let hass;
const setup = (flights) => {
  hass = { config: { time_zone: 'UTC' }, entities: { 'sensor.a': { entity_id: 'sensor.a', platform: 'flightradar24', device_id: 'da', translation_key: 'additional_tracked' } }, states: {} };
  const put = (list) => { hass.states = { 'sensor.a': { entity_id: 'sensor.a', state: String(list.length), attributes: { flights: list } } }; };
  put(flights); F.airborne(hass, '', T0);
  put(flights.map((f) => ({ ...f, latitude: f.latitude + 0.05 })));
  hass.put = put;
};
const popup = (key) => F.flightPopup(hass.states, hass, { source: 'sensor.a', flight: key });
const sec = (part, key) => F.sec(part, { src: 'sensor.a', flight: key }, hass.states, hass);

let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message.split('\n')[0]); }
};

test('one stage: the map, wide under the head line, then the progress row; no route dial', () => {
  setup([fl('a1')]);
  const pop = popup('a1');
  assert.deepEqual(deep(pop.top), ['line', 'map', 'prog']);
  assert.equal(pop.fields.fstage, undefined);
  assert.equal(pop.fields.stage, undefined);
  assert.match(sec('fmap', 'a1'), /^STAGE\[image\]$/);
  assert.equal(sec('fstage', 'a1'), '');
});

test('head status line: the route for a flight that qualifies, Nicht verfügbar once it does not; then nothing else', () => {
  setup([fl('b1')]);
  assert.equal(sec('fline', 'b1'), 'LINE[AAA → BBB]');
  hass.put([{ ...fl('b1'), on_ground: 1 }]);
  assert.equal(sec('fline', 'b1'), 'LINE[Nicht verfügbar]');
  for (const part of ['fmap', 'fprog', 'fdep', 'farr', 'fmove', 'fair']) assert.equal(sec(part, 'b1'), '', part);
});

test('progress row: label, percent, bar, time line and arrival line; without a progress no bar and no percent', () => {
  setup([fl('c1'), fl('c2', { airport_destination_latitude: undefined, airport_destination_longitude: undefined })]);
  const row = sec('fprog', 'c1');
  assert.match(row, /role="progressbar" aria-label="Ungefährer Fortschritt"[^>]*aria-valuenow="50" aria-valuetext="50 %"/);
  assert.match(row, /<span style="color:[^"]*">Ungefährer Fortschritt<\/span><span style="font-weight:600">50 %<\/span>/);
  assert.match(row, /data-flights-bar style="[^"]*width:50%/);
  assert.match(row, /<div[^>]*>Restzeit\u00a02:30\u00a0Std\.<\/div><div[^>]*>Gesamt\u00a04:00\u00a0Std\.<\/div>/);
  assert.doesNotMatch(row, /·/);
  assertArrival(row);
  const bare = sec('fprog', 'c2');
  assert.doesNotMatch(bare, /progressbar|data-flights-bar|Ungefährer Fortschritt| %/);
  assert.match(bare, /Restzeit\u00a02:30\u00a0Std\.<\/div><div[^>]*>Gesamt\u00a04:00\u00a0Std\./);
  assertArrival(bare);
});

// The label stays breakable (a long language never overflows a narrow row); only the date and time, and the home time, are unbreakable.
function assertArrival(html) {
  assert.match(html, />Voraussichtliche Ankunft <span style="white-space:nowrap">12:30\u00a0PM\u00a0BBB<\/span><div style="[^"]*secondary[^"]*"><span style="white-space:nowrap">10:30\u00a0AM\u00a0UTC<\/span><\/div>/);
}

test('progress row: only the total time, or only the remaining time, shows one line', () => {
  // An arrival in the past leaves no remaining time; no departure time leaves no total.
  setup([fl('f1', { time_estimated_arrival: S0 - 60 }), fl('f2', { time_real_departure: undefined })]);
  const noRem = sec('fprog', 'f1'), noTotal = sec('fprog', 'f2');
  assert.match(noRem, /Gesamt\u00a0\d+:\d\d\u00a0Std\./);
  assert.doesNotMatch(noRem, /Restzeit/);
  assert.match(noTotal, /Restzeit\u00a02:30\u00a0Std\./);
  assert.doesNotMatch(noTotal, /Gesamt/);
});

test('timeHtml: the saver keeps its classes; plain gives the popup inline style; one helper for both', () => {
  assert.equal(F.timeHtml('12:30', '10:30'), '<span class="cs-fl-nw">12:30</span><div class="cs-fl-arrsub"><span class="cs-fl-nw">10:30</span></div>');
  assert.equal(F.timeHtml('12:30', ''), '<span class="cs-fl-nw">12:30</span>');
  assert.equal(F.timeHtml('12:30', '10:30', true),
    '<span style="white-space:nowrap">12:30</span><div style="color:var(--secondary-text-color,currentColor)"><span style="white-space:nowrap">10:30</span></div>');
});

test('arrivalLine: label, then date and airport time, home time apart; empty without an estimate', () => {
  setup([fl('h1'), fl('h2', { time_estimated_arrival: undefined })]);
  const a = F.arrivalLine(hass, fl('h1'), T0);
  assert.deepEqual(deep(a), { label: 'Voraussichtliche Ankunft', when: '12:30\u00a0PM\u00a0BBB', home: '10:30\u00a0AM\u00a0UTC' });
  assert.equal(F.arrivalLine(hass, fl('h2', { time_estimated_arrival: undefined }), T0), null);
});

test('the popup bar is F.progressBar (no private copy)', () => {
  setup([fl('g1')]);
  const real = F.progressBar;
  F.progressBar = () => '<i data-spy></i>';
  try { assert.match(sec('fprog', 'g1'), /data-spy/); } finally { F.progressBar = real; }
});

test('left column: departure and movement; right column: arrival and aircraft', () => {
  setup([fl('d1')]);
  const pop = popup('d1');
  assert.deepEqual(deep(pop.left), ['dep', 'move']);
  assert.deepEqual(deep(pop.right), ['arr', 'air']);
  assert.equal(pop.noBalance, true);
  const dep = sec('fdep', 'd1'), arr = sec('farr', 'd1');
  assert.match(dep, />Abflug</); assert.match(dep, /AAA · Airport Alpha/); assert.doesNotMatch(dep, /Ankunft|BBB/);
  assert.match(arr, />Ankunft</); assert.match(arr, /BBB · Airport Beta/); assert.doesNotMatch(arr, /Abflug|AAA/);
});

test('F.flight is null for a flight on the ground', () => {
  setup([fl('e1')]);
  assert.equal(F.flight(hass, 'sensor.a', 'e1', Date.now()).entry.id, 'e1');
  hass.put([{ ...fl('e1'), on_ground: 1 }]);
  assert.equal(F.flight(hass, 'sensor.a', 'e1', Date.now()), null);
});

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all ok');
