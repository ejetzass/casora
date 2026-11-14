// Camera popup family follows registry identity, not the tile that opened it.
// node dev/unit/camera_popup.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../../custom_components/casora/scripts/local/25-camera-popup.js', import.meta.url), 'utf8');
const frigateId = 'camera.mock_frigate';
const doorbellId = 'camera.mock_doorbell';
const overlapId = 'camera.mock_overlap';
const homeAssistant = { hass: null };
const window = {
  _casoraFrigate: { is: (_hass, id) => id === frigateId || id === overlapId,
    popup: () => ({ renderer: 'frigate' }) },
  _casoraKlingel: { is: (_hass, id) => id === doorbellId || id === overlapId,
    popup: () => ({ renderer: 'doorbell' }) },
};
new Function('window', 'document', source)(window, { querySelector: () => homeAssistant });
assert.deepEqual(window.casoraCameraPopup.fields('camera'), [['alert_window_minutes', 5], ['show_stream_variants', false]]);
assert.deepEqual(window.casoraCameraPopup.fields('frigate'), [['stream_popup', ''], ['stream_popup_phone', '']]);
assert.deepEqual(window.casoraCameraPopup.fields('doorbell'), [['talk', false], ['camera2', ''], ['big_on_audio', true]]);

const hass = { entities: {}, states: {} };
assert.equal(window.casoraCameraPopup.kind(hass, doorbellId), 'doorbell', 'doorbell family takes precedence');
assert.equal(window.casoraCameraPopup.kind(hass, overlapId), 'doorbell', 'doorbell wins when both family checks match');
assert.equal(window.casoraCameraPopup.kind(hass, frigateId), 'frigate', 'Frigate family follows the camera');
assert.equal(window.casoraCameraPopup.kind(hass, 'camera.mock_plain'), 'camera', 'other cameras use the plain camera popup');
assert.deepEqual(window.casoraCameraPopup.content({ entity_id: doorbellId }, {}, hass, {}), {
  kind: 'doorbell', variables: { alert_window_minutes: 5, show_stream_variants: false, talk: false, camera2: '', big_on_audio: true, casora_single_camera: true, cameras: [doorbellId] },
  content: { renderer: 'doorbell' },
}, 'doorbell tile types and popup variables do not choose the renderer');
assert.equal(window.casoraCameraPopup.content({ entity_id: frigateId }, {}, hass, {}).content.renderer, 'frigate');
assert.equal(window.casoraCameraPopup.content({ entity_id: 'camera.mock_plain' }, {}, hass, {}).content, null);

console.log('camera_popup: family resolution');

const hassWithTiles = {
  entities: {
    'camera.mock_a_main': { device_id: 'device-camera-a' },
    'camera.mock_a_sub': { device_id: 'device-camera-a' },
    'camera.mock_standalone': {},
  },
  states: {},
};
const config = {
  views: [
    { path: 'home', cards: [
      { type: 'custom:button-card', template: 'casora_room', variables: {
        casora_camera_settings: {
          'device-camera-a': { popup: { alert_window_minutes: 12 }, open: { ring: 'always' } },
        },
      } },
      { type: 'custom:button-card', template: 'casora_camera', entity: 'camera.mock_a_sub',
        variables: { alert_window_minutes: 3, show_stream_variants: true } },
      { type: 'custom:button-card', template: 'casora_camera', entity: 'camera.mock_a_main',
        variables: { alert_window_minutes: 9, show_stream_variants: false } },
      { type: 'custom:button-card', template: 'casora_camera', entity: 'camera.mock_standalone',
        variables: { alert_window_minutes: 7, show_stream_variants: true } },
    ] },
    { path: 'office', cards: [
      { type: 'custom:button-card', template: 'casora_camera', entity: 'camera.mock_a_main',
        variables: { alert_window_minutes: 20, show_stream_variants: false } },
    ] },
  ],
};
const before = structuredClone(config);
homeAssistant.hass = hassWithTiles;
const resolved = window.casoraCameraPopup.resolve('camera.mock_a_main', hassWithTiles, config);
assert.equal(resolved.key, 'device-camera-a', 'dashboard settings use the camera device identity');
assert.equal(resolved.values.alert_window_minutes, 12, 'a per-dashboard value wins');
assert.equal(resolved.values.show_stream_variants, true, 'an unset field falls back to the first matching tile');
assert.deepEqual(resolved.popup, { alert_window_minutes: 12 }, 'the open-choice subobject is not folded into popup settings');
assert.deepEqual(resolved.open, { ring: 'always' }, 'automatic consumers can read the dashboard opening choice');
resolved.open.ring = 'never';
assert.deepEqual(config, before, 'resolving legacy values does not migrate or write the dashboard');

const standalone = window.casoraCameraPopup.resolve('camera.mock_standalone', hassWithTiles, config);
assert.equal(standalone.key, 'camera.mock_standalone', 'a camera without a device uses its entity id');
assert.deepEqual(standalone.open, {}, 'an unset dashboard opening choice inherits the house setting');
assert.deepEqual(standalone.values, { alert_window_minutes: 7, show_stream_variants: true },
  'a standalone camera falls back only to its own saved tile');

