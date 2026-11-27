// Tracked flights, the flight popup and the units (49-flights.js): row identity and the row tap, the popup's parts and
// what happens when its flight stops qualifying, the saved units (feet, meters, kilometers; knots, km/h, mph; ft/min,
// m/s) with rounding and zeros, and that reading, rendering and previews never write. Controlled clock; synthetic flights.
//   node dev/unit/flights_details.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#flight,airborne,liveHtml,fmt,units,setting,pinned,open,flightPopup,sec,flightSec,pairs,place,submit,stop
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');
const MIN = 60000;
const T0 = 1800000000000;

// A fresh module per runtime (a page reload). The fake page keeps the window's listeners and the opener's calls.
let F, ctx, handlers, opened, cfg;
const runtime = (extra = {}) => {
  handlers = {}; opened = []; cfg = null;
  ctx = {
    console,
    localStorage: { getItem: () => null, setItem() {} },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    setTimeout: () => ({ live: false }), clearTimeout() {},
    addEventListener: (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); },
    _casoraNotifyOpenViaCard: (...a) => { opened.push(a); return undefined; },
    _casoraUI: { stage: (type, o) => 'STAGE[' + type + ',' + o.tone + ',' + o.icon + ',' + o.text + ']', empty: () => 'EMPTY' },
    _casoraLovelaceCfg: () => cfg,
    casoraLocale: () => 'en-US',
  };
  Object.assign(ctx, extra);
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  F = ctx._casoraFlights;
  return F;
};
const house = () => {
  const hass = { entities: {}, states: {}, calls: [], callService: (...a) => { hass.calls.push(a); return Promise.resolve(); } };
  hass.source = (id, flights) => {
    hass.entities = { ...hass.entities, [id]: { entity_id: id, platform: 'flightradar24', device_id: 'd' + id, translation_key: 'additional_tracked' } };
    hass.states = { ...hass.states, [id]: { entity_id: id, state: String(flights.length), attributes: { flights } } };
  };
  return hass;
};
// A live, airborne synthetic flight (feet, knots, ft/min, degrees as the source reports them).
const fl = (id, extra = {}) => ({
  id, flight_number: 'XY123', callsign: 'TST123', aircraft_registration: 'T-AAAA', aircraft_model: 'Example 900',
  tracked_type: 'live', on_ground: 0, latitude: 10, longitude: 20, altitude: 35000, ground_speed: 450,
  heading: 270, vertical_speed: -2000, airline_short: 'Testair', airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB',
  airport_origin_name: 'Airport Alpha', airport_origin_terminal: '2', airport_destination_name: 'Airport Beta', ...extra,
});
// The rule needs an observed movement: the baseline, then a step. Returns the hass after the step.
const moving = (hass, id, flight, src = 'sensor.a', at = T0) => {
  hass.source(src, [flight]); F.airborne(hass, '', at);
  hass.source(src, [{ ...flight, latitude: flight.latitude + 0.05 }]);
  return F.airborne(hass, '', at + MIN);
};
// Calls the window's click listener the way a click on a row arrives (composed path with the row first).
const clickRow = (attrs) => {
  let stopped = false;
  const el = { hasAttribute: (a) => a in attrs, getAttribute: (a) => attrs[a] ?? null };
  const ev = { type: 'click', composedPath: () => [el], stopPropagation: () => { stopped = true; }, preventDefault() {} };
  (handlers.click || []).forEach((fn) => fn(ev));
  return { stopped };
};
const rowAttrs = (src, key, label = 'XY123') => ({ 'data-flights-row': '', 'data-flights-src': src, 'data-flights-key': key, 'data-flights-label': label });
const deep = (x) => JSON.parse(JSON.stringify(x));

