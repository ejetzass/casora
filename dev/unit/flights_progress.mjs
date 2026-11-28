// Flights progress (49-flights.js): the shared remaining time and total time of a flight in whole minutes, the one h:mm
// formatter, and the progress text and bar every row and popup draws through. Fixed clock; synthetic flights.
//   node dev/unit/flights_progress.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#remaining,duration,hm,progressBar,progressText,progressHtml,rowHtml
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');
const MIN = 60000;
const T0 = 1800000000000;
const S0 = T0 / 1000; // the same instant in epoch seconds

let clock = T0;
class FakeDate extends Date { static now() { return clock; } }
class FakeHTMLElement { setAttribute() {} getAttribute() { return null; } getRootNode() { return null; } }
const ctx = {
  HTMLElement: FakeHTMLElement,
  console, Date: FakeDate, Math, Intl, JSON,
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => null, querySelectorAll: () => [], createElement: (tag) => ({ tag, setAttribute() {} }) },
  customElements: { get: () => undefined, define() {} },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  setTimeout: () => ({ live: false }), clearTimeout() {},
  addEventListener() {},
  casoraLocale: () => 'en-US',
  _casoraUI: { section: (k, b) => b, empty: () => 'EMPTY' },
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const F = ctx._casoraFlights;

let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message.split('\n')[0]); }
};

test('remaining: uses the estimated arrival', () => {
  const e = { time_estimated_arrival: S0 + 90 * 60, time_scheduled_arrival: S0 + 200 * 60 };
  assert.equal(F.remaining(e, T0), 90);
});
test('remaining: falls back to the scheduled arrival', () => {
  assert.equal(F.remaining({ time_scheduled_arrival: S0 + 45 * 60 }, T0), 45);
});
test('remaining: across midnight (23:50 to 00:20 next day)', () => {
  const now = Date.UTC(2027, 0, 15, 23, 50), arr = Date.UTC(2027, 0, 16, 0, 20) / 1000;
  assert.equal(F.remaining({ time_estimated_arrival: arr }, now), 30);
});
test('remaining: no known time gives null', () => {
  assert.equal(F.remaining({}, T0), null);
  assert.equal(F.remaining({ time_estimated_arrival: 0, time_scheduled_arrival: null }, T0), null);
});
test('remaining: a negative result gives null', () => {
  assert.equal(F.remaining({ time_estimated_arrival: S0 - 60 }, T0), null);
});
test('remaining: whole minutes, rounded', () => {
  assert.equal(F.remaining({ time_estimated_arrival: S0 + 90 * 60 + 40 }, T0), 91);
});
test('duration: estimated arrival minus real departure', () => {
  const e = { time_real_departure: S0, time_scheduled_departure: S0 - 600, time_estimated_arrival: S0 + 252 * 60, time_scheduled_arrival: S0 + 999 * 60 };
  assert.equal(F.duration(e), 252);
});
test('duration: falls back to the scheduled times', () => {
  assert.equal(F.duration({ time_scheduled_departure: S0, time_scheduled_arrival: S0 + 120 * 60 }), 120);
});
test('duration: an unknown side gives null', () => {
  assert.equal(F.duration({ time_scheduled_departure: S0 }), null);
  assert.equal(F.duration({ time_scheduled_arrival: S0 + 60 }), null);
  assert.equal(F.duration({}), null);
});
test('duration: a negative result gives null', () => {
  assert.equal(F.duration({ time_real_departure: S0 + 600, time_estimated_arrival: S0 }), null);
});
test('duration: a flight across midnight (22:30 to 03:10 next day)', () => {
  const dep = Date.UTC(2027, 0, 15, 22, 30) / 1000, arr = Date.UTC(2027, 0, 16, 3, 10) / 1000;
  assert.equal(F.duration({ time_real_departure: dep, time_estimated_arrival: arr }), 280);
});
test('hm: hours, padded minutes, the hour unit', () => {
  assert.equal(F.hm(252), '4:12\u00a0Std.'); // no-break space: a value never breaks inside
  assert.equal(F.hm(5), '0:05\u00a0Std.');
  assert.equal(F.hm(59.6), '1:00\u00a0Std.'); // rounds before splitting, never 0:60
  assert.equal(F.hm(60), '1:00\u00a0Std.');
});
test('hm: no value gives an empty string', () => {
  assert.equal(F.hm(null), '');
  assert.equal(F.hm(undefined), '');
});
test('progressText and progressBar are on F, with the known markup', () => {
  assert.equal(F.progressText(57), '57 %');
  assert.equal(F.progressBar(57, 4, 6),
    '<span style="display:block;position:relative;height:4px;margin-top:6px;border-radius:2px;overflow:hidden;opacity:.9;background:rgba(127,127,127,0.3)"><span data-flights-bar style="position:absolute;left:0;top:0;bottom:0;width:57%;background:currentColor"></span></span>');
});

// A 57 % flight on one meridian: the airports at 10 and 20 degrees north, the flight at 15.7. The rows are reached as the list does.
const hass = { entities: {}, states: {} };
const setSource = (flights) => {
  hass.entities = { 'sensor.a': { entity_id: 'sensor.a', platform: 'flightradar24', device_id: 'd1', translation_key: 'additional_tracked' } };
  hass.states = { 'sensor.a': { entity_id: 'sensor.a', state: String(flights.length), attributes: { flights } } };
};
const fl = (id) => ({
  id, flight_number: 'XY' + id, callsign: 'TST' + id, aircraft_registration: 'T-AAAA', tracked_type: 'live', on_ground: 0,
  latitude: 15.7, longitude: 20, altitude: 31000, ground_speed: 450, heading: 90, vertical_speed: 0, airline_short: 'Testair',
  airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB', details_updated_at: T0,
  airport_origin_latitude: 10, airport_origin_longitude: 20, airport_destination_latitude: 20, airport_destination_longitude: 20,
  time_estimated_arrival: S0 + 3600,
});
let base = T0;
const seen = (flights) => {
  base += 10 * MIN;
  setSource(flights.map((f) => ({ ...f, longitude: 20.05 })));
  F.liveHidden(hass, base);
  setSource(flights);
  F.liveHidden(hass, base + 2 * MIN);
  clock = base + 3 * MIN;
  return clock;
};
const text = (html) => html.replace(/<[^>]*>/g, '');

test('list row: shows the 57 % text and the bar', () => {
  seen([fl('2'), fl('3')]);
  const html = F.listRows(hass, { pin: '' });
  assert.equal((html.match(/data-flights-bar/g) || []).length, 2);
  assert.match(text(html), /Ungefährer Fortschritt: 57 %/);
});
test('rows draw through F.progressBar (no private copy)', () => {
  const real = F.progressBar;
  F.progressBar = () => '<i data-spy></i>';
  try {
    seen([fl('5'), fl('6')]);
    assert.match(F.listRows(hass, { pin: '' }), /data-spy/);
  } finally { F.progressBar = real; }
});

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('flights_progress: all ok');
