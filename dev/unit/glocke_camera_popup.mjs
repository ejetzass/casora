// A tap on an "erkannt" row in the bell opens that camera's popup; the row keeps its text and its read state.
// A doorbell row keeps its own rule: it opens no camera popup.
// @deckt: custom_components/casora/scripts/casora-core.js#_casoraNotify,openTarget
// @deckt: custom_components/casora/scripts/local/25-camera-popup.js#casoraCameraPopup
// node dev/unit/glocke_camera_popup.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import './_detection_rule.mjs'; // the bell reads the shared detection rule (#509)

const core = fs.readFileSync(new URL('../../custom_components/casora/scripts/casora-core.js', import.meta.url), 'utf8');
const start = core.indexOf('(function () {\n  if (window._casoraNotify) return;');
assert.ok(start > 0, 'bell module found');
const mod = core.slice(start, core.indexOf('\n})();', start) + 6);
const opener = fs.readFileSync(new URL('../../custom_components/casora/scripts/local/25-camera-popup.js', import.meta.url), 'utf8');

const camel = (name) => name.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase());

// A DOM small enough for the bell: the rows come from the fake UI.group as JSON.
class Element {
  constructor() {
    this.style = { setProperty() {}, removeProperty() {} };
    this.dataset = {};
    this.attrs = {};
    this.children = [];
    this.listeners = {};
    this.classList = { contains: (c) => String(this.className || '').split(' ').includes(c), toggle() {} };
  }
  get nextElementSibling() {
    const list = this.parentNode ? this.parentNode.children : [];
    return list[list.indexOf(this) + 1] || null;
  }
  appendChild(el) { this.children.push(el); el.parentNode = this; return el; }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((el) => el !== this);
    this.parentNode = null;
  }
  setAttribute(name, value) {
    this.attrs[name] = value;
    if (name.startsWith('data-')) this.dataset[camel(name)] = value;
  }
  removeAttribute(name) {
    delete this.attrs[name];
    if (name.startsWith('data-')) delete this.dataset[camel(name)];
  }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  getBoundingClientRect() { return { top: 50, bottom: 100, left: 0, right: 300, width: 300, height: 50 }; }
  getRootNode() { return this; }
  getClientRects() { return [1]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((x) => x !== fn); }
  querySelector() { return null; }
  querySelectorAll(sel) {
    const all = this.children.flatMap((el) => [el, ...el.querySelectorAll('*')]);
    return sel === '*' ? all : all.filter((el) => el.className === sel.slice(1));
  }
  set innerHTML(value) {
    this.children = [];
    const body = String(value || '').replace(/^<style>[\s\S]*?<\/style>/, '');
    for (const row of body.startsWith('[') ? JSON.parse(body) : []) {
      const el = this.appendChild(new Element());
      el.className = 'hui-row';
      el.textContent = row.label;
      el.dataset.casoraMi = row.entity;
    }
  }
}

// A card only another user sees: for our user the entity is hidden.
const hiddenConfig = (entityId) => ({ views: [{ path: 'home', cards: [
  { type: 'custom:button-card', entity: entityId, visibility: [{ condition: 'user', users: ['other-user'] }] }] }] });

