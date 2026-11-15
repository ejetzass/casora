// #167: "Automatic" is the device's own clock, whatever sensor.time does (missing, usable, unavailable,
// unknown, empty). A time sensor chosen in the Studio stays the clock; without a usable state it shows
// nothing, never the device clock (#112).   node dev/unit/uhr_zeitquelle.mjs
// @deckt: dashboards/casora/button_card_templates.json#casora_time,casora_room, custom_components/casora/scripts/casora-core.js#casoraClockText,casoraClockHtml
import fs from 'node:fs';
import assert from 'node:assert/strict';

// A fixed clock and a fixed device zone: the expected times below are literals, never a second read of the clock.
// 2026-11-11 13:05 UTC is 14:05 in Berlin (the device) and 22:05 in Tokyo (the Home Assistant server zone).
process.env.TZ = 'Europe/Berlin';
const RealDate = Date;
const FIXED = RealDate.UTC(2026, 10, 11, 13, 5);
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(FIXED);
  }
  static now() { return FIXED; }
};

const read = (f) => fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const core = read('custom_components/casora/scripts/casora-core.js');
const a = core.indexOf('    window.casoraClockText = function');
const b = core.indexOf('    if (!customElements.get(\'casora-clock\'))', a);
assert.ok(a > 0 && b > a, 'clock helpers in casora-core.js');
const window = {};
const SERVER = { locale: { time_zone: 'server' }, config: { time_zone: 'Asia/Tokyo' } };
const LOCAL = { locale: { time_zone: 'local' }, config: { time_zone: 'Asia/Tokyo' } };
// The Home Assistant root the clock reads its profile from; switched per case below.
const root = { hass: SERVER };
const document = { querySelector: () => root };
new Function('window', 'document', core.slice(a, b))(window, document);

const T = JSON.parse(read('dashboards/casora/button_card_templates.json'));
const js = (s) => s.trim().replace(/^\[\[\[/, '').replace(/\]\]\]$/, '');
// The room hands the Studio's choice on to the clock tile.
const roomTimeEntity = (roomVars) =>
  new Function('hass', 'states', 'variables', js(T.casora_room.custom_fields.time.card.variables.time_entity))({}, {}, roomVars);
const name = (states, variables) =>
  new Function('window', 'states', 'hass', 'variables', js(T.casora_time.name))(window, states, root.hass, variables);
const CLOCK = /^<casora-clock /;
const withState = (state) => (state === undefined ? {} : { 'sensor.time': { state } });

// The choice itself: nothing chosen is Automatic, a chosen sensor is that sensor.
assert.equal(roomTimeEntity({}), '', 'no entry in the Studio: Automatic');
assert.equal(roomTimeEntity({ time_entity: 'sensor.time' }), 'sensor.time', 'a chosen sensor is passed on');

// Automatic, profile "server": the device's clock in Home Assistant's zone, whatever sensor.time holds.
for (const state of [undefined, '08:13', 'unavailable', 'unknown', '']) {
  const shown = name(withState(state), { use_12h: false });
  assert.match(shown, CLOCK, `Automatic with sensor.time "${state}": the device clock`);
  assert.equal(shown, '<casora-clock data-h12="" data-suffix="">22:05</casora-clock>',
    `Automatic with sensor.time "${state}": the time in Home Assistant's zone, not the sensor's state`);
}
assert.match(name({}, { use_12h: true }), /data-h12="1"/, 'Automatic: the 12-hour setting reaches the device clock');
assert.match(name({}, { show_date: true }), /data-date="1"/, 'Automatic: the date line too');
assert.match(name({}, { time_suffix: 'Uhr' }), /data-suffix="Uhr"/, 'Automatic: the suffix reaches the device clock');

// Automatic, profile "local": the device's zone (Berlin, 14:05), through the tile and the 12-hour option.
root.hass = LOCAL;
assert.equal(name({ 'sensor.time': { state: '08:13' } }, { use_12h: false }),
  '<casora-clock data-h12="" data-suffix="">14:05</casora-clock>', 'profile "local": the device zone, sensor.time ignored');
assert.equal(name({}, { use_12h: true }),
  '<casora-clock data-h12="1" data-suffix="">2:05 PM</casora-clock>', 'profile "local": 12-hour clock in the device zone');
root.hass = SERVER;

// A sensor chosen in the Studio: its state is the clock.
assert.equal(name({ 'sensor.time': { state: '08:13' } }, { time_entity: 'sensor.time', use_12h: false }), '08:13', 'sensor.time');
assert.equal(name({ 'sensor.time': { state: '20:05' } }, { time_entity: 'sensor.time', use_12h: true }), '8:05 PM', '12-hour conversion stays');
assert.equal(name({ 'sensor.chosen_clock': { state: '07:07' } }, { time_entity: 'sensor.chosen_clock' }), '07:07', 'another chosen sensor');
assert.equal(name({ 'sensor.time': { state: '08:13' } }, { time_entity: 'sensor.time', time_suffix: 'Uhr' }), '08:13 UHR', 'the suffix stays');

// A chosen sensor that is missing or has no usable state: nothing, no fallback to the device clock.
for (const state of [undefined, 'unavailable', 'unknown', '']) {
  assert.equal(name(withState(state), { time_entity: 'sensor.time' }), '', `chosen sensor.time "${state}": empty`);
}
assert.equal(name({}, { time_entity: 'sensor.gone_clock' }), '', 'a chosen sensor that is gone: empty');

console.log('uhr_zeitquelle: ok');