// ── Units: the source values are feet, knots, feet per minute and degrees; the default setting keeps them ──
runtime();
assert.equal(F.fmt.altitude(35000, ''), '35,000\u00a0ft', 'default: feet, grouped');
assert.equal(F.fmt.speed(450, ''), '450\u00a0kn', 'default: knots');
assert.equal(F.fmt.vspeed(-2000, ''), '-2,000\u00a0ft/min', 'default: feet per minute, negative descent kept');
assert.equal(F.fmt.heading(270), '270°', 'heading in degrees');
assert.equal(F.fmt.heading(0), '0°', 'heading zero is a value');
assert.equal(F.fmt.heading(361), '', 'heading out of range is left out');

// Each unit converts from the source value and rounds to a fixed number of decimals.
assert.equal(F.fmt.altitude(35000, 'm'), '10,668\u00a0m', 'meters, whole');
assert.equal(F.fmt.altitude(35000, 'km'), '10.7\u00a0km', 'kilometers, one decimal');
assert.equal(F.fmt.altitude(0, 'm'), '0\u00a0m', 'zero meters is shown');
assert.equal(F.fmt.altitude(0, 'km'), '0.0\u00a0km', 'zero kilometers keeps its decimal');
assert.equal(F.fmt.speed(450, 'kmh'), '833\u00a0km/h', 'km/h from knots');
assert.equal(F.fmt.speed(450, 'mph'), '518\u00a0mph', 'mph from knots');
assert.equal(F.fmt.vspeed(-2000, 'ms'), '-10.2\u00a0m/s', 'negative descent in m/s');
assert.equal(F.fmt.vspeed(0, 'ms'), '0.0\u00a0m/s', 'zero vertical speed in m/s');
assert.equal(F.fmt.vspeed(-1, 'ms'), '0.0\u00a0m/s', 'a tiny negative rounds to zero, never -0.0');
assert.equal(F.fmt.altitude(NaN, 'm'), '', 'NaN is left out');
assert.equal(F.fmt.speed(undefined, 'kmh'), '', 'missing is left out, never 0');
assert.equal(F.fmt.altitude(31000, 'unknown-unit'), '31,000\u00a0ft', 'an unknown saved unit falls back to the source unit');

// Localized numbers: the page locale decides the grouping, the unit name stays.
ctx.casoraLocale = () => 'de-DE';
assert.equal(F.fmt.altitude(31000, ''), '31.000\u00a0ft', 'German grouping');
ctx.casoraLocale = () => 'en-US';
// The shared number helper (01-basis.js casoraNum) handles the number when the page has it; the local fallback
// keeps this module loadable on its own (unit tests, no 01-basis.js).
runtime({ casoraNum: (v, min) => 'N' + Number(v).toFixed(min) });
assert.equal(F.fmt.speed(450.4, ''), 'N450\u00a0kn', 'the shared casoraNum formats the number');

// The saved units reach the tile and the rows: Studio settings in the hero card's variables (Dashboard scope).
runtime();
cfg = { views: [{ cards: [{ variables: { casora_flights_altitude_unit: 'm', casora_flights_speed_unit: 'kmh', casora_flights_vspeed_unit: 'ms' } }] }] };
assert.deepEqual(deep(F.units()), { altitude: 'm', speed: 'kmh', vspeed: 'ms' });
let hass = house();
hass.source('sensor.a', [fl('u1')]); F.airborne(hass, '', T0);
hass.source('sensor.a', [{ ...fl('u1'), latitude: 10.05 }]);
const tile = F.listRows(hass, { pin: '', now: T0 + MIN });
assert.match(tile, /10,668\u00a0m · 833\u00a0km\/h/, 'the list rows show the saved units');
runtime();
cfg = null;
assert.deepEqual(deep(F.units()), { altitude: '', speed: '', vspeed: '' }, 'no saved setting: the source units');

