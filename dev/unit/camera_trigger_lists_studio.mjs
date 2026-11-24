// @deckt: custom_components/casora/panel/casora-panel-personal.js#global
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../custom_components/casora/panel/casora-panel-personal.js', import.meta.url), 'utf8');
const noop = () => {};
function element(tag) {
  return {
    tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {}, className: '', textContent: '',
    classList: { add: noop, toggle: noop, contains: () => false },
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
  };
}
const document = { createElement: element };
const window = { casoraI18n: { t: text => text } };
const Panel = function () {};
const customElements = { get: () => Panel, whenDefined: () => ({ then: fn => fn() }) };
new Function('window', 'document', 'customElements', source)(window, document, customElements);
const panel = Object.create(Panel.prototype);
panel._hass = {
  entities: { 'camera.test': { device_id: 'test' }, 'binary_sensor.person': { device_id: 'test' } },
  devices: { test: { name: 'Test camera' } },
  states: {
    'camera.test': { attributes: { friendly_name: 'Test camera' } },
    'binary_sensor.person': { attributes: { friendly_name: 'Person' } },
    'event.motion': { attributes: { friendly_name: 'Motion' } },
  },
};
panel.shadowRoot = { getElementById: () => null, appendChild: noop };
panel._flowGroup = (parent) => { const outer = element('div'), list = element('div'); parent.appendChild(outer); outer.appendChild(list); return list; };
panel._flowRow = (parent, options = {}) => { const row = element('div'); row.textContent = options.title || ''; row.options = options; parent.appendChild(row); return { row }; };
panel._combo = (value, options, hint, onChange, opts) => {
  panel.combos.push({ value, options, hint, onChange, opts });
  return { wrap: element('div') };
};
panel._boolSwitch = (cur, boolDefault, onChange, label) => {
  panel.switches.push({ cur, boolDefault, onChange, label });
  return element('button');
};
panel._entityList = domains => Object.keys(panel._hass.states).filter(id => domains.includes(id.split('.')[0]));
panel._prettyEntity = id => panel._hass.states[id]?.attributes?.friendly_name || id;
panel._csBar = noop;
const draft = window.casoraPersonal.normalize({});
assert.deepEqual(draft.cameras, [], 'camera list starts empty');
assert.equal(draft.camera_popup, null, 'the house switch of the camera popup is off by default');
const host = element('div');
const render = () => {
  host.children = [];
  panel.combos = [];
  panel.switches = [];
  panel._casoraPersonalGroups(host, draft, ['cameras'], render);
};
render();
// The house switch: the popup opens by itself only when the user turns it on.
const houseSwitch = () => panel.switches.find(s => s.label === 'Open camera popup by itself');
assert.ok(houseSwitch(), 'the cameras block has the house switch of the camera popup');
const rows = node => [node, ...node.children.flatMap(rows)];
const houseRow = rows(host).find(row => row.options?.title === 'Open camera popup by itself');
assert.ok(houseRow.options.sub.endsWith('Wall tablets only; closes with "Close popups when idle".'), 'the hint explains where and how the popup closes');
assert.equal(houseSwitch().cur, false, 'the house switch is off');
assert.equal(window.casoraPersonal.prune(draft).camera_popup, undefined, 'off is not stored at all');
houseSwitch().onChange(true);
assert.deepEqual(draft.camera_popup, { open_by_itself: true }, 'the house switch turns the popup on');
assert.deepEqual(window.casoraPersonal.prune(draft).camera_popup, { open_by_itself: true }, 'the house switch is stored');
houseSwitch().onChange(undefined);
assert.equal(draft.camera_popup, undefined, 'off again takes the section away');
assert.equal(window.casoraPersonal.prune(draft).camera_popup, undefined, 'off again stores nothing');
houseSwitch().onChange(true);

