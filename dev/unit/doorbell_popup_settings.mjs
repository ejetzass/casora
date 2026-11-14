// Doorbell popup settings take precedence without migrating saved tile values.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../../custom_components/casora/scripts/local/25-camera-popup.js', import.meta.url), 'utf8');
const id = 'camera.mock_doorbell';
let rendered;
const window = { _casoraKlingel: { is: (_h, entity) => entity === id, popup: (_e, _s, _h, vars) => { rendered = vars; return { marker: 'doorbell-popup' }; } } };
new Function('window', 'document', source)(window, { querySelector: () => null });
const hass = { entities: {}, states: {} };
const config = { views: [{ path: 'home', cards: [
  { template: 'casora_room', variables: { casora_camera_settings: { [id]: { popup: { talk: false, camera2: 'camera.second' }, open: { ring: 'always' } } } } },
  { type: 'custom:button-card', template: 'casora_reolink_doorbell', entity: id, variables: { talk: true, camera2: 'camera.old', big_on_audio: false } },
] }] };
const before = structuredClone(config);
window._casoraLovelaceCfg = () => config;
window.casoraCameraPopup.content({ entity_id: id }, {}, hass, { casora_single_camera: true });
assert.equal(rendered.talk, false);
assert.equal(rendered.camera2, 'camera.second');
assert.equal(rendered.big_on_audio, false);
assert.deepEqual(config, before);
console.log('ok doorbell popup settings');
const panelSource = fs.readFileSync(new URL('../../custom_components/casora/panel/casora-panel-personal.js', import.meta.url), 'utf8');
const panelWindow = { casoraCameraPopup: window.casoraCameraPopup };
new Function('window', 'customElements', panelSource)(panelWindow, { whenDefined: () => ({ then() {} }) });
const camera = { entity_id: id };
const rooms = [{ tiles: [{ entity: id, variables: { talk: true, camera2: 'camera.old', big_on_audio: false } }] }];
assert.deepEqual(panelWindow.casoraPersonal.cameraPopupValues(camera, hass, rooms, { talk: false }, 'doorbell'),
  { talk: false, camera2: 'camera.old', big_on_audio: false });
assert.deepEqual(panelWindow.casoraPersonal.cameraPopupValues(camera, hass, [], {}, 'doorbell'),
  { talk: false, camera2: '', big_on_audio: true }, 'doorbell defaults');
const types = fs.readFileSync(new URL('../../custom_components/casora/panel/casora-panel-types.js', import.meta.url), 'utf8');
const doorbellType = types.slice(types.indexOf('{ id: "casora_reolink_doorbell"'), types.indexOf('{ id: "casora_fridge"'));
assert.match(doorbellType, /settingsLink: "cameras"/);
assert.doesNotMatch(doorbellType, /key: "(talk|camera2|big_on_audio)"/);
assert.match(doorbellType, /key: "still_entity"/);
assert.match(doorbellType, /key: "refresh_s"/);
const templates = JSON.parse(fs.readFileSync(new URL('../../dashboards/casora/button_card_templates.json', import.meta.url), 'utf8'));
const expression = templates.casora_popup_camera.tap_action.casora_popup.content;
const render = new Function('window', 'entity', 'states', 'hass', 'variables', expression.trim().slice(3, -3));
const tapResult = render(window, { entity_id: id }, {}, hass, { casora_single_camera: true, talk: true });
assert.deepEqual(tapResult, { marker: 'doorbell-popup' }, 'a plain Camera tile on a doorbell camera opens the doorbell popup, not the plain camera popup');
assert.equal(rendered.talk, false, 'plain Camera tile dispatch uses the section');
assert.equal(rendered.camera2, 'camera.second');
rendered = undefined;
assert.notDeepEqual(render(window, { entity_id: 'camera.mock_plain' }, {}, hass, {}), { marker: 'doorbell-popup' }, 'other cameras keep the plain popup');
assert.equal(rendered, undefined, 'the doorbell renderer is not used for other cameras');
config.views[0].cards.pop();
let opened;
window._casoraNotifyOpenViaCard = (_id, done, card, skip) => { opened = { card, skip }; done(true); };
window.casoraCameraPopup.open(id);
assert.equal(opened.card.variables.talk, false, 'opening without a tile keeps section values');
assert.equal(opened.card.variables.camera2, 'camera.second');
assert.equal(opened.card.variables.big_on_audio, true, 'without a tile the default applies');
assert.equal(opened.skip, true);