console.log('camera_popup: dashboard values and read-only tile fallback');

let statusArgs = null;
window.casoraCamStatusOf = (...args) => { statusArgs = args; return 'binary_sensor.mock_status'; };
const cameraVariables = window.casoraCameraPopup.variables('camera.mock_a_main', { room_name: 'Camera', status_entity: 'binary_sensor.old' },
  hassWithTiles, config);
assert.equal(cameraVariables.alert_window_minutes, 12, 'the dashboard popup value is passed to the renderer');
assert.equal(cameraVariables.show_stream_variants, true, 'the legacy fallback is passed to the renderer');
assert.equal(cameraVariables.status_entity, 'binary_sensor.mock_status', 'status uses the shared #88 resolver');
assert.equal(statusArgs[0], 'camera.mock_a_main');
assert.equal(statusArgs[1].status_entity, 'binary_sensor.old');
assert.equal(statusArgs[2], hassWithTiles);
assert.equal(cameraVariables.room_name, 'Camera', 'unrelated renderer variables survive');

const openCalls = [];
window._casoraLovelaceCfg = () => config;
const automaticConfig = window.casoraCameraPopup.config('camera.mock_a_main', hassWithTiles, config);
assert.equal(automaticConfig.template, 'casora_camera', 'automatic callers use the canonical camera template');
assert.equal(automaticConfig.entity, 'camera.mock_a_main');
assert.equal(automaticConfig.variables.alert_window_minutes, 12, 'automatic callers use dashboard popup options');
window._casoraNotifyOpenViaCard = (...args) => {
  openCalls.push(args);
  args[1](true);
};
let opened = null;
window.casoraCameraPopup.open('camera.mock_unplaced', (ok) => { opened = ok; });
assert.equal(opened, true, 'open(cameraId) reports the opener result');
assert.equal(openCalls.length, 1);
assert.equal(openCalls[0][0], 'camera.mock_unplaced');
assert.equal(openCalls[0][2].template, 'casora_camera', 'source-less opening reuses the existing camera template');
assert.equal(openCalls[0][2].entity, 'camera.mock_unplaced');
assert.equal(openCalls[0][2].variables.casora_single_camera, true);
assert.deepEqual(openCalls[0][2].variables.cameras, ['camera.mock_unplaced']);
assert.equal(openCalls[0][2].variables.show_stream_variants, false);
assert.equal(openCalls[0][3], true, 'the opener skips source-tile lookup');
assert.deepEqual(openCalls[0][2], window.casoraCameraPopup.config('camera.mock_unplaced', hassWithTiles, config),
  'manual and automatic callers share the same camera card configuration');
assert.equal(openCalls[0][2].name, undefined, 'the opener does not copy a saved tile');

console.log('camera_popup: renderer options and source-less open');

// Execute the actual button-card popup expression, not just the helper.
const templates = JSON.parse(fs.readFileSync(new URL('../../dashboards/casora/button_card_templates.json', import.meta.url), 'utf8'));
assert.ok([].concat(templates.casora_camera.template).includes('casora_popup_camera'),
  'Camera tiles inherit the popup template');
const expression = templates.casora_popup_camera.tap_action.casora_popup.content;
const render = new Function('window', 'entity', 'states', 'hass', 'variables', expression.trim().slice(3, -3));
const seen = [];
window._casoraKlingel.popup = (_entity, _states, _hass, vars) => { seen.push(vars); return { renderer: 'doorbell' }; };
window._casoraFrigate.popup = (_entity, _states, _hass, vars) => { seen.push(vars); return { renderer: 'frigate' }; };
assert.equal(render(window, { entity_id: doorbellId }, {}, hass, { casora_single_camera: true }).renderer, 'doorbell');
assert.equal(render(window, { entity_id: frigateId }, {}, hass, { casora_single_camera: true }).renderer, 'frigate');
const specialConfig = { views: [{ path: 'home', cards: [
  { template: 'casora_room', variables: { casora_camera_settings: { [doorbellId]: { popup: { alert_window_minutes: 17 } } } } },
  { type: 'custom:button-card', template: 'casora_camera', entity: doorbellId, variables: { alert_window_minutes: 2 } },
  { type: 'custom:button-card', template: 'casora_camera', entity: doorbellId, variables: { alert_window_minutes: 9 } },
] }] };
window._casoraLovelaceCfg = () => specialConfig;
for (const minutes of [2, 9]) {
  render(window, { entity_id: doorbellId }, {}, hass, { casora_single_camera: true, alert_window_minutes: minutes });
}
assert.deepEqual(seen.slice(-2).map((v) => v.alert_window_minutes), [17, 17], 'both real template dispatches use the dashboard value');
specialConfig.views[0].cards[0].variables.casora_camera_settings[doorbellId].popup.alert_window_minutes = 21;
render(window, { entity_id: doorbellId }, {}, hass, { casora_single_camera: true });
assert.equal(seen.at(-1).alert_window_minutes, 21, 'saved changes reach the actual renderer');
console.log('camera_popup: real template family dispatch');
