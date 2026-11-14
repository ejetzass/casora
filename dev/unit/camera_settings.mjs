// Camera settings: candidate grouping uses HA registry identity, never an NVR parent.
// node dev/unit/camera_settings.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../../custom_components/casora/panel/casora-panel-personal.js', import.meta.url), 'utf8');
const settingsSource = fs.readFileSync(new URL('../../custom_components/casora/panel/casora-panel-settings.js', import.meta.url), 'utf8');
const noop = () => {};
const makeElement = (tag) => {
  const classes = new Set();
  return {
    tagName: String(tag).toUpperCase(), children: [], attributes: {}, dataset: {}, style: {}, className: '',
    textContent: '', disabled: false, parentElement: null,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, on) => ((on === undefined ? !classes.has(name) : on) ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    addEventListener: noop,
  };
};
const document = { createElement: makeElement };
const window = { casoraI18n: { t: (text) => text } };
new Function('window', 'document', fs.readFileSync(new URL('../../custom_components/casora/scripts/local/25-camera-popup.js', import.meta.url), 'utf8'))(window, document);
const Panel = function () {};
Panel.prototype._isDirty = function () { return JSON.stringify(this._state) !== JSON.stringify(this.dashboardSaved); };
Panel.prototype._markDirty = function () { this._lastPrint = JSON.stringify(this._state); };
Panel.prototype._save = async function () {
  this.dashboardSaved = structuredClone(this._state);
  return true;
};
Panel.prototype._load = async function () {
  this._state = structuredClone(this.dashboardSaved);
  this._lastPrint = JSON.stringify(this._state);
  return true;
};
Panel.prototype._discardDraft = function () {};
const customElements = { get: () => Panel, whenDefined: () => ({ then: (callback) => callback() }) };
new Function('window', 'customElements', 'document', source)(window, customElements, document);
new Function('window', 'customElements', 'document', 'localStorage', settingsSource)(window, customElements, document, {});

const hass = {
  devices: {
    nvr: { name: 'Recorder' },
    driveway: { name: 'Driveway', via_device_id: 'nvr' },
    garage: { name: 'Garage', via_device_id: 'nvr' },
  },
  entities: {
    'camera.driveway_main': { device_id: 'driveway', translation_key: 'main' },
    'camera.driveway_sub': { device_id: 'driveway', translation_key: 'sub' },
    'camera.driveway_snapshot': { device_id: 'driveway', translation_key: 'snapshot' },
    'camera.garage': { device_id: 'garage' },
    'camera.detached': {},
    'camera.hidden': { device_id: 'hidden', hidden: true },
  },
  states: {
    'camera.driveway_main': { state: 'streaming', attributes: { friendly_name: 'Driveway main' } },
    'camera.driveway_sub': { state: 'streaming', attributes: { friendly_name: 'Driveway sub' } },
    'camera.driveway_snapshot': { state: 'streaming', attributes: { friendly_name: 'Driveway snapshot' } },
    'camera.garage': { state: 'streaming', attributes: { friendly_name: 'Garage view' } },
    'camera.detached': { state: 'streaming', attributes: { friendly_name: 'Detached camera' } },
    'camera.hidden': { state: 'streaming', attributes: { friendly_name: 'Hidden camera' } },
  },
};

// Grouping comes from the camera tile's own filter, not from a copy in the Studio.
const withoutFilter = window.casoraPersonal.cameraCandidates(hass).map((camera) => camera.entity_id).sort();
assert.deepEqual(withoutFilter, ['camera.detached', 'camera.driveway_main', 'camera.driveway_snapshot', 'camera.driveway_sub', 'camera.garage'],
  'without the tile filter loaded the Studio does not guess: every visible camera is listed');
const tileWindow = { addEventListener: noop, document };
new Function('window', 'document', fs.readFileSync(new URL('../../custom_components/casora/scripts/local/07-weich-spezial.js', import.meta.url), 'utf8'))(tileWindow, document);
window._casoraCamSoft = tileWindow._casoraCamSoft;
assert.equal(typeof window._casoraCamSoft.filter, 'function');
const candidates = window.casoraPersonal.cameraCandidates(hass);
assert.deepEqual(candidates.map(({ device_id, entity_id, name }) => JSON.stringify([device_id, entity_id, name])).sort(),
  [
    ['driveway', 'camera.driveway_main', 'Driveway'],
    ['garage', 'camera.garage', 'Garage'],
    [null, 'camera.detached', 'Detached camera'],
  ].map(JSON.stringify).sort(), 'one candidate per camera device; separate NVR-connected cameras and standalone cameras remain');
let existingFilterCalled = false;
const realSoft = window._casoraCamSoft;
window._casoraCamSoft = { filter: () => { existingFilterCalled = true; return candidates.map((camera) => camera.entity_id); } };
assert.deepEqual(window.casoraPersonal.cameraCandidates(hass).map((camera) => camera.entity_id),
  candidates.map((camera) => camera.entity_id), 'reuse the camera tile stream filter when it is loaded');