// ── Rows: each row carries its source and FR24 ID; two flights with one number stay two rows ──
runtime(); hass = house();
hass.source('sensor.a', [fl('id-old'), fl('id-new')]); F.airborne(hass, '', T0);
hass.source('sensor.a', [{ ...fl('id-old'), latitude: 10.05 }, { ...fl('id-new'), latitude: 10.07 }]);
// Two flights: the tile is one line, and the rows are in the list popup (the same full row).
assert.doesNotMatch(F.liveHtml(hass, '', T0 + MIN), /data-flights-row/, 'two flights: no rows on the tile');
const html = F.listRows(hass, { pin: '', now: T0 + MIN });
assert.equal((html.match(/<button type="button" data-flights-row/g) || []).length, 2, 'one tappable row per flight');
assert.match(html, /data-flights-key="id-old"/);
assert.match(html, /data-flights-key="id-new"/);
assert.match(html, /data-flights-src="sensor\.a"/);
assert.match(html, /<button type="button" data-flights-row/, 'a row is a button: keyboard and screen reader operable');

// The row check is the shared rule by FR24 ID: a different ID is a different flight, even with the same number.
const now = T0 + MIN;
assert.equal(F.flight(hass, 'sensor.a', 'id-old', now).entry.id, 'id-old');
assert.equal(F.flight(hass, 'sensor.a', 'id-gone', now), null, 'an unknown ID is no flight, even with a matching number');
assert.equal(F.flight(hass, 'sensor.other', 'id-old', now), null, 'the same ID in another source is no flight');

// ── Tapping a row opens that flight's popup, and nothing else ──
runtime(); hass = house();
hass.source('sensor.a', [fl('tap-1')]); F.airborne(hass, '', T0);
hass.source('sensor.a', [{ ...fl('tap-1'), latitude: 10.05 }]);
ctx.document.querySelector = (sel) => (sel === 'home-assistant' ? { hass } : null);
let r = clickRow(rowAttrs('sensor.a', 'tap-1', 'XY123'));
assert.equal(r.stopped, true, 'the row tap does not reach the tile\'s own tap action');
assert.equal(opened.length, 1, 'one popup opens');
const [src, done, cfgOpen, noTile] = opened[0];
assert.equal(src, 'sensor.a');
assert.equal(typeof done, 'function');
assert.equal(noTile, true, 'opened from the config, not from a tile');
assert.equal(cfgOpen.template, 'casora_popup_flight');
assert.deepEqual(deep(cfgOpen.variables), { source: 'sensor.a', flight: 'tap-1' }, 'the popup gets the source and the FR24 ID, no text');
assert.equal(F.title(hass, { source: 'sensor.a', flight: 'tap-1' }), 'XY123', 'the title is the flight label from the source');
assert.equal(F.title(hass, { source: 'sensor.a', flight: 'nobody' }), 'Flug', 'an unknown flight gets the default title');
assert.deepEqual(hass.calls, [], 'a row tap issues no service call');

// A row whose flight does not qualify opens nothing (the popup follows the same rule).
clickRow(rowAttrs('sensor.a', 'nobody'));
assert.equal(opened.length, 1, 'an unknown flight opens nothing');
hass.source('sensor.a', [{ ...fl('tap-1'), on_ground: 1 }]);
clickRow(rowAttrs('sensor.a', 'tap-1'));
assert.equal(opened.length, 1, 'a landed flight opens nothing');
assert.deepEqual(hass.calls, [], 'still no service call');

// ── The popup's parts, from the same rule ──
runtime(); hass = house();
hass.source('sensor.a', [fl('p1')]); F.airborne(hass, '', T0);
hass.source('sensor.a', [{ ...fl('p1'), latitude: 10.05 }]);
const c = { src: 'sensor.a', flight: 'p1' };
assert.equal(F.sec('fstage', c, hass.states, hass), 'STAGE[status,good,mdi:airplane,AAA → BBB]', 'the route in the stage');
const move = F.sec('fmove', c, hass.states, hass);
assert.match(move, /Höhe/); assert.match(move, /35,000\u00a0ft/);
assert.match(move, /Geschwindigkeit über Grund/); assert.match(move, />450\u00a0kn</);
assert.match(move, /-2,000\u00a0ft\/min/, 'negative descent is shown');
assert.match(move, /270°/);
const air = F.sec('fair', c, hass.states, hass);
assert.match(air, /Testair/); assert.match(air, /Example 900/); assert.match(air, /T-AAAA/); assert.match(air, /TST123/);
const places = F.sec('ftimes', c, hass.states, hass);
assert.match(places, /AAA · Airport Alpha · Terminal 2/, 'airport code, name and terminal');
assert.match(places, /BBB · Airport Beta/, 'a missing terminal is left out, no blank term');
assert.doesNotMatch(places, /Terminal\s*<\/div>/);

