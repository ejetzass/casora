// Ring popup lifecycle at the public browser boundary, with fake time and storage.
// @deckt: custom_components/casora/scripts/local/45-ring-popup.js#_casoraRingPopup custom_components/casora/scripts/local/26-camera-triggers.js#_casoraCameraTriggers custom_components/casora/scripts/local/01-basis.js#openViaCard
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
// casoraTriggerIds lives in casora-core.js, which these tests do not load: run that one helper before 26.
const triggerIdsSource = (() => {
  const core = fs.readFileSync(new URL('../../custom_components/casora/scripts/casora-core.js', import.meta.url), 'utf8');
  return core.slice(core.indexOf('  function triggerIds('), core.indexOf('  window.casoraTriggerIds = triggerIds;')) + '  window.casoraTriggerIds = triggerIds;';
})();

const root = new URL('../../custom_components/casora/scripts/local/', import.meta.url);
const press = '2026-11-12T12:00:00.000Z';
let now = Date.parse(press);
class Clock extends Date { static now() { return now; } }
const storage = new Map();
const hass = {
  // A real dashboard route is a Lovelace panel; every other HA page is not.
  panels: {
    'mock-dashboard': { component_name: 'lovelace' },
    'other-dashboard': { component_name: 'lovelace' },
    config: { component_name: 'config' },
    history: { component_name: 'history' },
    'developer-tools': { component_name: 'developer-tools' },
    'casora-studio': { component_name: 'casora-studio' },
  },
  entities: {
    'camera.mock_sub': { device_id: 'mock', platform: 'reolink', translation_key: 'sub' },
    'binary_sensor.mock_press': { device_id: 'mock', platform: 'reolink', translation_key: 'visitor' },
  },
  states: { 'binary_sensor.mock_press': { state: 'on', last_changed: press } },
};
const tile = { type: 'custom:button-card', template: 'casora_reolink_doorbell', entity: 'camera.mock_sub', variables: {} };
const flush = () => new Promise(resolve => setImmediate(resolve));
const cfg = { views: [{ cards: [tile] }, { cards: [] }] };
function load(options = {}) {
  const events = {}, timers = [], cleared = [], opened = [], notifyCalls = [], cfgCalls = [];
  const deadlines = new Map();
  let nextTimer = 0, backs = 0;
  let failCfg = !!options.failCfg;
  const element = new EventTarget();
  element.isConnected = true;
  // The real popup element: P.back() marks the return (_navBackAt) and calls the element's ‹ function (_backFn).
  Object.defineProperty(element, '_navBackAt', { set() { backs++; }, get() { return 0; } });
  element.hasAttribute = name => name === 'open' && window.casoraPopup.current !== null;
  const store = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
  // While the modules load there is no Home Assistant page yet (44 would start itself): tests start the watcher themselves.
  let ready = false;
  const listen = (k, fn) => {
    const previous = events[k];
    events[k] = previous ? () => { previous(); fn(); } : fn;
  };
  const document = { hidden: !!options.hidden, querySelector: () => ready ? { hass } : null, addEventListener: listen };
  const window = { document, location: { pathname: options.route || '/mock-dashboard/empty' }, localStorage: store, sessionStorage: store,
    casoraIsWallTablet: () => true,
    setInterval: fn => { timers.push(fn); return timers.length; }, clearInterval: id => { cleared.push(id); }, addEventListener: listen,
    setTimeout: (fn, delay) => { deadlines.set(++nextTimer, { fn, at: now + delay }); return nextTimer; },
    clearTimeout: id => deadlines.delete(id),
    _casoraCfgOnce: async (h, url) => { cfgCalls.push(url); if (failCfg) throw new Error('no config'); return cfg; },
    casoraPopup: { enabled: true, current: null,
      entity: null, surface: element, element,
      open(c) { this.current = c; this.entity = c._entity || null; element._backFn = window._casoraBackNext ? window._casoraBackNext.fn : null; window._casoraBackNext = null; opened.push(c); },
      close() { this.current = null; this.entity = null; element.dispatchEvent(new Event('casora-popup-closed')); } },
    _casoraOpenViaCard: (id, done, o) => {
      const { cfg: card, noTile, checked, canOpen } = o;
      const call = { id, done, card, noTile, checked, canOpen };
      notifyCalls.push(call);
      if (options.notify) return options.notify(call);
      if (typeof canOpen === 'function' && canOpen() === false) return done(false);
      window.casoraPopup.open(card); done(true);
    },
  };
  const context = vm.createContext({ window, document, Date: Clock, JSON, Object, Number });
  vm.runInContext(triggerIdsSource, context);
  for (const name of ['00-finder.js', '26-camera-triggers.js', '45-ring-popup.js']) vm.runInContext(fs.readFileSync(new URL(name, root), 'utf8'), context);
  ready = true;
  function advance(ms) {
    const until = now + ms;
    while (true) {
      const due = [...deadlines].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; deadlines.delete(due[0]); due[1].fn();
    }
    now = until;
  }
  return { window, document, context, opened, notifyCalls, cfgCalls, events, timers, cleared, advance, element, deadlines,
    backCount: () => backs, popup: { refresh() {
      const id = hass.states['binary_sensor.mock_press'].last_changed;
      window._casoraRingPopup.open({ entity: 'binary_sensor.mock_press', at: Date.parse(id), id, role: 'doorbell', camera: tile.entity, name: 'Mock press' }, tile);
    } }, setFailCfg: value => { failCfg = value; } };
}
{
  storage.clear();
  const originalViews = cfg.views;
  cfg.views = [{ path: 'home', cards: [] }];
  const id = new Date(now).toISOString();
  hass.states['event.mock_detection'] = { state: id, attributes: { friendly_name: 'Naam-Detectie' } };
  const install = h => {
    h.window.CASORA_SETTINGS = { cameras: [{ entity_id: 'camera.mock_sub',
      detection_triggers: ['event.mock_detection'] }] };
    vm.runInContext(fs.readFileSync(new URL('25-camera-popup.js', root), 'utf8'), h.context);
    vm.runInContext(triggerIdsSource, h.context);
  };
  const hidden = load({ hidden: true });
  install(hidden);
  await flush();
  assert.equal(hidden.notifyCalls.length, 0, 'a hidden page opens nothing');
  hidden.document.hidden = false;
  hidden.events.visibilitychange();
  await flush();
  assert.equal(hidden.notifyCalls.length, 0, 'without the house switch no detection opens on visibility return');
  const reload = load();
  install(reload);
  await flush();
  assert.equal(reload.opened.length, 0, 'a reload opens nothing');
  storage.clear();
  cfg.views[0].cards = [{ template: 'casora_mobile_bg' }];
  // A phone-size screen is not a Wall tablet: the Wall tablet check alone decides, whatever the layout.
  const phone = load();
  phone.window.casoraIsWallTablet = () => false;
  install(phone);
  await flush();
  assert.equal(phone.opened.length, 0, 'a phone-size screen opens nothing');
  cfg.views[0].cards = [];
  const studio = load({ route: '/casora-studio/empty' });
  install(studio);
  await flush();
  assert.equal(studio.opened.length, 0, 'the Studio opens nothing');
  const disabled = load();
  disabled.window.casoraPopup.enabled = false;
  install(disabled);
  await flush();
  assert.equal(disabled.opened.length, 0, 'popups off open nothing');
  cfg.views = originalViews;
  delete hass.states['event.mock_detection'];
}
console.log('ring popup: the real watcher opens nothing without the house switch');

