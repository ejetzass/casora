// Frigate popup choices are shared by all tiles and work without a tile.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../custom_components/casora/scripts/local/25-camera-popup.js', import.meta.url), 'utf8');
const id = 'camera.mock_frigate';
const hass = { entities: {}, states: {} };
const window = { _casoraFrigate: { is: (_h, camera) => camera === id, popup: (_e, _s, _h, vars) => vars } };
new Function('window', 'document', source)(window, { querySelector: () => ({ hass }) });
const popup = { stream_popup: 'main', stream_popup_phone: 'sub' };
const config = { views: [{ path: 'home', cards: [
  { template: 'casora_room', variables: { casora_camera_settings: { [id]: { popup, open: { ring: 'always' } } } } },
  { type: 'custom:button-card', template: 'casora_frigate', entity: id, variables: { stream_popup: 'old', stream_popup_phone: 'old-phone' } },
  { type: 'custom:button-card', template: 'casora_frigate', entity: id, variables: { stream_popup: 'other' } },
] }] };
window._casoraLovelaceCfg = () => config;
for (const stream of ['old', 'other']) {
  const result = window.casoraCameraPopup.content({ entity_id: id }, {}, hass, { stream_popup: stream }).content;
  assert.equal(result.stream_popup, 'main');
  assert.equal(result.stream_popup_phone, 'sub');
}
delete popup.stream_popup;
delete popup.stream_popup_phone;
const before = structuredClone(config);
const fallback = window.casoraCameraPopup.content({ entity_id: id }, {}, hass, {}).content;
assert.equal(fallback.stream_popup, 'old');
assert.equal(fallback.stream_popup_phone, 'old-phone');
assert.deepEqual(config, before, 'fallback never writes to the dashboard');
popup.stream_popup_phone = 'standard';
assert.equal(window.casoraCameraPopup.content({ entity_id: id }, {}, hass, {}).content.stream_popup, 'old');
assert.equal(window.casoraCameraPopup.content({ entity_id: id }, {}, hass, {}).content.stream_popup_phone, 'standard');
popup.stream_popup = 'main';
popup.stream_popup_phone = 'sub';
config.views[0].cards.splice(1);
const withoutTile = window.casoraCameraPopup.content({ entity_id: id }, {}, hass, {}).content;
assert.equal(withoutTile.stream_popup, 'main');
assert.equal(withoutTile.stream_popup_phone, 'sub');
let opened;
window._casoraNotifyOpenViaCard = (_id, done, card) => { opened = card; done(true); };
window.casoraCameraPopup.open(id);
assert.equal(opened.variables.stream_popup, 'main', 'the source-less opener uses the dashboard choice');
assert.equal(opened.variables.stream_popup_phone, 'sub');
const personal = fs.readFileSync(new URL('../../custom_components/casora/panel/casora-panel-personal.js', import.meta.url), 'utf8');
new Function('window', 'customElements', personal)(window, { get: () => null, whenDefined: () => ({ then() {} }) });
const rooms = [{ tiles: [{ entity: id, variables: { stream_popup: 'legacy', stream_popup_phone: 'legacy-phone' } }] }];
const section = { stream_popup_phone: 'standard' };
const untouched = structuredClone({ rooms, section });
assert.deepEqual(window.casoraPersonal.cameraPopupValues({ entity_id: id }, hass, rooms, section),
  { stream_popup: 'legacy', stream_popup_phone: 'standard' }, 'each field independently resolves section then tile');
assert.deepEqual({ rooms, section }, untouched);
const types = fs.readFileSync(new URL('../../custom_components/casora/panel/casora-panel-types.js', import.meta.url), 'utf8');
const frigate = types.slice(types.indexOf('{ id: "casora_frigate"'), types.indexOf('{ id: "casora_reolink_doorbell"'));
assert.match(frigate, /settingsLink: "cameras"/);
assert.doesNotMatch(frigate, /key: "stream_popup(?:_phone)?"/);
for (const field of ['live_tile', 'stream_tile', 'stream_tile_phone', 'refresh_s']) {
  assert.ok(frigate.includes(`key: "${field}"`), `${field} stays in the tile editor`);
}
console.log('ok frigate_popup_settings: shared choices and fallback');
