// The Flights tile's text and card (49-flights.js liveHtml): the tile text carries no CSS, since the card's accessible name
// is built from the text. The tile's styles go into the card once, from casora-flight-list.
//   node dev/unit/flights_tile_card.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#liveHtml,airborne,liveHidden,defineTileList
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');
const MIN = 60000;
const T0 = 1800000000000;

// A page with the element support the tile needs: an element class that keeps attributes and its root.
class FakeHTMLElement {
  constructor() { this._attrs = {}; this._root = null; }
  setAttribute(n, v) { this._attrs[n] = String(v); }
  getAttribute(n) { return n in this._attrs ? this._attrs[n] : null; }
  getRootNode() { return this._root; }
}
const defined = {};
const ctx = {
  console, Date, Math, Intl, JSON,
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => null, querySelectorAll: () => [],
    createElement: (tag) => ({ tag, textContent: '', setAttribute(n, v) { this[n] = String(v); } }) },
  setTimeout: () => ({ live: false }), clearTimeout() {},
  addEventListener() {},
  HTMLElement: FakeHTMLElement,
  customElements: { get: (n) => defined[n], define: (n, c) => { defined[n] = c; } },
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const F = ctx._casoraFlights;

// Hass with one source sensor, as the flights tests build it.
const hass = { entities: {}, states: {} };
const setSource = (flights) => {
  hass.entities = { 'sensor.a': { entity_id: 'sensor.a', platform: 'flightradar24', device_id: 'd1', translation_key: 'additional_tracked' } };
  hass.states = { 'sensor.a': { entity_id: 'sensor.a', state: String(flights.length), attributes: { flights } } };
};
// A live, airborne flight with its airports.
const fl = (extra = {}) => ({
  id: 'h1', flight_number: 'XY123', callsign: 'TST123', aircraft_registration: 'T-AAAA', tracked_type: 'live', on_ground: 0,
  latitude: 51, longitude: 4.5, altitude: 31000, ground_speed: 450, heading: 90, vertical_speed: 0, airline_short: 'Testair',
  airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB', details_updated_at: T0,
  airport_origin_latitude: 50, airport_origin_longitude: 4, airport_destination_latitude: 52, airport_destination_longitude: 5, ...extra,
});
// The tile for one flight: it is observed at a first time, moves at a later one, and is drawn after that (as the tile does).
// Each call starts at a later time, so earlier calls do not carry their movement evidence over.
let base = T0;
const tile = (f, name = 'Flüge') => {
  base += 10 * MIN;
  setSource([f]);
  F.liveHidden(hass, base);
  setSource([{ ...f, latitude: f.latitude + 0.05 }]);
  F.liveHidden(hass, base + 2 * MIN);
  return F.liveHtml(hass, '', base + 3 * MIN, name);
};

// ── The tile text holds no CSS (it is the card's accessible name source) ────────────────────────────────────────────
const html = tile(fl());
assert.ok(html.length > 0, 'precondition: the tile has a row');
assert.doesNotMatch(html, /<style/i, 'the tile output has no style element: its CSS stays out of the text');
const text = html.replace(/<[^>]*>/g, '');
assert.doesNotMatch(text, /[{}]|#container|#state|grid-template|outline/, 'the tile text holds no CSS');

// ── The styles go into the card's root once, from the tile's element on connect ─────────────────────────────────────
const Wrap = defined['casora-flight-list'];
assert.ok(Wrap, 'the tile rows are wrapped in casora-flight-list');
const root = { styles: [], querySelector: (sel) => (sel.startsWith('style[data-flights-tile]') ? (root.styles[0] || null) : null),
  appendChild(n) { root.styles.push(n); } };
const connect = () => { const w = new Wrap(); w._root = root; w.connectedCallback(); return w; };
connect();
assert.equal(root.styles.length, 1, 'the tile styles are added to the card root');
assert.equal(root.styles[0].tag, 'style', 'the styles are a style element in the card');
assert.match(root.styles[0].textContent, /#container\{/, 'the grid rule is in the card');
assert.match(root.styles[0].textContent, /\[data-flights-row\]:focus-visible/, 'the row focus ring is in the card');
connect(); // a redraw: no second style block
assert.equal(root.styles.length, 1, 'a redraw adds no second style block');

console.log('ok: flights tile card');