// ── A listed ring opens the camera popup ────────────────────────────────────────────────────────────────────────────────
// One house with three kinds of camera: a Ring-style camera (an event with a time), a Reolink-style doorbell
// (a sensor that counts only on a change from off to on) and a Frigate object sensor (a sensor with a name
// of its own). The house switch and the switch of the camera decide.
function ringHouse() {
  storage.clear();
  const h = load();
  const pressState = hass.states['binary_sensor.mock_press'];
  const saved = Object.assign({}, pressState);
  const ringAt = new Date(now).toISOString();
  hass.states['event.mock_ring'] = { state: ringAt, attributes: { friendly_name: 'Mock ring' } };
  hass.states['binary_sensor.mock_press'] = { state: 'off', attributes: { friendly_name: 'Mock press' } };
  hass.states['binary_sensor.mock_object'] = { state: 'off', attributes: { friendly_name: 'Driveway object' } };
  h.window.CASORA_SETTINGS = {
    camera_popup: { open_by_itself: true },
    cameras: [
      { entity_id: 'camera.mock_ring', doorbell_triggers: ['event.mock_ring'] },
      { entity_id: 'camera.mock_sub', doorbell_triggers: ['binary_sensor.mock_press'] },
      { entity_id: 'camera.mock_frigate', doorbell_triggers: ['binary_sensor.mock_object'] },
    ],
  };
  vm.runInContext(fs.readFileSync(new URL('25-camera-popup.js', root), 'utf8'), h.context);
  // The event carries its own time; the two sensors have to change from off to on.
  const seen = h.window._casoraCameraTriggers.scan(hass);
  for (const id of ['binary_sensor.mock_press', 'binary_sensor.mock_object']) {
    hass.states[id].state = 'on';
    hass.states[id].last_changed = new Date(now).toISOString();
  }
  const occurrences = seen.concat(h.window._casoraCameraTriggers.scan(hass));
  hass.states['binary_sensor.mock_press'] = saved;
  return { h, occurrences };
}
{
  const { h, occurrences } = ringHouse();
  assert.equal(occurrences.length, 3, 'the event and the two sensors fired');
  assert.equal(occurrences.find(o => o.camera === 'camera.mock_frigate').name, 'Driveway object',
    'the Frigate object sensor brings its own name');
  // The house switch off: nothing opens.
  h.window.CASORA_SETTINGS = { cameras: h.window.CASORA_SETTINGS.cameras };
  for (const occurrence of occurrences) await h.window._casoraCameraTriggers.dispatch(hass, [occurrence]);
  assert.equal(h.opened.length, 0, 'without the house switch no ring opens a popup');
}
{
  // The house switch on: every kind of camera opens its own popup.
  const { h, occurrences } = ringHouse();
  for (const occurrence of occurrences) await h.window._casoraCameraTriggers.dispatch(hass, [occurrence]);
  assert.deepEqual(h.opened.map(c => c.entity), ['camera.mock_ring', 'camera.mock_sub', 'camera.mock_frigate'],
    'the Ring-style camera, the Reolink-style doorbell and the Frigate object sensor open their popup');
}
{
  // The switch of the camera: off means that camera opens nothing.
  const { h, occurrences } = ringHouse();
  h.window.CASORA_SETTINGS.cameras[0].open_on_ring = false;
  await h.window._casoraCameraTriggers.dispatch(hass, [occurrences[0]]);
  assert.equal(h.opened.length, 0, 'a camera whose ring switch is off opens nothing');
}
{
  // A detection switch defaults to off, even when the house switch is on.
  const { h } = ringHouse();
  hass.states['binary_sensor.mock_motion'] = { state: 'off', attributes: { friendly_name: 'Mock motion' } };
  h.window.CASORA_SETTINGS.cameras.push({ entity_id: 'camera.mock_detection',
    detection_triggers: ['binary_sensor.mock_motion'] });
  h.window._casoraCameraTriggers.scan(hass);
  hass.states['binary_sensor.mock_motion'].state = 'on';
  hass.states['binary_sensor.mock_motion'].last_changed = new Date(now).toISOString();
  const seen = h.window._casoraCameraTriggers.scan(hass);
  assert.equal(seen.length, 1, 'the motion sensor is a detection');
  await h.window._casoraCameraTriggers.dispatch(hass, seen);
  assert.equal(h.opened.length, 0, 'a detection opens no popup');
}
{
  const { h } = ringHouse();
  h.window.CASORA_SETTINGS.cameras = [
    { entity_id: 'camera.mock_detection', detection_triggers: ['binary_sensor.mock_motion'], open_on_detection: true },
    { entity_id: 'camera.mock_ring', doorbell_triggers: ['binary_sensor.mock_press'] },
  ];
  hass.states['binary_sensor.mock_motion'] = { state: 'off' };
  hass.states['binary_sensor.mock_press'] = { state: 'off' };
  h.window._casoraCameraTriggers.scan(hass);
  for (const id of ['binary_sensor.mock_motion', 'binary_sensor.mock_press']) {
    hass.states[id] = { state: 'on', last_changed: new Date(now).toISOString() };
  }
  const seen = h.window._casoraCameraTriggers.scan(hass);
  assert.equal(seen.length, 2, 'both enabled roles fire in the same scan');
  const detection = seen.filter(o => o.role === 'detection');
  h.window.CASORA_SETTINGS.camera_popup.open_by_itself = false;
  await h.window._casoraCameraTriggers.dispatch(hass, detection);
  assert.equal(h.opened.length, 0, 'the house switch also gates detection');
  h.window.CASORA_SETTINGS.camera_popup.open_by_itself = true;
  await h.window._casoraCameraTriggers.dispatch(hass, detection);
  assert.equal(h.opened[0]?.entity, 'camera.mock_detection', 'an enabled listed detection opens its camera');
}
// Each batch comes from one scan; each case has a fresh popup and occurrence store.
for (const scenario of ['ring wins', 'first detection wins', 'unlisted detection']) {
  const { h } = ringHouse();
  const cameras = [
    { entity_id: 'camera.mock_first', detection_triggers: ['binary_sensor.mock_first'], open_on_detection: true },
    { entity_id: 'camera.mock_second', detection_triggers: ['binary_sensor.mock_second'], open_on_detection: true },
    { entity_id: 'camera.mock_ring', doorbell_triggers: ['binary_sensor.mock_press'] },
  ];
  if (scenario === 'unlisted detection') cameras[0].detection_triggers = [];
  h.window.CASORA_SETTINGS.cameras = cameras;
  const ids = ['binary_sensor.mock_first', 'binary_sensor.mock_second', 'binary_sensor.mock_press'];
  for (const id of ids) hass.states[id] = { state: 'off' };
  h.window._casoraCameraTriggers.scan(hass);
  for (const id of ids) hass.states[id] = { state: 'on', last_changed: new Date(now).toISOString() };
  const seen = h.window._casoraCameraTriggers.scan(hass);
  if (scenario === 'ring wins') {
    assert.equal(seen.length, 3, 'two enabled detections and a ring fire in one scan');
    await h.window._casoraCameraTriggers.dispatch(hass, seen);
    assert.equal(h.opened[0]?.entity, 'camera.mock_ring', 'ring wins over enabled detections');
  } else if (scenario === 'first detection wins') {
    await h.window._casoraCameraTriggers.dispatch(hass, seen.filter(o => o.role === 'detection'));
    assert.equal(h.opened[0]?.entity, 'camera.mock_first', 'first camera in Studio wins among detections');
  } else {
    assert.ok(!seen.some(o => o.camera === 'camera.mock_first'), 'an unlisted detection is not attributed to the camera');
  }
}
delete hass.states['binary_sensor.mock_first'];
delete hass.states['binary_sensor.mock_second'];
delete hass.states['event.mock_ring'];
delete hass.states['binary_sensor.mock_object'];
delete hass.states['binary_sensor.mock_motion'];
console.log('ring popup: a listed ring opens the camera popup of its own camera');

