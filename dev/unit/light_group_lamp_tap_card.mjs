// A lamp tapped in a light-group popup (ll-custom casora_light_more_info) opens the hand-built casora_light card with
// its _title. openViaCard takes an options object since the ring popup change: the card config belongs in { cfg }.
//   node dev/unit/light_group_lamp_tap_card.mjs
// @deckt: custom_components/casora/scripts/local/01-basis.js#casora_light_more_info
import fs from 'node:fs';
import assert from 'node:assert/strict';

const basis = fs.readFileSync(new URL('../../custom_components/casora/scripts/local/01-basis.js', import.meta.url), 'utf8');
const a = basis.indexOf("window.addEventListener('ll-custom'");
const b = basis.indexOf('}, true);', a) + '}, true);'.length;
assert.ok(a > 0 && b > a, 'handler found');
const calls = [];
let handler;
const window = { addEventListener: (type, fn) => { if (type === 'll-custom') handler = fn; } };
const document = { querySelector: () => ({ hass: { states: {
  'light.mock_lamp': { attributes: { friendly_name: 'Mock lamp' } },
  'light.mock_group': { attributes: { entity_id: ['light.mock_lamp'] } },
} } }) };
new Function('window', 'document', 'openViaCard', 'Array', 'Date', 'String', basis.slice(a, b))(
  window, document, (id, done, o) => calls.push({ id, done, o }), Array, Date, String);
const ev = (id) => ({ detail: { event_data: { casora_light_more_info: id } }, stopPropagation() {} });

handler(ev('light.mock_lamp'));
assert.equal(calls.length, 1, 'a lamp tap opens a popup');
const o = calls[0].o;
assert.equal(calls[0].id, 'light.mock_lamp');
assert.equal(o.type, undefined, 'the card config is not passed as the options object');
assert.equal(o.cfg?.template, 'casora_light', 'the hand-built lamp card');
assert.equal(o.cfg?.entity, 'light.mock_lamp');
assert.equal(o.cfg?._title, 'Mock lamp', 'with its title');
handler(ev('light.mock_group'));
assert.equal(calls.length, 1, 'a group stays with the module');
console.log('light group: lamp tap opens the casora_light card OK');