// Zero is shown, sparse data leaves its row out and a section without rows is no section at all.
runtime(); hass = house();
hass.source('sensor.a', [fl('z1', { altitude: 0, vertical_speed: 0, heading: 0, ground_speed: 0 })]); F.airborne(hass, '', T0);
hass.source('sensor.a', [{ ...fl('z1', { altitude: 0, vertical_speed: 0, heading: 0, ground_speed: 0 }), latitude: 10.05 }]);
const zc = { src: 'sensor.a', flight: 'z1' };
const zmove = F.sec('fmove', zc, hass.states, hass);
assert.match(zmove, /0\u00a0ft/); assert.match(zmove, /0\u00a0ft\/min/); assert.match(zmove, /0°/);
hass.source('sensor.a', [{ id: 'sp', flight_number: 'XY123', tracked_type: 'live', on_ground: 0, latitude: 10, longitude: 20, altitude: undefined, ground_speed: NaN, airport_origin_code_iata: undefined, airport_destination_code_iata: undefined }]);
F.airborne(hass, '', T0);
hass.source('sensor.a', [{ id: 'sp', flight_number: 'XY123', tracked_type: 'live', on_ground: 0, latitude: 10.05, longitude: 20, altitude: undefined, ground_speed: NaN }]);
const sc = { src: 'sensor.a', flight: 'sp' };
assert.equal(F.sec('fmove', sc, hass.states, hass), '', 'no movement value: no plate at all');
assert.equal(F.sec('ftimes', sc, hass.states, hass), '', 'no airports and no times: no plate');
assert.equal(F.sec('fair', sc, hass.states, hass), '', 'no aircraft details: no plate');
assert.equal(F.sec('fstage', sc, hass.states, hass), '', 'no route: no stage text');

// ── The aircraft row: the model, or the aircraft code when FR24 gives no model ──
runtime(); hass = house();
const noModel = (extra) => fl('ac1', { aircraft_model: undefined, aircraft_code: 'B738', ...extra });
hass.source('sensor.a', [noModel()]); F.airborne(hass, '', T0);
hass.source('sensor.a', [{ ...noModel(), latitude: 10.05 }]);
const ac1 = { src: 'sensor.a', flight: 'ac1' };
assert.match(F.sec('fair', ac1, hass.states, hass), /B738/, 'the aircraft code stands in for a missing model');
assert.match(F.sec('fair', ac1, hass.states, hass), /Flugzeugmodell/, 'the code stands in the model row');
assert.doesNotMatch(F.sec('fair', ac1, hass.states, hass), /Example 900/, 'no model, no model text');

runtime(); hass = house();
hass.source('sensor.a', [fl('ac2', { aircraft_code: 'B738' })]); F.airborne(hass, '', T0);
hass.source('sensor.a', [{ ...fl('ac2', { aircraft_code: 'B738' }), latitude: 10.05 }]);
const ac2 = { src: 'sensor.a', flight: 'ac2' };
assert.match(F.sec('fair', ac2, hass.states, hass), /Example 900/, 'the model wins over the aircraft code');
assert.doesNotMatch(F.sec('fair', ac2, hass.states, hass), /B738/, 'the code is left out when the model is there');