// ── Finding 2: the shared opener itself revalidates after its asynchronous waits ──────────────────────────────────
const basis = fs.readFileSync(new URL('../../custom_components/casora/scripts/local/01-basis.js', import.meta.url), 'utf8');
function loadViaCard() {
  const state = { opened: [], done: [], timers: [], elements: [] };
  const stub = () => new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : k === 'then' ? () => stub() : stub(), apply: () => stub(), construct: () => stub() });
  const documentBase = {
    querySelector: q => q === 'home-assistant' ? { hass: { callWS() {} } } : null,
    addEventListener() {},
    createElement: () => {
      const el = { style: {}, parentNode: {}, setConfig(c) { this.config = c; },
        addEventListener(type, fn) { this.listeners = this.listeners || {}; this.listeners[type] = fn; },
        removeEventListener() {}, remove() {}, _handleAction() {} };
      state.elements.push(el);
      return el;
    },
    body: { appendChild() {} },
    documentElement: {},
  };
  const document = new Proxy(documentBase, { get: (t, k) => k in t ? t[k] : stub() });
  const window = { document, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    location: { pathname: '/mock-dashboard/0' }, localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null, setItem() {} },
    _casoraCfgOnce: () => Promise.resolve({ views: [] }),
    casoraPopup: { open: c => state.opened.push(c) } };
  const capture = fn => { state.timers.push(fn); };
  const context = vm.createContext({ window, document, location: window.location, console, setTimeout: capture, setInterval: () => 0,
    clearTimeout() {}, clearInterval() {}, JSON, Object, Array, String, Number, Date, Math, Promise, Map, Set, RegExp, Error,
    isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, CustomEvent: class {}, Event: class {}, HTMLElement: class {},
    customElements: { get: () => null, whenDefined: () => new Promise(() => {}) }, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: () => 0, MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
    IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} }, fetch: () => Promise.reject(new Error('offline')),
    navigator: { userAgent: 'node', language: 'de' }, matchMedia: () => ({ matches: false, addEventListener() {} }) });
  vm.runInContext(basis, context);
  state.timers.length = 0;
  return { state, window, notify: window._casoraOpenViaCard, positional: window._casoraNotifyOpenViaCard };
}
let screen;
const tileCfg = { type: 'custom:button-card', template: 'casora_reolink_doorbell', entity: 'camera.mock_sub' };
{
  storage.clear();
  const setup = hidden => {
    const h = load({ hidden });
    h.window.CASORA_SETTINGS = { cameras: [{ entity_id: 'camera.mock_sub', detection_triggers: ['event.listed'] }] };
    vm.runInContext(fs.readFileSync(new URL('25-camera-popup.js', root), 'utf8'), h.context);
    vm.runInContext(triggerIdsSource, h.context);
    return h;
  };
  hass.states['event.listed'] = { state: new Date(now).toISOString() };
  const h = setup(true);
  await flush();
  assert.equal(h.opened.length, 0, 'the watcher opens nothing on a hidden page');
  h.document.hidden = false;
  h.events.visibilitychange();
  await flush();
  assert.equal(h.opened.length, 0, 'the visibility return opens nothing without the house switch');
  const reloaded = setup(false);
  await flush();
  assert.equal(reloaded.opened.length, 0, 'the actual watcher opens nothing after a reload');
  delete hass.states['event.listed'];
}
{
  storage.clear();
  const h = load();
  h.window.CASORA_SETTINGS = { cameras: [{
    entity_id: 'camera.mock_sub', detection_triggers: ['event.mock_listed'],
  }] };
  vm.runInContext(fs.readFileSync(new URL('25-camera-popup.js', root), 'utf8'), h.context);
  // Avoid starting the interval in this seam test; drive the actual consumer explicitly.
  const interval = h.window.setInterval;
  h.window.setInterval = null;
  vm.runInContext(triggerIdsSource, h.context);
  vm.runInContext(fs.readFileSync(new URL('26-camera-triggers.js', root), 'utf8'), h.context);
  h.window.setInterval = interval;
  const id = new Date(now).toISOString();
  const occurrence = h.window._casoraCameraTriggers.scan({ states: {
    'event.mock_listed': { state: id, attributes: { friendly_name: 'Mock bell' } },
  } });
  assert.equal(occurrence.length, 1, 'the listed trigger is an occurrence');
  await h.window._casoraCameraTriggers.dispatch(hass, occurrence);
  assert.equal(h.notifyCalls.length, 0, 'a listed trigger reaches no popup without the house switch');
}
{
  const h = loadViaCard();
  let release, allowed = true;
  h.window._casoraCfgOnce = () => new Promise(resolve => { release = resolve; });
  h.notify('camera.mock_sub', ok => h.state.done.push(ok), { noTile: true, checked: true, canOpen: () => allowed });
  allowed = false;
  release({ views: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.state.done, [false], 'a route change during the config load cancels the shared opener');
  assert.equal(h.state.timers.length, 0, 'no hidden popup card is built after cancellation');
}
{
  const h = loadViaCard();
  let allowed = true;
  h.notify('camera.mock_sub', ok => h.state.done.push(ok), { cfg: tileCfg, noTile: true, checked: true, canOpen: () => allowed });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.timers.length, 1, 'the synthetic tap is delayed');
  h.state.timers.shift()();
  const take = h.state.elements[0].listeners['hass-action'];
  assert.equal(typeof take, 'function');
  allowed = false;
  take({ stopPropagation() {}, detail: { config: { tap_action: { casora_popup: { title: 'doorbell' } } } } });
  assert.equal(h.state.opened.length, 0, 'a hidden page cancels the delayed synthetic tap');
  assert.deepEqual(h.state.done, [false]);
}
{
  const h = loadViaCard();
  h.notify('camera.mock_sub', ok => h.state.done.push(ok), { cfg: tileCfg, noTile: true, checked: true, canOpen: () => true });
  await new Promise(resolve => setImmediate(resolve));
  h.state.timers.shift()();
  const take = h.state.elements[0].listeners['hass-action'];
  take({ stopPropagation() {}, detail: { config: { tap_action: { casora_popup: { title: 'doorbell' } } } } });
  assert.equal(h.state.opened.length, 1, 'a visible dashboard still opens through the synthetic tap');
  assert.deepEqual(h.state.done, [true]);
}
{
  const h = loadViaCard();
  let go, allowed = true;
  h.window.casoraUserGuard = (id, callback) => { go = callback; };
  h.notify('camera.mock_sub', ok => h.state.done.push(ok), { cfg: tileCfg, noTile: true, checked: false, canOpen: () => allowed });
  assert.equal(typeof go, 'function', 'the authorization check runs first');
  allowed = false;
  go();
  assert.deepEqual(h.state.done, [false], 'a route change during the authorization wait cancels the opener');
  assert.equal(h.state.elements.length, 0);
}
console.log('ring popup: the shared opener revalidates route and visibility after every asynchronous wait');

