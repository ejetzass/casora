// The Flights tile's text and card (49-flights.js liveHtml): the tile text carries no CSS, since the card's accessible name
// is built from the text. The tile's styles go into the card once, from casora-flight-list. The tile holds only its state line, so
// the card is one button (its tap opens the list popup).
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
const html = tile(fl(), 'Flüge');
assert.ok(html.length > 0, 'precondition: the tile has a row');
assert.doesNotMatch(html, /<style/i, 'the tile output has no style element: its CSS stays out of the text');
const text = html.replace(/<[^>]*>/g, '');
assert.doesNotMatch(text, /[{}]|#container|#state|grid-template|outline/, 'the tile text holds no CSS');

// ── The styles go into the card's root once, and the card is a named group ─────────────────────────────────────────
const Wrap = defined['casora-flight-list'];
assert.ok(Wrap, 'the tile rows are wrapped in casora-flight-list');
const card = { tagName: 'HA-CARD', id: 'card', attrs: { role: 'button' },
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }, hasAttribute(n) { return n in this.attrs; }, setAttribute(n, v) { this.attrs[n] = String(v); },
  removeAttribute(n) { delete this.attrs[n]; } };
const root = { styles: [], querySelector: (sel) => {
  if (sel === '#card') return card;
  if (sel.startsWith('style[data-flights-tile]')) return root.styles[0] || null;
  return null;
}, appendChild(n) { root.styles.push(n); } };
// The element as the browser builds it from the tile's markup: its attributes, then its connection. The host is the
// button-card element that owns the card (its config carries the card's own name, if any).
const connect = (markup, host) => {
  const w = new Wrap();
  root.host = host;
  w._root = root;
  if (/<casora-flight-list data-flights-sum /.test(markup)) w.setAttribute('data-flights-sum', '');
  w.setAttribute('data-name', (markup.match(/data-name="([^"]*)"/) || [])[1]);
  w.connectedCallback();
};
assert.equal(card.attrs.role, 'button', 'precondition: the library gives the card role button');
const unnamed = { _config: {} };
connect(html, unnamed);
assert.equal(root.styles.length, 1, 'the tile styles are added to the card root');
assert.equal(root.styles[0].tag, 'style', 'the styles are a style element in the card');
assert.match(root.styles[0].textContent, /#container\{/, 'the card rule is in the card');
connect(html, unnamed); // a redraw: no second style block
assert.equal(root.styles.length, 1, 'a redraw adds no second style block');
// The tile is one line (the state): the card is the one button, its line is the button name, its tap opens the list popup.
assert.equal(card.attrs.role, 'button', 'the Flights tile card stays one button');
assert.equal(card.attrs['data-flights-tile-card'], '', 'the card is the tap target');
assert.equal(card.attrs['aria-label'], undefined, 'the line is the button name, no extra label');

console.log('ok: flights tile card');