runtime(); hass = house();
hass.source('sensor.a', [fl('ac3', { aircraft_model: undefined, aircraft_code: undefined })]); F.airborne(hass, '', T0);
hass.source('sensor.a', [{ ...fl('ac3', { aircraft_model: undefined, aircraft_code: undefined }), latitude: 10.05 }]);
const ac3 = F.sec('fair', { src: 'sensor.a', flight: 'ac3' }, hass.states, hass);
assert.doesNotMatch(ac3, /Flugzeugmodell/, 'no model and no code: the row is left out');
assert.match(ac3, /Testair/, 'the other rows stay');

// Texts from the source are escaped (a name cannot inject markup into the popup).
runtime(); hass = house();
hass.source('sensor.a', [fl('e1', { airline_short: '<b>X</b>' })]); F.airborne(hass, '', T0);
hass.source('sensor.a', [{ ...fl('e1', { airline_short: '<b>X</b>' }), latitude: 10.05 }]);
assert.match(F.sec('fair', { src: 'sensor.a', flight: 'e1' }, hass.states, hass), /&lt;b&gt;X&lt;\/b&gt;/);

// ── A popup whose flight stops qualifying: unavailable, no details, never another flight with the same number ──
runtime(); hass = house();
hass.source('sensor.a', [fl('g1'), fl('g2')]); F.airborne(hass, '', T0);
hass.source('sensor.a', [{ ...fl('g1'), latitude: 10.05 }, { ...fl('g2'), latitude: 10.05 }]);
const gc = { src: 'sensor.a', flight: 'g1' };
assert.match(F.sec('fstage', gc, hass.states, hass), /STAGE\[status,good/);
// The flight lands: its ID stays in the list, but the ground flag hides it at once.
hass.source('sensor.a', [{ ...fl('g1'), on_ground: 1, latitude: 10.1 }, { ...fl('g2'), latitude: 10.1 }]);
assert.equal(F.sec('fstage', gc, hass.states, hass), 'STAGE[status,off,mdi:airplane-off,Nicht verfügbar]', 'landed: unavailable stage');
assert.equal(F.sec('fmove', gc, hass.states, hass), '', 'landed: no live details');
assert.equal(F.sec('fair', gc, hass.states, hass), '');
assert.equal(F.sec('ftimes', gc, hass.states, hass), '');
// The flight is replaced by one with the same number and another ID: the popup does not follow it.
hass.source('sensor.a', [fl('g3', { latitude: 10.2 }), { ...fl('g2'), latitude: 10.2 }]);
assert.equal(F.sec('fstage', gc, hass.states, hass), 'STAGE[status,off,mdi:airplane-off,Nicht verfügbar]', 'replaced ID: unavailable, not the new flight');
// The source is gone: the popup is unavailable as well.
hass.states = {};
assert.equal(F.sec('fstage', { src: 'sensor.a', flight: 'g2' }, hass.states, hass), 'STAGE[status,off,mdi:airplane-off,Nicht verfügbar]');

// Ten minutes without observed movement hide the flight from the popup too (controlled clock, no sleep).
runtime(); hass = house();
moving(hass, 'h1', fl('h1'));
assert.ok(F.flight(hass, 'sensor.a', 'h1', T0 + MIN + 9 * MIN), 'still shown inside the window');
assert.equal(F.flight(hass, 'sensor.a', 'h1', T0 + MIN + 10 * MIN), null, 'hidden after the window');

// ── The popup content (casora_popup_flight): one part per card, each card watches the source ──
runtime(); hass = house();
hass.source('sensor.a', [fl('k1')]); F.airborne(hass, '', T0);
hass.source('sensor.a', [{ ...fl('k1'), latitude: 10.05 }]);
ctx._casoraSoftKit = { secCard: (watch, code) => ({ watch, code }), layout: (o) => o };
const pop = F.flightPopup(hass.states, hass, { source: 'sensor.a', flight: 'k1' });
assert.deepEqual(Object.keys(pop.fields).sort(), ['air', 'map', 'move', 'prog', 'stage', 'times']);
assert.deepEqual(deep(pop.fields.move.card.watch), ['sensor.a'], 'the popup redraws when the source changes');
// The card's code is run the way the Studio runs it: with the states and the hass of the render.
const runPart = (field) => vm.runInContext('(function (states, hass) {' + field.card.code + '})', ctx)(hass.states, hass);
assert.match(runPart(pop.fields.move), /35,000\u00a0ft/, 'the card runs the sec() part for its flight');
assert.ok(F.flightPopup(hass.states, hass, {}).fields, 'no flight chosen: the popup still builds, its stage says unavailable');
ctx._casoraSoftKit = undefined;

// ── Previews and renders never write: a tile, a row and the popup parts leave the service calls empty ──
runtime(); hass = house();
hass.source('sensor.a', [fl('w1')]); F.airborne(hass, '', T0);
hass.source('sensor.a', [{ ...fl('w1'), latitude: 10.05 }]);
F.liveHtml(hass, '', T0 + MIN); F.sec('fmove', { src: 'sensor.a', flight: 'w1' }, hass.states, hass);
F.sec('fstage', { src: 'sensor.a', flight: 'w1' }, hass.states, hass);
assert.deepEqual(hass.calls, [], 'rendering issues no service call');

// ── Keyboard: Enter and Space on a focused row open its popup, as a tap does, and no tile tip follows ──
const keyRow = (type, key, attrs) => {
  let prevented = false, stopped = false;
  const el = { hasAttribute: (a) => a in attrs, getAttribute: (a) => attrs[a] ?? null };
  const ev = { type, key, composedPath: () => [el], stopPropagation: () => { stopped = true; }, preventDefault: () => { prevented = true; } };
  (handlers[type] || []).forEach((fn) => fn(ev));
  return { prevented, stopped };
};
runtime(); hass = house();
hass.source('sensor.a', [fl('key-1')]); F.airborne(hass, '', T0);
hass.source('sensor.a', [{ ...fl('key-1'), latitude: 10.05 }]);
ctx.document.querySelector = (sel) => (sel === 'home-assistant' ? { hass } : null);
let kr = keyRow('keydown', 'Enter', rowAttrs('sensor.a', 'key-1', 'XY123'));
assert.equal(opened.length, 1, 'Enter opens the flight popup');
assert.equal(kr.prevented, true, 'Enter: no synthetic click after it');
assert.equal(kr.stopped, true, 'Enter: the tile does not show its tip for the keyboard');
kr = keyRow('keydown', ' ', rowAttrs('sensor.a', 'key-1', 'XY123'));
assert.equal(opened.length, 2, 'Space opens the flight popup');
kr = keyRow('keyup', ' ', rowAttrs('sensor.a', 'key-1', 'XY123'));
assert.equal(kr.prevented, true, 'Space: the release sends no click');
keyRow('keydown', 'Tab', rowAttrs('sensor.a', 'key-1', 'XY123'));
assert.equal(opened.length, 2, 'other keys open nothing');
assert.deepEqual(hass.calls, [], 'keyboard opening issues no service call');

// ── Popup rows: text wraps inside the row, labels keep full contrast, no nowrap in the plates ──
runtime(); hass = house();
hass.source('sensor.a', [fl('wrap-1', { airline_short: 'Testair', aircraft_model: 'Example Extraordinarily Long Aircraft Model 9000-Series', airport_origin_timezone_offset: 3600 })]);
F.airborne(hass, '', T0); hass.source('sensor.a', [{ ...fl('wrap-1'), latitude: 10.05, aircraft_model: 'Example Extraordinarily Long Aircraft Model 9000-Series' }]);
const part = F.sec('fair', { src: 'sensor.a', flight: 'wrap-1' }, hass.states, hass);
assert.match(part, /Example Extraordinarily/, 'the plate has the long value');
assert.doesNotMatch(part, /nowrap/, 'no plate text is set to nowrap');
assert.match(part, /white-space:normal/, 'plate text wraps');
assert.doesNotMatch(part, /opacity:\.75/, 'plate labels keep full contrast (colour token)');

console.log('ok flights_details');