// ── Other modules keep calling the opener with positional arguments ──────────────────────────────────────────────────
{
  const h = loadViaCard();
  h.positional('camera.mock_sub', ok => h.state.done.push(ok), tileCfg, true, true);
  await new Promise(resolve => setImmediate(resolve));
  h.state.timers.shift()();
  h.state.elements[0].listeners['hass-action']({ stopPropagation() {}, detail: { config: { tap_action: { casora_popup: { title: 'doorbell' } } } } });
  assert.deepEqual(h.state.done, [true], 'the positional form still opens through the tile config');
}
console.log('ring popup: the positional opener keeps working for other modules');

// ── The automatic popup closes itself two minutes after it opens ──────────────────────────────────────────────────
function fresh() {
  storage.clear();
  hass.states['binary_sensor.mock_press'].last_changed = new Date(now).toISOString();
  return load();
}
// The popup has no close of its own: Idle close closes it, like every other window.
screen = fresh();
const timers = screen.deadlines.size;
await screen.popup.refresh();
assert.equal(screen.opened.length, 1, 'the ring opens the popup');
assert.equal(screen.deadlines.size, timers, 'the popup leaves no timer of its own behind');
screen.advance(300000);
assert.notEqual(screen.window.casoraPopup.current, null, 'the popup stays open past two minutes');
assert.equal(screen.backCount(), 0, 'nothing closes the popup by itself');
console.log('ring popup: the popup has no close of its own');
screen = fresh();
screen.document.hidden = true;
await screen.popup.refresh();
now += 60000;
screen.document.hidden = false;
await screen.popup.refresh();
assert.equal(screen.opened.length, 1, 'the ring opens when the page becomes visible');
screen.advance(300000);
assert.notEqual(screen.window.casoraPopup.current, null, 'a late open stays open, too');
console.log('ring popup: a late visible open stays open');
screen = fresh();
const tapped = { title: 'Klingel', _entity: 'camera.mock_sub' };
screen.window.casoraPopup.open(tapped);
await screen.popup.refresh();
assert.equal(screen.opened.length, 1, 'a ring does not reopen the doorbell popup someone tapped open');
screen.advance(300000);
assert.equal(screen.window.casoraPopup.current, tapped, 'a tap-opened doorbell popup never closes by itself');
assert.equal(screen.backCount(), 0, 'no automatic close runs on a tapped popup');
console.log('ring popup: a tapped doorbell popup never closes by itself');
screen = fresh();
const before = { title: 'Licht' };
screen.window.casoraPopup.open(before);
await screen.popup.refresh();
assert.notEqual(screen.window.casoraPopup.current, before, 'a ring replaces the popup that was open');
screen.window._casoraRingPopup.back(screen.window.casoraPopup);
assert.equal(screen.window.casoraPopup.current, before, '‹ returns to the popup shown before');
console.log('ring popup: ‹ returns to the popup that was open');
screen = fresh();
const prior = { title: 'Licht' };
screen.window.casoraPopup.open(prior);
await screen.popup.refresh();
screen.advance(90000);
hass.states['binary_sensor.mock_press'].last_changed = new Date(now).toISOString();
await screen.popup.refresh();
screen.window._casoraRingPopup.back(screen.window.casoraPopup);
assert.equal(screen.window.casoraPopup.current, prior,
  'a second ring keeps the way back to the popup from before the first ring');