async function setup(options = {}) {
  const sensor = 'binary_sensor.mock_person';
  const camera = 'camera.mock_cam';
  const doorbell = 'event.mock_front_door';
  const when = Date.now() - 60000;
  const cameras = options.cameras || [{ entity_id: camera,
    detection_triggers: options.detection ? [sensor] : [],
    doorbell_triggers: options.listedDoorbell ? [doorbell] : [] }];
  const states = {
    [sensor]: { entity_id: sensor, state: options.sensorState || 'on', attributes: { friendly_name: 'Mock Person' } },
  };
  cameras.forEach((c) => {
    if (c && c.entity_id && !states[c.entity_id]) {
      states[c.entity_id] = { entity_id: c.entity_id, state: 'idle', attributes: { friendly_name: 'Mock Camera' } };
    }
  });
  const entries = [];
  if (options.doorbell || options.listedDoorbell) {
    states[doorbell] = { entity_id: doorbell, state: new Date(when).toISOString(),
      attributes: { friendly_name: 'Mock Front Door', device_class: 'doorbell' } };
    entries.push({ entity_id: doorbell, state: states[doorbell].state, when: when / 1000 });
  }
  if (options.detection) entries.push({ entity_id: sensor, state: 'on', when: when / 1000 });
  const hass = {
    user: { id: 'mock-user' },
    states, entities: {}, devices: {}, areas: {},
    callWS: async (msg) => {
      if (msg.type === 'logbook/get_events') return entries;
      if (msg.type === 'history/history_during_period') {
        // The sensor was off before the logbook window: the press counts as off to on.
        return { [sensor]: [{ s: 'off', lu: (when - 40 * 3600 * 1000) / 1000 }] };
      }
      return [];
    },
  };

  const store = { casora_notify_read_v1: String(Date.now() - 3600000) };
  globalThis.window = globalThis;
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  globalThis.location = { pathname: '/mock/home', search: '' };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.innerWidth = 1200;
  globalThis.screen = { width: 1200, height: 900 };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.dispatchEvent = () => true;
  globalThis.setInterval = () => 0;
  // The frame timers of the bell (one frame before the tap): they run right away.
  globalThis.setTimeout = (fn, ms) => { if (ms <= 100) fn(); return 0; };
  globalThis.clearTimeout = () => {};
  globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
  globalThis.Event = class { constructor(t) { this.type = t; } };
  globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
  const page = new Element();
  const notifications = [];
  const documentListeners = [];
  const homeAssistant = { hass, dispatchEvent: (ev) => { notifications.push(ev); return true; } };
  globalThis.document = {
    readyState: 'complete', hidden: false, body: page, documentElement: new Element(), head: new Element(),
    querySelector: (q) => (q === 'home-assistant' ? homeAssistant : null),
    querySelectorAll: () => [],
    addEventListener: (type, fn) => { if (type === 'click') documentListeners.push(fn); },
    getElementById: () => null,
    createElement: () => new Element(),
  };
  window.casoraSecurityIcon = () => 'camera';
  window.casoraHaptic = () => {};
  window.casoraTr = (x) => x;
  window.casoraMenuGlass = { radius: '20px', apply() {}, lockScroll() {}, dropTop: () => 50, enter() {}, exit() {} };
  window.casoraPopup = { element: null, open() {}, close() {}, moreInfo() {} };
  window._casoraUI = { tokens: { font: 'mock' }, group: (rows) => JSON.stringify(rows) };
  window._casoraCfgOnce = async () => (options.hidden ? hiddenConfig(options.hidden) : { views: [] });
  window.CASORA_SETTINGS = { cameras };

  // The shared opener of the camera popup: it is what a tile tap uses as well.
  const opened = [];
  window._casoraNotifyOpenViaCard = (id, done, cfg) => { opened.push({ id, cfg }); done(true); };
  delete window._casoraNotify;
  delete window.casoraCameraPopup;
  new Function(mod)();
  new Function(opener)();

  const N = window._casoraNotify;
  await N.refresh();
  N.open(new Element());
  const menu = page.children[0];
  const list = menu.children[0].children.find((el) => el.querySelectorAll('.hui-row').length);
  const row = (label) => list.querySelectorAll('.hui-row').find((el) => el.textContent === label);
  // The document's capture handler of the core: a row that still carries a more-info target opens HA's dialog.
  const moreInfo = [];
  documentListeners.push((e) => {
    const path = (e.composedPath && e.composedPath()) || [];
    for (const n of path) {
      if (n && n.dataset && n.dataset.casoraMi) { moreInfo.push(n.dataset.casoraMi); return; }
    }
  });
  const click = async (target) => {
    const event = { composedPath: () => [target, list], preventDefault() {}, stopPropagation() {} };
    // The document's capture handler runs before the bell's own.
    for (const fn of documentListeners) fn(event);
    for (const fn of list.listeners.click || []) fn(event);
    // The route waits for the dashboard config.
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  return { N, list, row, click, opened, moreInfo, notifications, store, sensor, camera, doorbell };
}

// The detection row opens the popup of its camera.
const bell = await setup({ detection: true });
assert.equal(bell.N.rows.length, 1, 'the detection is one row');
assert.equal(bell.N.rows[0].label, 'Mock Person erkannt', 'the row says that the person was detected');
const rows = JSON.stringify(bell.N.rows);
const count = bell.N.count;
const store = JSON.stringify(bell.store);
assert.equal(count, 1, 'the row is new (unread)');
const detection = bell.row('Mock Person erkannt');
assert.ok(detection, 'the bell lists the detection row');
assert.equal(detection.dataset.casoraMi, undefined, 'the row has no more-info target any more');
assert.equal(detection.dataset.casoraOpen, 'casora:detection', 'the row carries the route to the camera popup');
await bell.click(detection);
assert.deepEqual(bell.opened.map((o) => o.id), [bell.camera], 'the tap opens the popup of that camera');
assert.equal(bell.opened.length, 1, 'one popup, no second one');
assert.deepEqual(bell.moreInfo, [], 'no more-info dialog opens next to the popup');
assert.equal(bell.opened[0].cfg.template, 'casora_camera', 'the popup shows the camera card');
assert.equal(bell.opened[0].cfg.entity, bell.camera);
assert.deepEqual(bell.opened[0].cfg.variables.cameras, [bell.camera], 'the popup shows that camera alone');
assert.equal(bell.N.rows[0].label, 'Mock Person erkannt', 'the row keeps its text');
assert.equal(JSON.stringify(bell.N.rows), rows, 'the row stays as it is');
assert.equal(bell.N.count, count, 'the row keeps its read state');
assert.equal(JSON.stringify(bell.store), store, 'the tap does not change the persisted read state');

// A trigger sensor that is hidden for this user does not block the camera's popup.
const hiddenSensor = await setup({ detection: true, hidden: 'binary_sensor.mock_person' });
await hiddenSensor.click(hiddenSensor.row('Mock Person erkannt'));
assert.deepEqual(hiddenSensor.opened.map((o) => o.id), [hiddenSensor.camera], 'the hidden sensor does not block the camera');

// A trigger sensor that is unavailable does not block the camera's popup either.
const unavailable = await setup({ detection: true, sensorState: 'unavailable' });
await unavailable.click(unavailable.row('Mock Person erkannt'));
assert.deepEqual(unavailable.opened.map((o) => o.id), [unavailable.camera], 'the unavailable sensor does not block the camera');

// A camera that is hidden for this user opens no popup.
const hiddenCamera = await setup({ detection: true, hidden: 'camera.mock_cam' });
await hiddenCamera.click(hiddenCamera.row('Mock Person erkannt'));
assert.deepEqual(hiddenCamera.opened, [], 'the hidden camera opens no popup');
assert.equal(hiddenCamera.notifications.length, 1, 'the user gets the note that the device is hidden');

// A trigger that two cameras list belongs to the first camera of the Studio list.
const shared = await setup({ detection: true, cameras: [
  { entity_id: 'camera.mock_cam', detection_triggers: ['binary_sensor.mock_person'] },
  { entity_id: 'camera.mock_cam_two', detection_triggers: ['binary_sensor.mock_person'] },
] });
await shared.click(shared.row('Mock Person erkannt'));
assert.deepEqual(shared.opened.map((o) => o.id), ['camera.mock_cam'], 'the first camera of the list owns the tap');

// A doorbell row keeps its own rule: it opens no camera popup.
const ring = await setup({ doorbell: true });
assert.equal(ring.N.rows.length, 1, 'the ring is one row');
assert.equal(ring.N.rows[0].label, 'Mock Front Door hat geklingelt');
await ring.click(ring.row('Mock Front Door hat geklingelt'));
assert.deepEqual(ring.opened, [], 'a doorbell row opens no camera popup');

// A doorbell listed at a camera keeps PR 1's doorbell row and opens no camera popup.
const listedRing = await setup({ listedDoorbell: true });
assert.equal(listedRing.N.rows.length, 1, 'the listed doorbell is one row');
assert.equal(listedRing.N.rows[0].label, 'Mock Front Door hat geklingelt', 'a listed doorbell keeps the doorbell row');
await listedRing.click(listedRing.row('Mock Front Door hat geklingelt'));
assert.deepEqual(listedRing.opened, [], 'a listed doorbell row opens no camera popup');

console.log('glocke_camera_popup: a tap on an "erkannt" row opens that camera');