assert.equal(existingFilterCalled, true);
window._casoraCamSoft = realSoft;
assert.deepEqual(window.casoraPersonal.normalize({}).cameras, [], 'the camera list defaults to empty');
assert.equal(window.casoraPersonal.effectiveOpen(false, 'inherit'), false, 'inherited opening starts off');
assert.equal(window.casoraPersonal.effectiveOpen(true, 'inherit'), true, 'inherit follows the house switch');
assert.equal(window.casoraPersonal.effectiveOpen(false, 'always'), true, 'Always overrides the house switch');
assert.equal(window.casoraPersonal.effectiveOpen(true, 'never'), false, 'Never overrides the house switch');

const triggerHass = {
  devices: {
    camera: { name: 'Camera' },
    camera_child: { name: 'Camera accessory', via_device_id: 'camera' },
    other: { name: 'Other device' },
  },
  entities: {
    'event.camera_doorbell': { device_id: 'camera' },
    'binary_sensor.camera_detection': { device_id: 'camera' },
    'binary_sensor.other_sensor': { device_id: 'other' },
    'event.other_event': { device_id: 'other' },
    'event.camera_accessory': { device_id: 'camera_child' },
    'sensor.not_a_trigger': { device_id: 'camera' },
  },
  states: {
    'event.camera_doorbell': { state: 'pressed', attributes: { friendly_name: 'Doorbell event' } },
    'binary_sensor.camera_detection': { state: 'on', attributes: { friendly_name: 'Motion sensor' } },
    'binary_sensor.other_sensor': { state: 'on', attributes: { friendly_name: 'A sensor elsewhere' } },
    'event.other_event': { state: 'pressed', attributes: { friendly_name: 'B event elsewhere' } },
    'event.camera_accessory': { state: 'pressed', attributes: { friendly_name: 'Accessory event' } },
    'sensor.not_a_trigger': { state: 'on', attributes: { friendly_name: 'Camera sensor' } },
  },
};
assert.deepEqual(window.casoraPersonal.triggerCandidates(triggerHass, 'camera'), [
  'event.camera_doorbell',
  'binary_sensor.camera_detection',
  'binary_sensor.other_sensor',
  'event.camera_accessory',
  'event.other_event',
], 'binary sensors and events from every device are ranked by the camera device first, then HA name');
assert.deepEqual(window.casoraPersonal.triggerCandidates(triggerHass, null), [
  'binary_sensor.other_sensor',
  'event.camera_accessory',
  'event.other_event',
  'event.camera_doorbell',
  'binary_sensor.camera_detection',
], 'without a camera device all eligible triggers use HA-name order');

console.log('ok camera_settings: registry candidates and trigger picker order');