console.log('ring popup: a repeated ring keeps the original popup behind ‹');
screen = fresh();
await screen.popup.refresh();
screen.advance(30000);
screen.window.casoraPopup.close();
hass.states['binary_sensor.mock_press'].last_changed = new Date(now).toISOString();
await screen.popup.refresh();
assert.equal(screen.opened.length, 1, 'a new ring within the minute opens no second popup');
screen.advance(30000);
hass.states['binary_sensor.mock_press'].last_changed = new Date(now).toISOString();
await screen.popup.refresh();
assert.equal(screen.opened.length, 2, 'a new ring after the minute opens a fresh popup');
console.log('ring popup: a manual close and a new ring open again');
screen = fresh();
await screen.popup.refresh();
screen.advance(30000);
screen.element.isConnected = false;
screen.advance(300000);
hass.states['binary_sensor.mock_press'].last_changed = new Date(now).toISOString();
await screen.popup.refresh();
assert.equal(screen.opened.length, 2, 'a new ring opens after the old popup went away');
console.log('ring popup: a popup that went away leaves nothing behind');

// The consumer seam accepts either camera role, and the lifecycle owns no trigger discovery.
function occurrence(overrides = {}) {
  return { entity: 'binary_sensor.mock_press', at: now, id: new Date(now).toISOString(),
    role: 'doorbell', camera: 'camera.mock_sub', name: 'Mock press', ...overrides };
}
function offer(s, o = occurrence(), card = tile) { return s.window._casoraRingPopup.open(o, card); }
storage.clear(); screen = load(); screen.window.casoraPopup.enabled = false;
assert.equal(await screen.window._casoraRingPopup.open(occurrence(), tile), false, 'disabled popup reports suppression');
storage.clear(); screen = load();
assert.equal(await screen.window._casoraRingPopup.open(occurrence(), tile), true, 'successful popup reports opening');
for (const template of ['casora_reolink_doorbell', 'casora_camera']) {
  storage.clear(); screen = load();
  const manual = { template, _entity: 'camera.manual' };
  screen.window.casoraPopup.open(manual);
  offer(screen, occurrence({ role: 'detection' }));
  assert.equal(screen.window.casoraPopup.current, manual, 'detection does not displace a manually opened ' + template);
}
storage.clear(); screen = load(); offer(screen);
const automaticDoorbell = screen.window.casoraPopup.current;
offer(screen, occurrence({ entity: 'binary_sensor.mock_detection', role: 'detection', camera: 'camera.other' }));
assert.equal(screen.window.casoraPopup.current, automaticDoorbell, 'detection does not displace an automatic doorbell');
storage.clear(); screen = load(); offer(screen, occurrence({ role: 'detection' }));
const automaticDetection = screen.window.casoraPopup.current;
offer(screen, occurrence({ entity: 'binary_sensor.other_detection', role: 'detection', camera: 'camera.other' }), { ...tile, entity: 'camera.other' });
assert.notEqual(screen.window.casoraPopup.current, automaticDetection, 'another camera detection replaces an automatic detection');
assert.equal(screen.opened.length, 2, 'a second camera detection opens its popup');
for (const [age, expected] of [[119999, 1], [120000, 0], [-60000, 1], [-60001, 0]]) {
  storage.clear(); screen = load(); offer(screen, occurrence({ at: now - age }));
  assert.equal(screen.opened.length, expected, 'freshness boundary at age ' + age);
}
// One trigger opens the popup at most once per minute.
storage.clear(); screen = load();
offer(screen, occurrence());
await flush();
assert.equal(screen.opened.length, 1, 'the first occurrence opens the popup');
offer(screen, occurrence({ at: now + 30000, id: new Date(now + 30000).toISOString() }));
await flush();
assert.equal(screen.opened.length, 1, 'a second occurrence within the minute opens no second popup');
screen.window.casoraPopup.close();
offer(screen, occurrence({ at: now + 60000, id: new Date(now + 60000).toISOString() }));
await flush();
assert.equal(screen.opened.length, 2, 'an occurrence after the minute opens the popup again');
console.log('ring popup: one trigger opens the popup at most once per minute');
storage.clear(); screen = load(); offer(screen); screen.window.casoraPopup.close();
screen = load(); offer(screen);
assert.equal(screen.opened.length, 0, 'reload remembers the handled occurrence');
screen = load({ route: '/other-dashboard/0' }); offer(screen);
assert.equal(screen.opened.length, 1, 'a different dashboard has independent deduplication');
for (const route of ['/casora-studio/0', '/config', '/not-a-dashboard']) {
  storage.clear(); screen = load({ route }); offer(screen);
  assert.equal(screen.opened.length, 0, route + ' cannot open');
}
storage.clear(); screen = load(); screen.window.casoraPopup.enabled = false; offer(screen);
assert.equal(screen.opened.length, 0, 'all-popups-off blocks the occurrence');
storage.clear(); screen = load({ hidden: true }); offer(screen); now += 60000;
screen.document.hidden = false; screen.events.visibilitychange();
assert.equal(screen.opened.length, 1, 'visibility return opens a deferred fresh occurrence');
screen.advance(120000);
assert.notEqual(screen.window.casoraPopup.current, null, 'the late opening stays open');
storage.clear(); screen = load({ hidden: true }); offer(screen); now += 120000;
screen.document.hidden = false; screen.events.visibilitychange();
assert.equal(screen.opened.length, 0, 'visibility return drops expired occurrences');
for (const change of [s => { s.document.hidden = true; }, s => { s.window.location.pathname = '/config'; }, s => { s.window.casoraPopup.enabled = false; }, () => { now += 120000; }]) {
  storage.clear(); screen = load({ notify: () => {} }); offer(screen);
  change(screen);
  assert.equal(screen.notifyCalls[0].canOpen(), false, 'pending open revalidates its conditions');
  screen.notifyCalls[0].done(false);
}
storage.clear(); screen = load();
offer(screen, occurrence({ role: 'detection' }));
now += 1000;
offer(screen, occurrence({ entity: 'binary_sensor.mock_doorbell', role: 'doorbell', camera: 'camera.other' }));
assert.equal(screen.opened.length, 2, 'a doorbell replaces an open detection');
screen.advance(300000);
assert.notEqual(screen.window.casoraPopup.current, null, 'nothing closes the popup by itself');
assert.equal(screen.opened.length, 2, 'no second popup opens while the first one is open');
console.log('camera popup: occurrence seam, freshness, guards, reload, visibility and doorbell interruption');
storage.clear(); screen = load();
screen.window._casoraKlingel = { _want: 'listen' };
offer(screen);
assert.equal(screen.notifyCalls[0].noTile, true, 'automatic opening uses the existing popup opener');
assert.equal(screen.window._casoraKlingel._want, null, 'automatic opening clears the Listen shortcut');
storage.clear(); screen = load(); const loser = occurrence();
screen.window._casoraRingPopup.handled(loser); offer(screen, loser);
assert.equal(screen.opened.length, 0, 'arbitration losers can be marked handled');
storage.clear(); screen = load({ notify: () => {} }); offer(screen);
screen.document.hidden = true; screen.notifyCalls[0].done(false);
screen.document.hidden = false; screen.events.visibilitychange();
assert.equal(screen.notifyCalls.length, 2, 'a page hidden during the asynchronous open retries on return');