panel.combos.find(c => c.hint === 'Add a camera').onChange('camera.test');
assert.equal(draft.cameras[0].entity_id, 'camera.test');
// Every camera has a doorbell list and a detection list.
const triggerPickers = () => panel.combos.filter(c => c.hint === 'Add sensor or event');
assert.equal(triggerPickers().length, 2, 'the camera has a doorbell list and a detection list');
assert.ok(triggerPickers()[0].options.includes('event.motion'), 'event entities remain available');
triggerPickers()[0].onChange('event.motion');
assert.deepEqual(draft.cameras[0].doorbell_triggers, ['event.motion'], 'the doorbell list takes the ring');
triggerPickers()[1].onChange('binary_sensor.person');
assert.deepEqual(draft.cameras[0].detection_triggers, ['binary_sensor.person'], 'the detection list takes the detection');
assert.deepEqual(window.casoraPersonal.prune(draft).cameras[0].detection_triggers, ['binary_sensor.person']);
assert.equal(window.CASORA_SETTINGS, undefined, 'editing the list does not save the draft');
// The ring switch of the camera: on unless the user turns it off.
const ringSwitch = () => panel.switches.find(s => s.label === 'Open popup on a ring');
assert.ok(ringSwitch(), 'the camera has a switch for the ring');
assert.equal(ringSwitch().cur, undefined, 'a camera without the field opens its popup on a ring');
ringSwitch().onChange(false);
assert.equal(draft.cameras[0].open_on_ring, false, 'the ring switch can be turned off');
assert.equal(window.casoraPersonal.prune(draft).cameras[0].open_on_ring, false, 'an explicit off is kept');
ringSwitch().onChange(undefined);
assert.equal(draft.cameras[0].open_on_ring, true, 'on again is stored explicitly once the switch was touched');
assert.equal(window.casoraPersonal.prune(draft).cameras[0].open_on_ring, true, 'a touched ring switch stores true');

const detectionSwitch = () => panel.switches.find(s => s.label === 'Open popup on a detection');
assert.ok(detectionSwitch(), 'the camera has a detection switch');
assert.equal(detectionSwitch().boolDefault, false, 'the detection switch defaults to off');
detectionSwitch().onChange(true);
assert.equal(draft.cameras[0].open_on_detection, true, 'turning on changes only the draft');
assert.equal(window.CASORA_SETTINGS, undefined, 'the switch does not save immediately');
assert.equal(window.casoraPersonal.prune(draft).cameras[0].open_on_detection, true, 'on is saved');
detectionSwitch().onChange(undefined);
assert.equal(draft.cameras[0].open_on_detection, false, 'off again is stored explicitly once the switch was touched');
assert.equal(window.casoraPersonal.prune(draft).cameras[0].open_on_detection, false, 'a touched detection switch stores false');
detectionSwitch().onChange(true);

const settingsSource = fs.readFileSync(new URL('../../custom_components/casora/panel/casora-panel-settings.js', import.meta.url), 'utf8');
new Function('window', 'document', 'customElements', 'localStorage', settingsSource)(window, document, customElements, {});
let stored = { scenes: { exclude: ['scene.test'] } };
const writes = [];
panel._hass.callWS = async message => {
  if (message.type === 'casora/settings/get') return { stored: true, settings: structuredClone(stored) };
  if (message.type === 'casora/settings/set') { writes.push(message); stored = structuredClone(message.settings); return { settings: stored }; }
  if (message.type === 'casora/options/get') return { options: {} };
  if (message.type === 'casora/tanken/get') return { cars: [] };
  if (message.type === 'casora/charging/get') return {};
  throw new Error('not available');
};
panel.shadowRoot.querySelectorAll = () => [];
panel._csRepaint = noop;
panel._status = noop;
await panel._csLoad();
panel._cs.S.cameras = structuredClone(draft.cameras);
panel._cs.S.camera_popup = structuredClone(draft.camera_popup);
assert.equal(writes.length, 0, 'the settings draft is not saved until Save');
assert.equal(panel._csDirty(), true);
assert.equal(await panel._csSave(), true);
assert.deepEqual(stored.cameras[0].detection_triggers, ['binary_sensor.person']);
assert.deepEqual(stored.cameras[0].doorbell_triggers, ['event.motion'], 'the doorbell list is saved with the camera');
assert.equal(stored.cameras[0].open_on_ring, true, 'a touched ring switch that is on is stored as true');
assert.equal(stored.cameras[0].open_on_detection, true, 'the detection switch is saved');
assert.deepEqual(stored.camera_popup, { open_by_itself: true }, 'the house switch is saved with the cameras');
assert.deepEqual(stored.scenes, { exclude: ['scene.test'] }, 'other settings survive the save');
// The ring switch off: the record keeps an explicit false.
panel._cs.S.cameras[0].open_on_ring = false;
assert.equal(await panel._csSave(), true);
assert.equal(stored.cameras[0].open_on_ring, false, 'a camera whose ring switch is off stores false');
panel._cs.loaded = false;
await panel._csLoad();
assert.deepEqual(panel._cs.S.cameras[0].detection_triggers, ['binary_sensor.person'], 'triggers reload');
assert.equal(panel._cs.S.cameras[0].open_on_ring, false, 'the ring switch reloads');
assert.equal(panel._cs.S.cameras[0].open_on_detection, true, 'the detection switch reloads');
assert.equal(panel._cs.S.camera_popup.open_by_itself, true, 'the house switch reloads');