const stored = {
  scenes: { exclude: ['scene.olive'] },
  calendars: ['calendar.olive'],
  cameras: [{ device_id: 'gone-device', entity_id: 'camera.gone', name: 'Missing camera' }],
};
const calls = [];
const hassWithCamera = {
  devices: { garden: { name: 'Garden' } },
  entities: {
    'camera.garden': { device_id: 'garden' },
    'binary_sensor.garden_connected': { device_id: 'garden', device_class: 'connectivity' },
  },
  states: {
    'camera.garden': { state: 'streaming', attributes: { friendly_name: 'Garden camera' } },
    'binary_sensor.garden_connected': { state: 'on', attributes: { friendly_name: 'Garden connection', device_class: 'connectivity' } },
  },
  callWS: async (message) => {
    calls.push(message);
    if (message.type === 'casora/settings/get') return { stored: true, settings: structuredClone(stored) };
    if (message.type === 'casora/options/get') return { options: {} };
    if (message.type === 'casora/tanken/get') return { cars: [] };
    if (message.type === 'casora/charging/get') return {};
    if (message.type === 'casora/settings/set') {
      Object.assign(stored, structuredClone(message.settings));
      Object.keys(stored).forEach((key) => { if (!(key in message.settings)) delete stored[key]; });
      return { settings: structuredClone(stored) };
    }
    return Promise.reject(new Error('unknown command'));
  },
};
const panel = Object.create(Panel.prototype);
panel._hass = hassWithCamera;
panel._state = { compact: { rooms: [
  { path: 'home', variables: { casora_camera_settings: {
    'gone-device': { popup: { alert_window_minutes: 8, show_stream_variants: false }, open: { detection: 'inherit' } },
  } } },
  { tiles: [{
    type: 'custom:button-card', entity: 'camera.garden', variables: { status_entity: 'binary_sensor.garden_connected' },
  }] },
] } };
panel.dashboardSaved = structuredClone(panel._state);
panel._lastPrint = JSON.stringify(panel._state);
panel._csOpen = true;
panel._csPage = 'n-house';
panel._flowMode = true;
panel.shadowRoot = { getElementById: () => null, appendChild: noop, querySelectorAll: () => [] };
panel._flowGroup = (parent, options = {}) => {
  const group = makeElement('div');
  group.className = 'fgroup';
  group.dataset.header = options.header || '';
  if (options.header) {
    const heading = makeElement('div');
    heading.textContent = options.header;
    group.appendChild(heading);
  }
  const list = makeElement('div');
  group.appendChild(list);
  parent.appendChild(group);
  if (options.footer) {
    const footer = makeElement('div');
    footer.className = 'ffoot';
    footer.textContent = options.footer;
    group.appendChild(footer);
  }
  return list;
};
panel._flowRow = (list, options = {}) => {
  const row = makeElement('div');
  row.textContent = options.title || '';
  if (options.sub) row.textContent += ' ' + options.sub;
  if (options.title) {
    const title = makeElement('b');
    title.textContent = options.title;
    row.appendChild(title);
  }
  if (options.sub) {
    const sub = makeElement('span');
    sub.textContent = options.sub;
    row.appendChild(sub);
  }
  let detail = null;
  if (options.detail !== undefined) {
    detail = makeElement('span');
    detail.textContent = options.detail;
    row.appendChild(detail);
  }
  list.appendChild(row);
  return { row, detail };
};
panel.combos = [];
panel.entityFilters = [];
panel._combo = (value, options, hint, onChange, opts) => {
  panel.combos.push({ value, options, hint, onChange, opts });
  return { wrap: makeElement('div') };
};
panel.switches = [];
panel._boolSwitch = (current, defaultValue, onChange, label) => {
  const isDefault = current === undefined || current === '' || current === null;
  let checked = isDefault ? !!defaultValue : !!current;
  const button = makeElement('button');
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-checked', checked ? 'true' : 'false');
  button.onclick = () => {
    checked = !checked;
    button.setAttribute('aria-checked', checked ? 'true' : 'false');
    onChange(checked === !!defaultValue ? undefined : checked);
  };
  panel.switches.push({ button, label });
  return button;
};
panel._entityList = (domains, classes) => {
  panel.entityFilters.push({ domains, classes });
  return ['camera.garden', 'binary_sensor.garden_connected'];
};
panel._prettyEntity = (id) => id === 'binary_sensor.garden_connected' ? 'Garden connection' : id;
window.casoraCameraTileStatusFor = (camera, _hass, rooms) => {
  for (const room of rooms || []) for (const tile of room.tiles || []) {
    const card = tile.type === 'conditional' ? tile.card : tile;
    if ((card.entity || tile.entity) === camera.entity_id) return (card.variables || {}).status_entity || null;
  }
  return null;
};
panel._csRepaint = noop;
panel._csBar = noop;
panel._status = noop;
await panel._csLoad();
assert.deepEqual(panel._cs.S.cameras, stored.cameras, 'camera list loads as part of the house-wide draft');
const host = makeElement('div');
const renderCameras = () => {
  host.children = [];
  panel.combos = [];
  panel.switches = [];
  panel._casoraPersonalGroups(host, panel._cs.S, ['cameras'], renderCameras);
};
renderCameras();
assert.deepEqual(panel.switches.filter(({ label }) => label.startsWith('Open popup on')).map(({ label, button }) => [label, button.getAttribute('aria-checked')]), [
  ['Open popup on a ring', 'false'],
  ['Open popup on a detection', 'false'],
], 'each camera defaults both house-wide opening switches to off');
const dashboardChoices = () => panel.combos.filter((combo) => combo.opts && combo.opts.labels
  && combo.options.includes('inherit'));
assert.equal(dashboardChoices().length, 2, 'each camera has a choice for both popup triggers on this dashboard');
assert.equal(dashboardChoices()[0].opts.labels.inherit, 'As all dashboards (off)', 'the inherited label shows the current house value');
panel.switches.find(({ label }) => label === 'Open popup on a ring').button.onclick();
assert.equal(panel._cs.S.cameras[0].open_on_ring, true, 'the house ring switch changes only the settings draft');
assert.equal(dashboardChoices()[0].opts.labels.inherit, 'As all dashboards (on)', 'the inherited label follows a house draft change');
assert.equal(calls.some((message) => message.type === 'casora/settings/set'), false, 'house opening switches do not save before Save settings');
const dirtySettingsDraft = structuredClone(panel._cs.S);
const settingsReadsBeforeRefresh = calls.filter((message) => message.type === 'casora/settings/get').length;
window.CASORA_SETTINGS = { cameras: [{ device_id: 'porch', entity_id: 'camera.porch' }] };
panel._cs.at = 0;
assert.equal(await panel._csLoad(), false, 'a dirty Studio does not reload house settings after another context refreshes them');
assert.equal(calls.filter((message) => message.type === 'casora/settings/get').length, settingsReadsBeforeRefresh,
  'refreshing dashboard settings does not start a Studio settings read');
assert.deepEqual(panel._cs.S, dirtySettingsDraft, 'the Studio draft survives a changed shared settings value');
window.CASORA_SETTINGS = structuredClone(stored);
assert.deepEqual(panel._state.compact.rooms[0].variables.casora_camera_settings['gone-device'].popup,
  { alert_window_minutes: 8, show_stream_variants: false }, 'house switches do not touch this dashboard popup settings');