// ── The real route of a camera popup: the watcher, the bell row and ‹ end in the shared opener, not in a stub ─────────
// Only the browser is stubbed. 01-basis (the opener), 25, 26 and 45 run as they are; the popup stands for
// casoraPopup.open of casora-core.js, which keeps the entity that comes with the data (_entity) apart from its config.
function realRoute() {
  storage.clear();
  const timers = [], elements = [];
  const routeHass = { callWS() {}, panels: hass.panels, states: hass.states, entities: hass.entities };
  const element = new EventTarget();
  element.isConnected = true;
  element.hasAttribute = name => name === 'open' && popup.current !== null;
  const popup = {
    enabled: true, current: null, entity: null, element, surface: element,
    open(data) {
      const { _entity, ...config } = data;
      this.current = config;
      this.entity = _entity || null;
      element._backFn = window._casoraBackNext ? window._casoraBackNext.fn : null;
      window._casoraBackNext = null;
    },
    close() { this.current = null; this.entity = null; },
  };
  const stub = () => new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub(), apply: () => stub(), construct: () => stub() });
  const documentBase = {
    hidden: false,
    querySelector: q => q === 'home-assistant' ? { hass: routeHass } : null,
    addEventListener() {},
    createElement: () => {
      const el = { style: {}, parentNode: {}, listeners: {}, setConfig(c) { this.config = c; },
        addEventListener(type, fn) { this.listeners[type] = fn; }, removeEventListener() {}, remove() {}, _handleAction() {} };
      elements.push(el);
      return el;
    },
    body: { appendChild() {} },
    documentElement: {},
  };
  const document = new Proxy(documentBase, { get: (t, k) => k in t ? t[k] : stub() });
  const kept = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
  const window = { document, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    location: { pathname: '/mock-dashboard/0' }, localStorage: kept, sessionStorage: kept,
    casoraIsWallTablet: () => true, _casoraCfgOnce: async () => ({ views: [] }), casoraPopup: popup,
    CASORA_SETTINGS: { camera_popup: { open_by_itself: true }, cameras: [
      { entity_id: 'camera.mock_sub', doorbell_triggers: ['binary_sensor.mock_press'] },
      { entity_id: 'camera.mock_ring', doorbell_triggers: ['event.mock_ring'] },
    ] } };
  const context = vm.createContext({ window, document, location: window.location, console, JSON, Object, Array, String, Number,
    Date: Clock, Math, Promise, Map, Set, RegExp, Error, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    Event: class {}, CustomEvent: class {}, HTMLElement: class {}, customElements: { get: () => null, whenDefined: () => new Promise(() => {}) },
    getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: () => 0,
    MutationObserver: class { observe() {} disconnect() {} }, ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
    IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} }, navigator: { userAgent: 'node', language: 'de' },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {} });
  vm.runInContext(triggerIdsSource, context);
  for (const name of ['01-basis.js', '25-camera-popup.js', '26-camera-triggers.js', '45-ring-popup.js']) vm.runInContext(fs.readFileSync(new URL(name, root), 'utf8'), context);
  timers.length = 0;
  const doorbell = (camera, entity) => ({ entity, at: now, id: new Date(now).toISOString(), role: 'doorbell', camera, name: 'Mock press' });
  // The opener's tap timer runs, then the tile hands over its popup config, as a real tap does.
  const tap = async title => {
    await flush();
    timers.shift()();
    elements.at(-1).listeners['hass-action']({ stopPropagation() {}, detail: { config: { tap_action: { casora_popup: { title } } } } });
  };
  // Start one step with no timer of an earlier step left behind.
  const step = fn => { timers.length = 0; return fn(); };
  return { popup, window, timers, tap, doorbell,
    watch: occurrences => step(() => window._casoraCameraTriggers.dispatch(routeHass, occurrences)) };
}
{
  // A window opened by the watcher carries its camera.
  const route = realRoute();
  const opening = route.watch([route.doorbell('camera.mock_sub', 'binary_sensor.mock_press')]);
  await route.tap('Klingel');
  assert.equal(await opening, true, 'the watcher opens the popup');
  assert.equal(route.popup.entity, 'camera.mock_sub', 'a window opened by the watcher carries its camera');
  // A window opened from the bell row carries its camera, so the same camera replaces nothing.
  const bell = realRoute();
  bell.window.casoraCameraPopup.open('camera.mock_sub', () => {});
  await bell.tap('Klingel');
  assert.equal(bell.popup.entity, 'camera.mock_sub', 'a window opened from the bell row carries its camera');
  bell.watch([bell.doorbell('camera.mock_sub', 'binary_sensor.mock_press')]);
  await flush();
  assert.equal(bell.timers.length, 0, 'a ring of the camera already shown starts no new popup');
  // ‹ after a ring from another camera brings back the camera window it replaced.
  const back = realRoute();
  const first = back.watch([back.doorbell('camera.mock_sub', 'binary_sensor.mock_press')]);
  await back.tap('Klingel A');
  await first;
  const second = back.watch([back.doorbell('camera.mock_ring', 'event.mock_ring')]);
  await back.tap('Klingel B');
  await second;
  assert.equal(back.popup.entity, 'camera.mock_ring', 'the ring from the other camera replaces the window');
  back.window._casoraRingPopup.back(back.popup);
  assert.equal(back.popup.entity, 'camera.mock_sub', '‹ brings back the camera window it replaced, with its camera');
}
console.log('ring popup: every camera window carries its camera on the watcher, bell row and ‹ routes');

