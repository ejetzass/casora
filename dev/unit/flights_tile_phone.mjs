// The Flights tile on a phone (49-flights.js): one line, "N in the air", and one button for the whole tile. One airborne
// flight opens its popup (F.open); two or more open the list popup (casora_popup_flights_list), one full row per flight in
// F.airborne's order. Desktop keeps its rows. The phone check is the tile CSS's media query, read with matchMedia.
// Controlled fake page: the phone flag is set by the test. Synthetic data only.
//   node dev/unit/flights_tile_phone.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#liveHtml,liveHidden,airborne,phone,tapTile,openList,open,flight,listRows,listStage,listPopup,sec,popup,defineTileList,setTileMode,closeListPopup
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');
const MIN = 60000;
const T0 = 1800000000000;

// The phone flag: the tile CSS's media query matches when this is true (any query string with the 767px rule).
let phone = false;
const calls = [];
const pending = [];
const mqChange = []; // the phone query's change listeners (resize, rotation)
const flush = () => { pending.splice(0).forEach((fn) => fn()); };
const listeners = {};
const defined = {};
class FakeHTMLElement {
  constructor() { this._attrs = {}; this._root = null; }
  setAttribute(n, v) { this._attrs[n] = String(v); }
  getAttribute(n) { return n in this._attrs ? this._attrs[n] : null; }
  getRootNode() { return this._root; }
}
// The module reads Date.now(): a clock the test sets, so the flights are read at the time the test means.
let clock = T0;
class FakeDate extends Date { static now() { return clock; } }
const ctx = {
  console, Date: FakeDate, Math, Intl, JSON,
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: (sel) => (sel === 'home-assistant' ? { hass } : null), querySelectorAll: () => [],
    createElement: (tag) => ({ tag, textContent: '', setAttribute(n, v) { this[n] = String(v); } }) },
  // Timers are kept, so a test runs them by hand (flush below).
  setTimeout: (fn) => { pending.push(fn); return { live: false }; }, clearTimeout() {},
  addEventListener: (n, fn) => { (listeners[n] = listeners[n] || []).push(fn); },
  HTMLElement: FakeHTMLElement,
  customElements: { get: (n) => defined[n], define: (n, c) => { defined[n] = c; } },
  matchMedia: (q) => ({ matches: phone && q.includes('max-width:767px'),
    addEventListener(n, fn) { if (n === 'change') mqChange.push(fn); } }),
  // The page's stage and empty pieces, reduced to their text (the test reads the text, not the layout).
  _casoraUI: { stage: (kind, o) => `<p>${o.text}</p>`, empty: (o) => `<p>${o.text}</p>` },
  // The popup opener: records the card config it is given, as the page would open that popup.
  _casoraNotifyOpenViaCard: (src, done, cfg) => { calls.push({ src, cfg }); return true; },
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
// A live, airborne synthetic flight with its airports.
const fl = (id, extra = {}) => ({
  id, flight_number: 'XY' + id, callsign: 'TST' + id, aircraft_registration: 'T-AAAA', tracked_type: 'live', on_ground: 0,
  latitude: 51, longitude: 4.5, altitude: 31000, ground_speed: 450, heading: 90, vertical_speed: 0, airline_short: 'Testair',
  airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB', details_updated_at: T0,
  airport_origin_latitude: 50, airport_origin_longitude: 4, airport_destination_latitude: 52, airport_destination_longitude: 5, ...extra,
});
// Observed at a first time, moved at a later one, then drawn (as the tile does). Each call starts later in time.
let base = T0;
const seen = (flights) => {
  base += 10 * MIN;
  setSource(flights);
  F.liveHidden(hass, base);
  setSource(flights.map((f) => ({ ...f, latitude: f.latitude + 0.05 })));
  F.liveHidden(hass, base + 2 * MIN);
  clock = base + 3 * MIN;
  return clock;
};
const text = (html) => html.replace(/<[^>]*>/g, '');

// ── Desktop: the rows, as before ───────────────────────────────────────────────────────────────────────────────────
phone = false;
const two = [fl('1'), fl('2')];
let now = seen(two);
let html = F.liveHtml(hass, '', now, 'Flüge');
assert.equal((html.match(/data-flights-row/g) || []).length, 2, 'desktop: one row button per flight');
assert.doesNotMatch(html, /data-flights-sum/, 'desktop: no one-line summary');