await panel._csSave();
assert.equal(stored.cameras[0].open_on_ring, true, 'Save settings persists the house ring default');
renderCameras();
assert.equal(dashboardChoices()[0].opts.labels.inherit, 'As all dashboards (on)', 'a saved house value updates the inherited label');
panel.switches.find(({ label }) => label === 'Open popup on a ring').button.onclick();
assert.equal(panel._cs.S.cameras[0].open_on_ring, undefined, 'turning the house switch back off restores the unset default');
assert.equal(dashboardChoices()[0].opts.labels.inherit, 'As all dashboards (off)', 'the inherited label follows the off draft too');
await panel._csDiscardAll();
assert.equal(panel._cs.S.cameras[0].open_on_ring, true, 'Discard restores the saved house ring default');
renderCameras();
panel.switches.find(({ label }) => label === 'Open popup on a ring').button.onclick();
await panel._csSave();
assert.equal(stored.cameras[0].open_on_ring, undefined, 'saving the off default removes the optional house value');
renderCameras();
panel.switches.find(({ label }) => label === 'Open popup on a detection').button.onclick();
assert.equal(panel._cs.S.cameras[0].open_on_detection, true, 'the detection switch changes independently of the ring switch');
panel.switches.find(({ label }) => label === 'Open popup on a detection').button.onclick();
assert.equal(panel._cs.S.cameras[0].open_on_detection, undefined, 'the detection switch can return independently to its off default');
dashboardChoices()[0].onChange('always');
dashboardChoices()[1].onChange('never');
assert.equal(panel._state.compact.rooms[0].variables.casora_camera_settings['gone-device'].open.ring, 'always',
  'the camera override is held in this dashboard draft, keyed by camera identity');
assert.equal(panel._state.compact.rooms[0].variables.casora_camera_settings['gone-device'].open.detection, 'never',
  'the detection override is independent of the ring override');
assert.equal(panel._cs.S.cameras[0].open_on_ring, undefined, 'a dashboard override does not change the house switch');
assert.equal(panel._csDirty(), true, 'a dashboard override enables the existing save bar');
await panel._csSave();
assert.equal(panel.dashboardSaved.compact.rooms[0].variables.casora_camera_settings['gone-device'].open.ring, 'always',
  'Save settings persists the dashboard override through the existing dashboard save');
dashboardChoices()[0].onChange('never');
await panel._csDiscardAll();
assert.equal(panel._state.compact.rooms[0].variables.casora_camera_settings['gone-device'].open.ring, 'always',
  'Discard restores the saved dashboard override');
assert.deepEqual(panel._state.compact.rooms[0].variables.casora_camera_settings['gone-device'].popup,
  { alert_window_minutes: 8, show_stream_variants: false }, 'open choices preserve the popup subobject owned by #89');
panel._csOpen = false;
renderCameras();
const writesBeforeCameraListChanges = calls.filter((message) => message.type === 'casora/settings/set').length;
const cameraPicker = () => panel.combos.find((combo) => combo.hint === 'Add a camera');
assert.ok(cameraPicker(), 'Add a camera offers unconfigured HA cameras');
assert.deepEqual(cameraPicker().options, ['camera.garden']);
assert.ok(panel.combos.some((combo) => combo.hint === 'This camera'), 'each camera has a house-wide Status from field');
const allText = (root) => (root.textContent || '') + (root.children || []).map(allText).join(' ');
const elements = (root, predicate) => {
  const found = [];
  const walk = (node) => {
    if (predicate(node)) found.push(node);
    (node.children || []).forEach(walk);
  };
  walk(root);
  return found;
};
assert.match(allText(host), /Not found in Home Assistant/, 'a camera missing from HA remains removable');
assert.match(allText(host), /All dashboards/, 'camera sections include the house-wide group');
assert.match(allText(host), /Only this dashboard/, 'camera sections include the dashboard group');
assert.ok(allText(host).includes('When two cameras want to open at the same time, a ring goes first, otherwise the order of this list.'),
  'the approved camera priority hint follows the camera list');
cameraPicker().onChange('camera.garden');
assert.deepEqual(panel._cs.S.cameras, [
  { device_id: 'gone-device', entity_id: 'camera.gone', name: 'Missing camera' },
  { device_id: 'garden', entity_id: 'camera.garden', name: 'Garden' },
], 'adding a camera changes the draft, not stored settings');
assert.equal(calls.filter((message) => message.type === 'casora/settings/set').length, writesBeforeCameraListChanges,
  'camera changes are not stored before Save settings');
const gardenStatus = () => panel.combos.find((combo) => combo.value === 'binary_sensor.garden_connected')
  || panel.combos.find((combo) => combo.hint === 'Garden connection');
assert.ok(gardenStatus(), 'an inherited tile value appears as the empty field placeholder');
const allGroups = elements(host, (node) => node.dataset && node.dataset.header === 'All dashboards');
assert.equal(allGroups.length, 2);
assert.ok(allGroups.every((group) => /Status from/.test(allText(group))), 'Status from is inside each camera’s All dashboards group');
for (const group of allGroups) {
  const list = group.children[1];
  const index = (text) => list.children.findIndex((node) => allText(node).includes(text));
  assert.ok(index('Open popup on a ring') < index('Open popup on a detection'));
  assert.ok(index('Open popup on a detection') < index('Applies to all dashboards'));
  assert.ok(index('Applies to all dashboards') < index('Status from'), 'hint is below the switches, before status');
  assert.ok(!group.children.slice(2).some((node) => allText(node).includes('Applies to all dashboards')), 'hint is not the group footer');
}
assert.deepEqual(panel.entityFilters.at(-1), {
  domains: ['camera', 'binary_sensor'], classes: { binary_sensor: ['connectivity'] },
}, 'Status from keeps the camera/connectivity entity filter');
assert.match(allText(host), /Status from/, 'the house-wide field keeps its label');
assert.match(allText(host), /Optional\. Another camera or a connection sensor that tells whether the camera is reachable/,
  'the house-wide field keeps its hint');
