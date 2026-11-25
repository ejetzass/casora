// The Flights tile on desktop (49-flights.js liveHtml): two or more flights give one line, "N in the air", and one button
// for the whole tile (the list popup, F.tapTile); exactly one flight gives a short row (label and route, altitude and
// speed, expected arrival, progress bar). The percentage is visually hidden text inside the row button (its accessible
// name), and the bar is decorative. The list popup keeps the full row.
//   node dev/unit/flights_tile_desktop.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#liveHtml,airborne,liveHidden,tapTile,openList,listRows,rowHtml,progressBar,progressOf,progress,distanceKm
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');
const MIN = 60000;
const T0 = 1800000000000;

// Desktop: the phone flag stays off (the tile CSS's media query does not match).
const calls = [];
class FakeHTMLElement {
  constructor() { this._attrs = {}; this._root = null; }
  setAttribute(n, v) { this._attrs[n] = String(v); }
  getAttribute(n) { return n in this._attrs ? this._attrs[n] : null; }
  getRootNode() { return this._root; }
}
const ctx = {
  HTMLElement: FakeHTMLElement,
  console, Date, Math, Intl, JSON,
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => null, querySelectorAll: () => [],
    createElement: (tag) => ({ tag, textContent: '', setAttribute(n, v) { this[n] = String(v); } }) },
  setTimeout: () => ({ live: false }), clearTimeout() {},
  addEventListener() {},
  customElements: { get: () => undefined, define() {} },
  matchMedia: (q) => ({ matches: false, addEventListener() {} }),
  _casoraUI: { stage: (kind, o) => `<p>${o.text}</p>`, empty: (o) => `<p>${o.text}</p>` },
  _casoraNotifyOpenViaCard: (src, done, cfg) => { calls.push({ src, cfg }); return true; },
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
// A live, airborne synthetic flight with its airports. The estimated arrival is an epoch in seconds.
const fl = (id, extra = {}) => ({
  id, flight_number: 'XY' + id, callsign: 'TST' + id, aircraft_registration: 'T-AAAA', tracked_type: 'live', on_ground: 0,
  latitude: 51, longitude: 4.5, altitude: 31000, ground_speed: 450, heading: 90, vertical_speed: 0, airline_short: 'Testair',
  airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB', details_updated_at: T0,
  airport_origin_latitude: 50, airport_origin_longitude: 4, airport_destination_latitude: 52, airport_destination_longitude: 5,
  airport_destination_timezone_offset: 0, airport_destination_timezone_abbr: 'UTC',
  time_estimated_arrival: T0 / 1000 + 3600, ...extra,
});
// Observed at a first time, moved at a later one, then drawn (as the tile does). Each call starts later in time.
let base = T0;
const seen = (flights) => {
  base += 10 * MIN;
  setSource(flights);
  F.liveHidden(hass, base);
  setSource(flights.map((f) => ({ ...f, latitude: f.latitude + 0.05 })));
  F.liveHidden(hass, base + 2 * MIN);
  return base + 3 * MIN;
};
const text = (html) => html.replace(/<[^>]*>/g, '');
// The visually hidden span of the row: its text is the percentage phrase, its style is the standard hidden one.
const HIDDEN = /<span style="(position:absolute;width:1px;height:1px;overflow:hidden;clip:rect\(0 0 0 0\);white-space:nowrap)">([^<]*)<\/span>/;
const visible = (html) => text(html.replace(HIDDEN, ''));

// ── One flight: the short row ───────────────────────────────────────────────────────────────────────────────────────
const one = F.liveHtml(hass, '', seen([fl('1')]), 'Flüge');
assert.equal((one.match(/data-flights-row/g) || []).length, 1, 'one flight: one row button');
assert.doesNotMatch(one, /data-flights-sum/, 'one flight: no one-line summary');
assert.match(visible(one), /XY1/, 'one flight: the label');
assert.match(visible(one), /AAA → BBB/, 'one flight: the route');
assert.match(visible(one), /31.?000/, 'one flight: the altitude');
assert.match(visible(one), /450/, 'one flight: the speed');
assert.match(visible(one), /Voraussichtliche Ankunft/, 'one flight: the expected arrival');
// The arrival line is the one time line on the tile; the separate destination and local-time lines are the popup's only.
assert.doesNotMatch(visible(one), /Tijd op bestemming|Lokale tijd|Ortszeit/, 'one flight: no separate local time line');
assert.equal((visible(one).match(/Zeit am Zielort/g) || []).length, 1, 'one flight: the arrival line is the only destination time');
assert.doesNotMatch(visible(one), /%/, 'one flight: no percentage as visible text');
// The percentage is text inside the row button (its accessible name), visually hidden, not hidden from screen readers.
const hidden = one.match(HIDDEN);
assert.ok(hidden, 'one flight: the percentage is visually hidden text in the row');
assert.match(hidden[2], /^Ungefährer Fortschritt: \d+ %$/, 'one flight: the hidden text is the progress phrase with its value');
assert.doesNotMatch(one, /aria-hidden="true"[^>]*>[^<]*Ungefährer/, 'one flight: the hidden text is not aria-hidden');
// The bar is a decorative picture: aria-hidden, no role and no value attributes.
assert.doesNotMatch(one, /role="progressbar"|aria-valuenow|aria-valuemin|aria-valuemax|aria-valuetext/, 'one flight: no progressbar role or values on the tile');
assert.match(one, /<span aria-hidden="true"><span style="[^"]*"><span data-flights-bar/, 'one flight: the bar is inside an aria-hidden span');
assert.match(one, /data-flights-bar/, 'one flight: the bar fill is there');

// ── Two or more flights: one line, one button, no rows ──────────────────────────────────────────────────────────────
const two = F.liveHtml(hass, '', seen([fl('2'), fl('3')]), 'Flüge');
assert.equal(text(two), '2 in der Luft', 'two flights: one line with the count');
assert.match(two, /data-flights-sum/, 'two flights: the summary element is marked');
assert.doesNotMatch(two, /data-flights-row|<button/, 'two flights: no row buttons');

// The whole tile is one button: its tap opens the list popup (#460), with two or more flights.
calls.length = 0;
seen([fl('4'), fl('5')]);
F.tapTile(hass);
assert.equal(calls.length, 1, 'two flights: a tap opens one popup');
assert.equal(calls[0].cfg.template, 'casora_popup_flights_list', 'two flights: the list popup');

// The list popup keeps the full row, with the progress text line.
seen([fl('6'), fl('7')]);
const list = F.listRows(hass, { pin: '' });
assert.equal((list.match(/data-flights-row data-flights-src/g) || []).length, 2, 'list popup: one row per flight');
assert.match(text(list), /Ungefährer Fortschritt: \d+ %/, 'list popup: the full row keeps the progress text line');
assert.match(text(list), /31.?000/, 'list popup: the full row keeps the altitude');

// The list popup with one flight: its one full row, with the progress text line and the expected arrival.
seen([fl('8')]);
const listOne = F.listRows(hass, { pin: '' });
assert.equal((listOne.match(/data-flights-row data-flights-src/g) || []).length, 1, 'list popup with one flight: one full row');
assert.match(text(listOne), /Ungefährer Fortschritt: \d+ %/, 'list popup with one flight: the progress text line');
assert.match(text(listOne), /Voraussichtliche Ankunft/, 'list popup with one flight: the expected arrival');

console.log('ok: flights tile desktop');
