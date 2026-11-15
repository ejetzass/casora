// #167: "Automatic" is the device's own clock, whatever sensor.time does (missing, usable, unavailable,
// unknown, empty). A time sensor chosen in the Studio stays the clock; without a usable state it shows
// nothing, never the device clock (#112).   node dev/unit/uhr_zeitquelle.mjs
// @deckt: dashboards/casora/button_card_templates.json#casora_time,casora_room, custom_components/casora/scripts/casora-core.js#casoraClockText,casoraClockHtml
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (f) => fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const core = read('custom_components/casora/scripts/casora-core.js');
const a = core.indexOf('    window.casoraClockText = function');
const b = core.indexOf('    if (!customElements.get(\'casora-clock\'))', a);
assert.ok(a > 0 && b > a, 'clock helpers in casora-core.js');
const window = {};
const hassRoot = { locale: { time_zone: 'server' }, config: { time_zone: 'Europe/Berlin' } };
const document = { querySelector: () => ({ hass: hassRoot }) };
new Function('window', 'document', core.slice(a, b))(window, document);

const T = JSON.parse(read('dashboards/casora/button_card_templates.json'));
const js = (s) => s.trim().replace(/^\[\[\[/, '').replace(/\]\]\]$/, '');
// The room hands the Studio's choice on to the clock tile.
const roomTimeEntity = (roomVars) =>
  new Function('hass', 'states', 'variables', js(T.casora_room.custom_fields.time.card.variables.time_entity))({}, {}, roomVars);
const name = (states, variables) =>
  new Function('window', 'states', 'hass', 'variables', js(T.casora_time.name))(window, states, hassRoot, variables);
const CLOCK = /^<casora-clock /;
const withState = (state) => (state === undefined ? {} : { 'sensor.time': { state } });

// The choice itself: nothing chosen is Automatic, a chosen sensor is that sensor.
assert.equal(roomTimeEntity({}), '', 'no entry in the Studio: Automatic');
assert.equal(roomTimeEntity({ time_entity: 'sensor.time' }), 'sensor.time', 'a chosen sensor is passed on');

// Automatic: the device's clock, whatever sensor.time holds.
for (const state of [undefined, '08:13', 'unavailable', 'unknown', '']) {
  const shown = name(withState(state), { use_12h: false });
  assert.match(shown, CLOCK, `Automatic with sensor.time "${state}": the device clock`);
  assert.ok(shown.includes(window.casoraClockText(hassRoot, false)),
    `Automatic with sensor.time "${state}": the device's time, not the sensor's state`);
}
assert.match(name({}, { use_12h: true }), /data-h12="1"/, 'Automatic: the 12-hour setting reaches the device clock');
assert.match(name({}, { show_date: true }), /data-date="1"/, 'Automatic: the date line too');
assert.match(name({}, { time_suffix: 'Uhr' }), /data-suffix="Uhr"/, 'Automatic: the suffix reaches the device clock');

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