gardenStatus().onChange('binary_sensor.garden_connected');
assert.equal(panel._cs.S.cameras.find((camera) => camera.entity_id === 'camera.garden').status_entity,
  'binary_sensor.garden_connected', 'changing Status from edits the camera draft');
assert.equal(calls.filter((message) => message.type === 'casora/settings/set').length, writesBeforeCameraListChanges,
  'camera changes are not stored before Save settings');
const cameraToggles = elements(host, (node) => node.className === 'camera-name');
assert.equal(cameraToggles.length, 2);
assert.deepEqual(cameraToggles.map((button) => button.getAttribute('aria-expanded')), ['false', 'true'], 'the added camera opens');
cameraToggles[0].onclick();
assert.deepEqual(cameraToggles.map((button) => button.getAttribute('aria-expanded')), ['true', 'false'], 'only one camera section opens at a time');
await panel._csDiscardAll();
assert.deepEqual(panel._cs.S.cameras, stored.cameras, 'Discard restores the saved camera list');
assert.equal(calls.filter((message) => message.type === 'casora/settings/set').length, writesBeforeCameraListChanges,
  'discard does not save the draft');
renderCameras();
cameraPicker().onChange('camera.garden');
renderCameras();
const buttons = (root, label) => elements(root, (node) => node.tagName === 'BUTTON' && node.textContent === label);
buttons(host, 'Move up').find((button) => !button.disabled).onclick();
assert.deepEqual(panel._cs.S.cameras.map((camera) => camera.entity_id), ['camera.garden', 'camera.gone'], 'Move up changes the draft order');
renderCameras();
buttons(host, 'Remove').at(-1).onclick();
assert.deepEqual(panel._cs.S.cameras.map((camera) => camera.entity_id), ['camera.garden'], 'Remove deletes only the camera configuration');
assert.equal(calls.filter((message) => message.type === 'casora/settings/set').length, writesBeforeCameraListChanges,
  'reordering and removing remain draft changes');
gardenStatus().onChange('binary_sensor.garden_connected');
await panel._csSave();
assert.deepEqual(stored, {
  scenes: { exclude: ['scene.olive'] },
  calendars: ['calendar.olive'],
  cameras: [{ device_id: 'garden', entity_id: 'camera.garden', name: 'Garden', status_entity: 'binary_sensor.garden_connected' }],
}, 'saving cameras preserves unrelated saved settings');
panel._cs.loaded = false;
await panel._csLoad();
renderCameras();
assert.match(allText(host), /All cameras are already added\./, 'the add control explains when there are no unconfigured cameras');
assert.equal(cameraPicker(), undefined, 'no camera picker is shown when every camera is added');
const emptyHost = makeElement('div');
panel.combos = [];
panel._casoraPersonalGroups(emptyHost, window.casoraPersonal.normalize({}), ['cameras'], noop);
assert.match(allText(emptyHost), /No Cameras Add a camera to change its popup settings\./, 'the empty list offers its next action');

hassWithCamera.devices.porch = { name: 'Porch' };
hassWithCamera.devices.house = { name: 'House' };
Object.assign(hassWithCamera.entities, {
  'camera.porch': { device_id: 'porch' },
  'binary_sensor.garden_motion': { device_id: 'garden' },
  'event.garden_bell': { device_id: 'garden' },
  'binary_sensor.porch_motion': { device_id: 'porch' },
  'event.house_bell': { device_id: 'house' },
  'sensor.not_a_trigger': { device_id: 'garden' },
});
Object.assign(hassWithCamera.states, {
  'camera.porch': { state: 'streaming', attributes: { friendly_name: 'Porch camera' } },
  'binary_sensor.garden_motion': { state: 'on', attributes: { friendly_name: 'Garden motion' } },
  'event.garden_bell': { state: 'pressed', attributes: { friendly_name: 'Garden bell' } },
  'binary_sensor.porch_motion': { state: 'on', attributes: { friendly_name: 'Porch motion' } },
  'event.house_bell': { state: 'pressed', attributes: { friendly_name: 'House bell' } },
  'sensor.not_a_trigger': { state: 'on', attributes: { friendly_name: 'Garden sensor' } },
});
stored.cameras = [
  { device_id: 'garden', entity_id: 'camera.garden', name: 'Garden',
    doorbell_triggers: ['event.missing_doorbell'], detection_triggers: ['binary_sensor.garden_motion'] },
  { device_id: 'porch', entity_id: 'camera.porch', name: 'Porch' },
];
const writesBeforeTriggerLists = calls.filter((message) => message.type === 'casora/settings/set').length;
panel._cs.loaded = false;
await panel._csLoad();
renderCameras();
const triggerPickers = () => panel.combos.filter((combo) => combo.opts && combo.opts.entity);
assert.equal(triggerPickers().length, 4, 'each configured camera has independent doorbell and detection pickers');
assert.deepEqual(triggerPickers()[0].options.slice(0, 3), [
  'event.garden_bell', 'binary_sensor.garden_connected', 'binary_sensor.garden_motion',
],
  'the camera device suggestions lead each list');
