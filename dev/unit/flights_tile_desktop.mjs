// The Flights tile on desktop (49-flights.js liveHtml): one flight or more give one line, "N in the air", and one button
// for the whole tile (F.tapTile); the tile shows no flight rows. The list popup keeps the full row.
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
const defined = {};
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
  customElements: { get: () => undefined, define: (n, c) => { defined[n] = c; } },
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
const HIDDEN = /<span style="(position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden;clip:rect\(0 0 0 0\);white-space:nowrap)">([^<]*)<\/span>/;
const visible = (html) => text(html.replace(HIDDEN, ''));

// ── One flight: the same one line as two or more, no row ──────────────────────────────────────────────────────────────
const one = F.liveHtml(hass, '', seen([fl('1')]), 'Flüge');
assert.equal(text(one), '1 in der Luft', 'one flight: one line with the count');
assert.match(one, /data-flights-sum/, 'one flight: the summary element is marked');
assert.doesNotMatch(one, /data-flights-row|<button|data-flights-bar/, 'one flight: no row buttons, no bar');

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

// ── The tile follows the number of flights while the page stays open (1 -> 2 -> 1, no reconnect) ──────────────────────
// button-card draws the state again; the new casora-flight-list connects into the same card and sets its mode: the card is
// one button (tap target, no group label, reachable by Tab) with one flight as with two or more.
const card = { attrs: {}, setAttribute(n, v) { this.attrs[n] = String(v); }, getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; },
  hasAttribute(n) { return n in this.attrs; }, removeAttribute(n) { delete this.attrs[n]; }, isConnected: true };
const tileRoot = { querySelector: (q) => (q === '#card' ? card : q.startsWith('style') ? {} : null), appendChild() {}, host: { _config: {} } };
const draw = (html) => {
  const el = new defined['casora-flight-list']();
  el.setAttribute('data-name', 'Flüge');
  if (/data-flights-sum/.test(html)) el.setAttribute('data-flights-sum', '');
  el._root = tileRoot;
  el.connectedCallback();
};
assert.ok(defined['casora-flight-list'], 'the tile element is defined');
for (const ids of [['1'], ['1', '2'], ['1']]) {
  draw(F.liveHtml(hass, '', seen(ids.map((i) => fl(i))), 'Flüge'));
  assert.equal(card.getAttribute('role'), 'button', ids.length + ' flight(s): the card is one button');
  assert.equal(card.hasAttribute('data-flights-tile-card'), true, ids.length + ' flight(s): the card is the tap target');
  assert.equal(card.hasAttribute('aria-label'), false, ids.length + ' flight(s): the line is the button name');
  assert.equal(card.getAttribute('tabindex'), '0', ids.length + ' flight(s): the button can be reached by Tab');
}

// Only #state is clipped, so nothing paints outside the tile.
assert.match(F._tileCss, /#state\{[^}]*overflow:hidden/, 'the state row is clipped, not the card');

console.log('ok: flights tile desktop');