// ── Phone: one line, one button, no rows ───────────────────────────────────────────────────────────────────────────
phone = true;
now = seen(two);
html = F.liveHtml(hass, '', now, 'Flüge');
assert.equal(text(html), '2 in der Luft', 'phone: the tile shows one line, the count of airborne flights');
assert.match(html, /data-flights-sum/, 'phone: the summary element is marked');
assert.doesNotMatch(html, /data-flights-row|<button|<br>/, 'phone: no row buttons and no second line');
assert.doesNotMatch(html, /<style/i, 'phone: no CSS in the tile text');
assert.equal(text(F.liveHtml(hass, '', seen([fl('3')]), 'Flüge')), '1 in der Luft', 'phone: one flight, one line');

// ── Phone tap: one flight opens its popup, two or more the list popup ───────────────────────────────────────────────
calls.length = 0;
seen(two);
F.tapTile(hass);
assert.equal(calls.length, 1, 'phone tap with two flights opens one popup');
assert.equal(calls[0].cfg.template, 'casora_popup_flights_list', 'two flights: the list popup');
assert.equal(calls[0].cfg.variables, undefined, 'the list popup config carries no text: its name is the template constant');

calls.length = 0;
now = seen([fl('4')]);
F.tapTile(hass);
assert.equal(calls.length, 1, 'phone tap with one flight opens one popup');
assert.equal(calls[0].cfg.template, 'casora_popup_flight', 'one flight: its popup directly');
assert.equal(calls[0].cfg.variables.flight, '4', 'one flight: the popup is for that flight');

// ── The list popup: one full row per flight, in F.airborne's order ─────────────────────────────────────────────────
now = seen(two);
const list = F.listRows(hass, { pin: '' });
const rows = [...list.matchAll(/<button[^>]*data-flights-row[^>]*>/g)].map((m) => m[0]);
assert.equal(rows.length, 2, 'the list popup has one row per flight');
const labels = F.airborne(hass, '', now).map((r) => r.label);
assert.deepEqual([...labels], ['XY1', 'XY2'], 'precondition: the airborne order'); // the vm realm's array, copied
assert.ok(list.indexOf('XY1') < list.indexOf('XY2'), 'the rows keep the airborne order');
assert.match(text(list), /AAA → BBB/, 'a row shows its route');
assert.match(text(list), /31000|31,000/, 'a row shows its altitude');
assert.equal(text(F.listStage(hass, { pin: '' })), '2 in der Luft', 'the list popup stage shows the count');

// ── The phone tile's element and tap: a plain button card, tapped as one ────────────────────────────────────────────
const attrsOf = () => { const a = {}; return { attrs: a, hasAttribute: (n) => n in a, getAttribute: (n) => (n in a ? a[n] : null),
  setAttribute: (n, v) => { a[n] = String(v); }, removeAttribute: (n) => { delete a[n]; } }; };
const card = attrsOf();
const sum = attrsOf();
const root = { host: { _config: {} }, styles: [], appendChild(n) { this.styles.push(n); },
  querySelector: (sel) => (sel === '#card' ? card : sel === '[data-flights-sum]' ? sum : null), getRootNode: null };
const onPage = (markup, attrs) => {
  const El = defined['casora-flight-list'];
  const w = new El();
  w._root = root; Object.entries(attrs).forEach(([k, v]) => w.setAttribute(k, v));
  root.getRootNode = () => root;
  w.connectedCallback();
};
phone = true;
onPage(null, { 'data-flights-sum': '' });
assert.equal(card.attrs.role, 'button', 'phone: the card is one button');
assert.equal(card.attrs['aria-label'], undefined, 'phone: no group label: the card is named by its line');
assert.equal(card.attrs['data-flights-tile-card'], '', 'phone: the card takes the tile tap');
card.getRootNode = () => root;
const tap = (target) => {
  const ev = { composedPath: () => [target], target, key: undefined, changedTouches: [], touches: [],
    preventDefault() {}, stopPropagation() {} };
  (listeners.click || []).forEach((fn) => fn(ev));
};
seen(two);
calls.length = 0;
tap(card);
assert.equal(calls.length, 1, 'a click on the phone tile opens one popup');
assert.equal(calls[0].cfg.template, 'casora_popup_flights_list', 'a click on the phone tile with two flights: the list popup');
assert.equal(calls[0].cfg.variables, undefined, 'the list config carries no text');

// Desktop: the same card without the tile marker is not a tap target for the tile.
const deskCard = attrsOf();
onPage(null, { 'data-name': 'Flüge' });
phone = false;
calls.length = 0;
tap(deskCard);
assert.equal(calls.length, 0, 'a click on a desktop card opens nothing');