assert.ok(triggerPickers()[0].options.includes('event.garden_bell'), 'event entities can be selected');
assert.ok(triggerPickers()[0].options.includes('event.house_bell'), 'events from another device can be selected');
assert.ok(triggerPickers()[0].options.includes('binary_sensor.porch_motion'), 'binary sensors from another device can be selected');
assert.ok(triggerPickers()[0].options.includes('binary_sensor.garden_motion'), 'an existing source can be reused in another role');
assert.ok(!triggerPickers()[0].options.includes('sensor.not_a_trigger'), 'other entity domains are not offered');
assert.ok(!triggerPickers()[1].options.includes('binary_sensor.garden_motion'), 'a source is not duplicated within one role');
assert.match(allText(host), /Not found in Home Assistant/, 'a trigger missing from HA remains visible');
assert.match(allText(host), /Garden motion/, 'selected triggers display their Home Assistant names');
assert.equal(calls.filter((message) => message.type === 'casora/settings/set').length, writesBeforeTriggerLists,
  'loading and rendering trigger lists do not save');

triggerPickers()[0].onChange('binary_sensor.garden_motion');
assert.deepEqual(panel._cs.S.cameras[0].doorbell_triggers, ['event.missing_doorbell', 'binary_sensor.garden_motion'],
  'the same trigger can be selected for the camera doorbell role');
triggerPickers()[3].onChange('binary_sensor.garden_motion');
assert.deepEqual(panel._cs.S.cameras[1].detection_triggers, ['binary_sensor.garden_motion'],
  'the same trigger can be reused for another camera');
const missingTriggerRow = elements(host, (node) => node.classList.contains('camera-trigger-row')
  && node.textContent.includes('Not found in Home Assistant'))[0];
assert.ok(missingTriggerRow, 'a missing trigger remains in the list');
const missingTriggerRemove = elements(missingTriggerRow, (node) => node.className === 'casora-x')[0];
assert.ok(missingTriggerRemove, 'a missing trigger has a remove control');
missingTriggerRemove.onclick();
assert.deepEqual(panel._cs.S.cameras[0].doorbell_triggers, ['binary_sensor.garden_motion'],
  'a missing trigger can be removed from the draft');
assert.equal(calls.filter((message) => message.type === 'casora/settings/set').length, writesBeforeTriggerLists,
  'trigger edits do not save early');
await panel._csDiscardAll();
assert.deepEqual(panel._cs.S.cameras, stored.cameras, 'Discard restores both saved trigger lists');

renderCameras();
triggerPickers()[0].onChange('binary_sensor.garden_motion');
triggerPickers()[3].onChange('binary_sensor.garden_motion');
await panel._csSave();
assert.deepEqual(stored.cameras, [
  { device_id: 'garden', entity_id: 'camera.garden', name: 'Garden',
    doorbell_triggers: ['event.missing_doorbell', 'binary_sensor.garden_motion'], detection_triggers: ['binary_sensor.garden_motion'] },
  { device_id: 'porch', entity_id: 'camera.porch', name: 'Porch', detection_triggers: ['binary_sensor.garden_motion'] },
], 'saving persists the independent lists while preserving source reuse');
assert.deepEqual(stored.scenes, { exclude: ['scene.olive'] }, 'saving trigger lists preserves unrelated settings');
console.log('ok camera_settings: draft, discard, order, remove, save isolation, trigger lists');

// Popup controls use the dashboard draft and never migrate the first tile.
panel._state.compact.rooms[1].tiles[0].variables.alert_window_minutes = 8;
panel._state.compact.rooms[1].tiles[0].variables.show_stream_variants = true;
panel.dashboardSaved = structuredClone(panel._state);
panel._lastPrint = JSON.stringify(panel._state);
panel._csOpen = true;
renderCameras();
const beforePopupRead = structuredClone(panel._state);
const popupNumber = () => elements(host, (node) => node.tagName === 'INPUT' && node.type === 'number')[0];
assert.equal(popupNumber().value, '8', 'the first tile provides the displayed number');
assert.deepEqual(panel._state, beforePopupRead, 'rendering fallback does not write to the dashboard or tile');
const streamSwitch = () => panel.switches.find(({ label }) => label === 'Show stream variants').button;
assert.equal(streamSwitch().getAttribute('aria-checked'), 'true', 'the other field independently inherits its tile value');
popupNumber().value = '14';
popupNumber().onchange();
assert.equal(panel._state.compact.rooms[0].variables.casora_camera_settings.garden.popup.alert_window_minutes, 14);
assert.equal(streamSwitch().getAttribute('aria-checked'), 'true', 'setting one field leaves the other inherited');
streamSwitch().onclick();
assert.equal(panel._state.compact.rooms[0].variables.casora_camera_settings.garden.popup.show_stream_variants, false);
assert.equal(panel._csDirty(), true, 'popup edits use the existing dashboard draft');
await panel._csDiscardAll();
assert.deepEqual(panel._state, beforePopupRead, 'Discard restores both popup fields and leaves the tile intact');
renderCameras();
popupNumber().value = '14';
popupNumber().onchange();
streamSwitch().onclick();
await panel._csSave();
await panel._load();
assert.deepEqual(panel._state.compact.rooms[0].variables.casora_camera_settings.garden.popup,
  { alert_window_minutes: 14, show_stream_variants: false }, 'both fields survive save and reload');