// ── #394: a ring from another camera replaces a Modal; a detection replaces neither a Modal nor a Ring popup ─────────
{
  storage.clear(); const modal = load();
  const light = { title: 'Licht', _entity: 'light.mock' };
  modal.window.casoraPopup.open(light);
  offer(modal, occurrence({ camera: 'camera.mock_sub' }));
  assert.equal(modal.opened.length, 2, 'a ring from another camera opens its popup over a Modal (the first push is the Modal)');
  assert.notEqual(modal.window.casoraPopup.current, light, 'the ring replaces the Modal');
  modal.window._casoraRingPopup.back(modal.window.casoraPopup);
  assert.equal(modal.window.casoraPopup.current.title, 'Licht', '‹ brings the Modal back');
  assert.equal(modal.window.casoraPopup.entity, 'light.mock', '‹ brings the Modal back with its entity');
}
{
  storage.clear(); const modal = load();
  const light = { title: 'Licht', _entity: 'light.mock' };
  modal.window.casoraPopup.open(light);
  offer(modal, occurrence({ role: 'detection', entity: 'binary_sensor.mock_motion', camera: 'camera.other' }));
  assert.equal(modal.opened.length, 1, 'a detection from another camera opens nothing over a Modal (the first push is the Modal)');
  assert.equal(modal.window.casoraPopup.current, light, 'the Modal stays');
}
{
  storage.clear(); const ring = load();
  offer(ring);
  const doorbell = ring.window.casoraPopup.current;
  offer(ring, occurrence({ role: 'detection', entity: 'binary_sensor.mock_motion', camera: 'camera.other' }));
  assert.equal(ring.opened.length, 1, 'a detection from another camera opens nothing over a Ring popup');
  assert.equal(ring.window.casoraPopup.current, doorbell, 'the Ring popup stays');
}
console.log('ring popup: a ring from another camera replaces a Modal, a detection replaces neither a Modal nor a Ring popup');

