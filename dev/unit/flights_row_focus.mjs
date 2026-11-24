// Focus after the flight popup closes (49-flights.js): the popup gives the focus back to the row it was opened from. The
// tile redraws its rows on every state change, so that row is usually replaced while the popup is open; the core then falls
// back to the tile card. Here the focus goes to the new row of the same flight instead. Only the Flights tile's own card
// counts: another card that takes the focus later must not pull it into this list.
//   node dev/unit/flights_row_focus.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#open,flight,rowFrom,deepAll,airborne,liveHidden,liveHtml
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');
const MIN = 60000;
const T0 = 1800000000000;
let now = T0;

// Window listeners by type, fired by hand (as the browser would fire them).
const listeners = {};
const fire = (type, ev) => (listeners[type] || []).forEach((fn) => fn(ev));
let focused = null;
const opened = [];
let rows = [];
const ctx = {
  console,
  Date: { now: () => now },
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => null, get activeElement() { return focused; },
    querySelectorAll: (sel) => (sel === '[data-flights-row]' ? rows.filter((r) => r.isConnected) : []) },
  setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {},
  addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
  _casoraNotifyOpenViaCard: (src, cb, card) => { opened.push(card.variables); },
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const F = ctx._casoraFlights;

// The Flights tile's card (#card) holds its list, so every row of the tile answers getRootNode() with that root.
const tileCard = { tagName: 'HA-CARD', id: 'card', focus() { focused = this; } };
const tileRoot = { querySelector: (sel) => (sel === '#card' ? tileCard : null) };
// Another tile's card: it has no flight rows.
const otherCard = { tagName: 'HA-CARD', id: 'card', focus() { focused = this; } };

// A row button of the tile, as the tile draws it, and a focus that records itself.
const makeRow = (key) => {
  const r = { tagName: 'BUTTON', isConnected: true, attrs: { 'data-flights-row': '', 'data-flights-src': 'sensor.a', 'data-flights-key': key, 'data-flights-label': key },
    hasAttribute(n) { return n in this.attrs; }, getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; },
    getRootNode() { return tileRoot; },
    focusCount: 0, focus() { this.focusCount++; focused = this; } };
  return r;
};
// Focus moves the way the browser moves it: the element takes it, and focusin fires with its composed path.
const focusin = (target, path = [target]) => { focused = target; fire('focusin', { target, composedPath: () => path }); };
const click = (row) => fire('click', { composedPath: () => [row], target: row, stopPropagation() {}, preventDefault() {} });

// A flight that qualifies now: airborne, observed moving (as the airborne tests set it up).
const fl = (extra = {}) => ({
  id: 'h1', flight_number: 'XY123', callsign: 'TST123', aircraft_registration: 'T-AAAA', tracked_type: 'live', on_ground: 0,
  latitude: 51, longitude: 4.5, altitude: 31000, ground_speed: 450, heading: 90, vertical_speed: 0, airline_short: 'Testair',
  airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB', details_updated_at: T0, ...extra,
});
const hass = { entities: {}, states: {}, connection: { addEventListener() {} } };
const source = (flights) => {
  hass.entities = { 'sensor.a': { entity_id: 'sensor.a', platform: 'flightradar24', device_id: 'd1', translation_key: 'additional_tracked' } };
  hass.states = { 'sensor.a': { entity_id: 'sensor.a', state: String(flights.length), attributes: { flights } } };
};
source([fl()]); now = T0; F.liveHidden(hass, T0);
source([{ ...fl(), latitude: 51.05 }]); now = T0 + 2 * MIN; F.liveHidden(hass, T0 + 2 * MIN);
now = T0 + 3 * MIN;

// Hass for the popup's flight lookup: the page's home-assistant element, as the tile's handlers read it.
ctx.document.querySelector = (sel) => (sel === 'home-assistant' ? { hass } : null);

const popup = { tagName: 'CASORA-POPUP' };
const inner = { tagName: 'BUTTON' };

// Open the flight from its row, the popup takes the focus; then the tile redraws the row for the same flight.
// Returns the new row.
const openAndRedraw = () => {
  const rowA = makeRow('h1');
  rows = [rowA];
  focused = rowA;
  const before = opened.length;
  click(rowA);
  assert.equal(opened.length, before + 1, 'precondition: the flight popup opened from the row');
  focusin(inner, [inner, popup]);
  rowA.isConnected = false;
  const rowB = makeRow('h1');
  rows = [rowB];
  return rowB;
};

// 1. The popup closes and the focus falls to the tile card: the row of the same flight takes it.
let rowB = openAndRedraw();
focusin(tileCard, [tileCard]);
assert.equal(focused, rowB, 'the popup closed onto the tile card: the focus is on the new row of the same flight');
assert.equal(rowB.focusCount, 1, 'the new row takes the focus once');

// 2. The popup closes and the focus goes nowhere (no focusin). Then another tile's card takes the focus: it must not
//    be pulled into the flight list.
rowB = openAndRedraw();
focused = null;
fire('casora-popup-closed', { target: popup });
focusin(otherCard, [otherCard]);
assert.equal(focused, otherCard, 'after the popup closed, another tile\'s card keeps the focus');
assert.equal(rowB.focusCount, 0, 'the flight row is not focused by another card');

// 3. While the popup is still closing, a focus on another tile\'s card is not the Flights card: no redirect.
rowB = openAndRedraw();
focusin(otherCard, [otherCard]);
assert.equal(focused, otherCard, 'a card that is not the Flights tile card does not get the row focus');
assert.equal(rowB.focusCount, 0, 'the flight row is not focused by another card');

console.log('ok: flights row focus');