// ── Review: the summary tag is real HTML ───────────────────────────────────────────────────────────────────────────
phone = true;
now = seen(two);
html = F.liveHtml(hass, '', now, 'Flüge');
const tag = html.match(/^<casora-flight-list[^>]*>/)[0];
assert.match(tag, /^<casora-flight-list data-flights-sum data-name="[^"]*" style="display:block;[^"]*overflow:hidden[^"]*">$/,
  'the summary tag has one real style attribute with display:block and overflow:hidden');
assert.doesNotMatch(tag, /=""|" [a-z-]+"|=""/, 'the summary tag has no junk attribute');

// ── Review: the card follows the phone query on every change (resize, rotation) ──────────────────────────────────
const modeOf = () => ({ role: card.attrs.role, label: card.attrs['aria-label'], marker: card.attrs['data-flights-tile-card'] });
const flipMode = () => mqChange.forEach((fn) => fn());
calls.length = 0;
phone = true;
onPage(null, { 'data-flights-sum': '', 'data-name': 'Flüge' });
assert.deepEqual(modeOf(), { role: 'button', label: undefined, marker: '' }, 'phone: a button, no label, marked');
phone = false; flipMode();
assert.deepEqual(modeOf(), { role: 'group', label: 'Flüge', marker: undefined }, 'desktop after a change: a group named by the card, no marker');
seen(two); calls.length = 0;
tap(card);
assert.equal(calls.length, 0, 'desktop after a change: a tap on the card does not run the tile tap');
phone = true; flipMode();
assert.deepEqual(modeOf(), { role: 'button', label: undefined, marker: '' }, 'phone again after a change: the button again');
calls.length = 0;
seen(two);
tap(card);
assert.equal(calls.length, 1, 'phone again: a tap on the card runs the tile tap');

// ── Review: Enter and Space on the phone tile are one tap, no second action on the release ─────────────────────────
const key = (target, k, type) => {
  const ev = { key: k, target, composedPath: () => [target], prevented: false,
    preventDefault() { this.prevented = true; }, stopPropagation() {} };
  (listeners[type] || []).forEach((fn) => fn(ev));
  return ev;
};
phone = true; calls.length = 0;
seen(two);
const enter = key(card, 'Enter', 'keydown');
assert.equal(enter.prevented, true, 'Enter on the phone tile: the default (a click) is cancelled');
assert.equal(calls.length, 1, 'Enter on the phone tile opens the list once');
calls.length = 0;
const space = key(card, ' ', 'keydown');
assert.equal(space.prevented, true, 'Space on the phone tile: the default is cancelled');
assert.equal(calls.length, 1, 'Space on the phone tile opens the list once');
const spaceUp = key(card, ' ', 'keyup');
assert.equal(spaceUp.prevented, true, 'the release of Space does not click the tile again');
assert.equal(calls.length, 1, 'the release of Space adds no second open');

// ── Review: no flight in the air, the phone tile stays hidden and empty ───────────────────────────────────────────
phone = true;
now = seen([]);
assert.equal(F.liveHidden(hass, now), true, 'phone: no flight in the air hides the tile');
assert.equal(F.liveHtml(hass, '', now, 'Flüge'), '', 'phone: no flight in the air draws nothing');
assert.equal(F.tapTile(hass), null, 'phone: a tap with no flight opens nothing');

// ── Review: the list popup does not stay open as an empty shell ─────────────────────────────────────────────────
let closedCount = 0;
ctx.casoraPopup = { element: { hasAttribute: () => true }, close() { closedCount += 1; } };
seen(two);
calls.length = 0;
F.tapTile(hass); // the list opens
assert.equal(calls.length, 1, 'precondition: the list is open');
setSource([]);
F.listRows(hass, { pin: '' });
flush();
assert.equal(closedCount, 1, 'no flight left: the open list popup closes');
F.openList(hass, 'sensor.a');
now = seen([fl('7')]);
const one = F.listRows(hass, { pin: '' });
flush();
assert.equal((one.match(/<button/g) || []).length, 1, 'one flight left: its row is still shown');
assert.equal(closedCount, 1, 'one flight left: the list stays open');
(listeners['casora-popup-closed'] || []).forEach((fn) => fn({}));
setSource([]);
F.listRows(hass, { pin: '' });
flush();
assert.equal(closedCount, 1, 'a list closed by the user is not closed again');

// ── Review: the list popup's template says what it shows (not the flight popup's comment) ───────────────────────
const templates = JSON.parse(read('dashboards/casora/button_card_templates.json'));
const listStyle = templates.casora_popup_flights_list.tap_action.casora_popup.style;
assert.match(listStyle, /F\.listRows|list of flight rows/, 'the list popup style comment names the list');
assert.doesNotMatch(listStyle, /flightSec/, 'the list popup style comment does not point at the flight popup');

console.log('ok: flights tile phone');