// ── The limits live in one place: the watcher reads freshness from the lifecycle, not from its own copy ───────────────
{
  storage.clear(); const h = load();
  h.window.CASORA_SETTINGS = { camera_popup: { open_by_itself: true }, cameras: [
    { entity_id: 'camera.mock_sub', doorbell_triggers: ['binary_sensor.mock_press'] }] };
  const lifecycle = h.window._casoraRingPopup;
  assert.equal(typeof lifecycle.fresh, 'function', 'the lifecycle owns the freshness limit');
  assert.equal(lifecycle.fresh(now), true, 'a ring now is fresh');
  assert.equal(lifecycle.fresh(now - 120000), false, 'two minutes old is not fresh');
  // Replace the lifecycle's limit: the watcher must follow it, so it opens nothing.
  lifecycle.fresh = () => false;
  await h.window._casoraCameraTriggers.dispatch(hass, [occurrence()]);
  assert.equal(h.notifyCalls.length, 0, 'the watcher reads freshness from the lifecycle');
  assert.equal(h.opened.length, 0, 'and opens nothing when the lifecycle says it is not fresh');
}
console.log('ring popup: the watcher reads the freshness limit from the lifecycle');

// ── The Wall tablet check is the only screen gate: a tablet with the phone background still opens ─────────────────────
{
  storage.clear();
  const layout = cfg.views;
  cfg.views = [{ path: 'home', cards: [{ template: 'casora_mobile_bg' }] }];
  const tablet = load();
  tablet.window.CASORA_SETTINGS = { camera_popup: { open_by_itself: true }, cameras: [
    { entity_id: 'camera.mock_sub', doorbell_triggers: ['binary_sensor.mock_press'] }] };
  vm.runInContext(fs.readFileSync(new URL('25-camera-popup.js', root), 'utf8'), tablet.context);
  await tablet.window._casoraCameraTriggers.dispatch(hass, [occurrence()]);
  assert.equal(tablet.opened.length, 1, 'a Wall tablet opens a ring, whatever the dashboard layout');
  cfg.views = layout;
}
console.log('ring popup: the Wall tablet check is the only screen gate');