console.log('ok camera_settings: popup fallback, draft, discard, save and reload');

window.casoraCameraPopup.kind = (_h, id) => id === 'camera.garden' ? 'frigate' : 'camera';
window.casoraFrigateStreams = (phone) => () => ({
  options: phone ? ['', 'standard', 'garden_sub'] : ['', 'garden_sub'],
  labels: { '': phone ? 'Automatic' : 'Standard', standard: 'Standard', garden_sub: 'Sub stream · garden_sub' },
});
renderCameras();
assert.match(allText(host), /Stream in the popup \(default\)/, 'Frigate camera shows the popup stream field');
assert.match(allText(host), /Stream in the popup on the phone/, 'Frigate camera shows the phone stream field');
assert.ok(panel.combos.some((combo) => combo.options.includes('garden_sub')), 'the camera stream list is offered');
const frigateChoice = panel.combos.find((combo) => combo.options.includes('garden_sub') && !combo.options.includes('standard'));
const savedOpen = structuredClone(panel._state.compact.rooms[0].variables.casora_camera_settings.garden.open);
frigateChoice.onChange('garden_sub');
assert.equal(panel._state.compact.rooms[0].variables.casora_camera_settings.garden.popup.stream_popup, 'garden_sub');
assert.deepEqual(panel._state.compact.rooms[0].variables.casora_camera_settings.garden.open, savedOpen, 'popup edits leave opening choices alone');
await panel._csDiscardAll();
assert.equal(panel._state.compact.rooms[0].variables.casora_camera_settings.garden.popup.stream_popup, undefined, 'Discard restores popup settings');
window.casoraCameraPopup.kind = () => 'camera';
renderCameras();
assert.doesNotMatch(allText(host), /Stream in the popup \(default\)/, 'plain cameras do not show Frigate fields');

let destination = null;
panel._casoraPersonal = (options) => { destination = options; };
const link = panel._casoraSettingsLink({ settingsLink: 'cameras' }, { entity: 'camera.garden' });
assert.equal(link.textContent, 'Popup settings ›');
link.onclick();
assert.equal(panel._csCameraOpen, 'garden', 'the link opens the selected camera device');
assert.deepEqual(destination, { focus: 'cameras' }, 'the link navigates to Cameras settings');

// Doorbell-only popup controls use the same dashboard draft as the camera settings.
window.casoraCameraPopup.kind = (_h, id) => id === 'camera.garden' ? 'doorbell' : 'camera';
renderCameras();
assert.ok(panel.switches.some(({ label }) => label === 'Talk (experiment)'), 'doorbell shows talk');
assert.ok(panel.switches.some(({ label }) => label === 'Large picture when listening/talking'), 'doorbell shows audio size');
assert.match(allText(host), /Second camera/, 'doorbell shows second camera');
assert.equal(panel.switches.filter(({ label }) => label === 'Show stream variants').length, 1, 'only the plain camera shows stream variants');
const oldOpen = structuredClone(panel._state.compact.rooms[0].variables.casora_camera_settings.garden?.open);
panel.switches.find(({ label }) => label === 'Talk (experiment)').button.onclick();
assert.equal(panel._state.compact.rooms[0].variables.casora_camera_settings.garden.popup.talk, true);
assert.deepEqual(panel._state.compact.rooms[0].variables.casora_camera_settings.garden.open, oldOpen);
await panel._csDiscardAll();
window.casoraCameraPopup.kind = () => 'camera';
renderCameras();
assert.ok(!panel.switches.some(({ label }) => label === 'Talk (experiment)'), 'plain camera never shows talk');
assert.doesNotMatch(allText(host), /Second camera/, 'plain camera does not show doorbell fields');

// Conflicting legacy values must be resolved explicitly in the dashboard draft.
window.casoraCameraPopup.kind = () => 'camera';
panel._state.compact.rooms[1].title = 'Room A';
panel._state.compact.rooms[1].tiles = [
  { entity: 'camera.garden', name: 'Tile A', variables: { alert_window_minutes: 8 } },
  { entity: 'camera.garden', name: 'Tile B', variables: { alert_window_minutes: 12 } },
];
delete panel._state.compact.rooms[0].variables.casora_camera_settings.garden.popup;
panel.dashboardSaved = structuredClone(panel._state);
renderCameras();
const conflictText = 'Press here to resolve a conflict between different camera tiles';
assert.ok(allText(host).includes(conflictText), 'different saved tile values show a conflict');
const tilesBeforeConflict = structuredClone(panel._state.compact.rooms[1].tiles);
const conflictLine = () => buttons(host, conflictText)[0];
conflictLine().onclick();
let choices = elements(host, (node) => node.tagName === 'BUTTON' && /Tile [AB].*Room A/.test(node.textContent));
assert.equal(choices.length, 2, 'one choice per tile');
choices[1].onclick();
assert.equal(panel._state.compact.rooms[0].variables.casora_camera_settings.garden.popup.alert_window_minutes, 12);
assert.equal(panel.dashboardSaved.compact.rooms[0].variables.casora_camera_settings.garden.popup, undefined, 'choice remains a draft');
await panel._csDiscardAll();
renderCameras();
assert.ok(conflictLine(), 'Discard restores conflict');
conflictLine().onclick();
choices = elements(host, (node) => node.tagName === 'BUTTON' && /Tile [AB].*Room A/.test(node.textContent));
choices[1].onclick();
await panel._csSave();
renderCameras();
assert.equal(conflictLine(), undefined, 'Save keeps resolution');
assert.deepEqual(panel._state.compact.rooms[1].tiles, tilesBeforeConflict, 'tile values stay untouched');
delete panel._state.compact.rooms[0].variables.casora_camera_settings.garden.popup;
panel._state.compact.rooms[1].tiles[1].variables.alert_window_minutes = 8;
renderCameras();
assert.equal(conflictLine(), undefined, 'equal values are not a conflict');
assert.equal(popupNumber().value, '8', 'equal value carries over');
for (const [family, field, a, b] of [['frigate', 'stream_popup', 'one', 'two'], ['doorbell', 'talk', false, true]]) {
  window.casoraCameraPopup.kind = () => family;
  panel._state.compact.rooms[1].tiles.forEach((tile, index) => { tile.variables[field] = index ? b : a; });
  renderCameras();
  assert.ok(conflictLine(), family + ' fields detect conflicts');
  conflictLine().onclick();
  choices = elements(host, (node) => node.tagName === 'BUTTON' && /Tile [AB].*Room A/.test(node.textContent));
  choices[1].onclick();
  assert.equal(panel._state.compact.rooms[0].variables.casora_camera_settings.garden.popup[field], b);
  delete panel._state.compact.rooms[0].variables.casora_camera_settings.garden.popup;
}
console.log('ok camera_settings: conflicts, choices, draft, discard and save for all families');
window.casoraCameraPopup.kind = () => 'camera';
panel._state.compact.rooms[1].tiles = [];
panel._pair = { mobile: { compact: { rooms: [{ title: 'Phone', tiles: [
  { entity: 'camera.garden', name: 'Phone A', variables: { alert_window_minutes: 7 } },
  { entity: 'camera.garden', name: 'Phone B', variables: { alert_window_minutes: 11 } },
] }] } } };
renderCameras();
assert.equal(popupNumber().value, '7', 'first phone-only tile supplies the fallback');
assert.ok(conflictLine(), 'different phone-only tile values produce a conflict');
const loadedPopupModule = window.casoraCameraPopup;
delete window.casoraCameraPopup;
assert.doesNotThrow(() => renderCameras(), 'camera settings render while the popup module is loading');
window.casoraCameraPopup = loadedPopupModule;

// The tile filter lives in a dashboard script: a fresh Studio load has not run it. The Cameras section loads it
// once and draws again, so stream variants never stay in the "Add a camera" list.
{
  const savedHass = panel._hass, savedSoft = window._casoraCamSoft, savedImport = window.casoraImportScript;
  const savedCameras = panel._cs.S.cameras;
  panel._hass = { ...hass };
  panel._cs.S.cameras = [];
  delete window._casoraCamSoft;
  delete window._casoraCameraSettingsModules;
  const imported = [];
  window.casoraImportScript = (path) => {
    imported.push(path);
    if (path.endsWith('07-weich-spezial.js')) window._casoraCamSoft = realSoft;
    return Promise.resolve();
  };
  renderCameras();
  assert.ok(imported.includes('local/07-weich-spezial.js'), 'without the tile filter the Cameras section loads its script');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(cameraPicker().options.slice().sort(), ['camera.detached', 'camera.driveway_main', 'camera.garage'],
    'after the load the list is drawn again: one entry per camera device, two NVR cameras stay two');
  const loads = imported.filter((path) => path.endsWith('07-weich-spezial.js')).length;
  renderCameras();
  assert.equal(imported.filter((path) => path.endsWith('07-weich-spezial.js')).length, loads, 'a loaded filter is not loaded again');
  panel._hass = savedHass; panel._cs.S.cameras = savedCameras; window._casoraCamSoft = savedSoft; window.casoraImportScript = savedImport;
}

// #87: the Cameras section says "popup" in NL and PT, never the global "Venster"/"janela".
{
  const panelText = (lang) => JSON.parse(fs.readFileSync(new URL(`../../custom_components/casora/translations/panel/${lang}.json`, import.meta.url), 'utf8')).exact;
  const keys = Object.keys(panelText('nl')).filter((key) => /^Optional\. Another camera/.test(key));
  assert.equal(keys.length, 3, 'three Cameras hints mention the popup');
  for (const key of keys) {
    assert.doesNotMatch(panelText('nl')[key], /venster/i, `NL says popup: ${key.slice(0, 50)}`);
    assert.doesNotMatch(panelText('pt')[key], /janela/i, `PT says popup: ${key.slice(0, 50)}`);
  }
}
