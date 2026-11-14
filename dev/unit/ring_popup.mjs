// Ring popup lifecycle at the public browser boundary, with fake time and storage.
// @deckt: custom_components/casora/scripts/local/45-ring-popup.js custom_components/casora/scripts/local/26-camera-triggers.js custom_components/casora/scripts/local/01-basis.js#openViaCard
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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
      open_on_detection: true, detection_triggers: ['event.mock_detection'] }] };
    vm.runInContext(fs.readFileSync(new URL('25-camera-popup.js', root), 'utf8'), h.context);
    vm.runInContext(fs.readFileSync(new URL('26-camera-triggers.js', root), 'utf8'), h.context);
  };
  const hidden = load({ hidden: true });
  install(hidden);
  await flush();
  assert.equal(hidden.opened.length, 0, 'hidden detection waits for visibility');
  hidden.document.hidden = false;
  hidden.events.visibilitychange();
  await flush();
  assert.equal(hidden.notifyCalls.length, 1, 'the real watcher opens a detection on visibility return');
  assert.equal(hidden.notifyCalls[0].noTile, true);
  assert.equal(hidden.notifyCalls[0].card.template, 'casora_camera');
  const reload = load();
  install(reload);
  await flush();
  assert.equal(reload.opened.length, 0, 'the real watcher respects reload deduplication');
  storage.clear();
  cfg.views[0].cards = [{ template: 'casora_mobile_bg' }];
  const phone = load();
  install(phone);
  await flush();
  assert.equal(phone.opened.length, 0, 'the real watcher excludes the phone layout');
  cfg.views[0].cards = [];
  const studio = load({ route: '/casora-studio/empty' });
  install(studio);
  await flush();
  assert.equal(studio.opened.length, 0, 'the real watcher excludes Studio');
  const disabled = load();
  disabled.window.casoraPopup.enabled = false;
  install(disabled);
  await flush();
  assert.equal(disabled.opened.length, 0, 'the real watcher respects all-popups-off');
  cfg.views = originalViews;
  delete hass.states['event.mock_detection'];
}

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
    h.window.CASORA_SETTINGS = { cameras: [{ entity_id: 'camera.mock_sub', open_on_ring: true, doorbell_triggers: ['event.listed'] }] };
    vm.runInContext(fs.readFileSync(new URL('25-camera-popup.js', root), 'utf8'), h.context);
    vm.runInContext(fs.readFileSync(new URL('26-camera-triggers.js', root), 'utf8'), h.context);
    return h;
  };
  hass.states['event.listed'] = { state: new Date(now).toISOString() };
  const h = setup(true);
  await flush();
  assert.equal(h.opened.length, 0, 'the watcher defers a hidden occurrence');
  h.document.hidden = false;
  h.events.visibilitychange();
  await flush();
  assert.equal(h.opened.length, 1, 'visibility return opens through the actual lifecycle');
  h.window.casoraPopup.close();
  const reloaded = setup(false);
  await flush();
  assert.equal(reloaded.opened.length, 0, 'the actual watcher respects lifecycle reload deduplication');
  delete hass.states['event.listed'];
}
{
  storage.clear();
  const h = load();
  h.window.CASORA_SETTINGS = { cameras: [{
    entity_id: 'camera.mock_sub', open_on_ring: true, doorbell_triggers: ['event.mock_listed'],
  }] };
  vm.runInContext(fs.readFileSync(new URL('25-camera-popup.js', root), 'utf8'), h.context);
  // Avoid starting the interval in this seam test; drive the actual consumer explicitly.
  const interval = h.window.setInterval;
  h.window.setInterval = null;
  vm.runInContext(fs.readFileSync(new URL('26-camera-triggers.js', root), 'utf8'), h.context);
  h.window.setInterval = interval;
  const id = new Date(now).toISOString();
  const occurrence = h.window._casoraCameraTriggers.scan({ states: {
    'event.mock_listed': { state: id, attributes: { friendly_name: 'Mock bell' } },
  } });
  await h.window._casoraCameraTriggers.dispatch(hass, occurrence);
  assert.equal(h.notifyCalls.length, 1, 'listed trigger reaches the real automatic popup lifecycle');
  assert.equal(h.notifyCalls[0].card.template, 'casora_camera', 'automatic opening uses the canonical camera card');
  assert.equal(h.notifyCalls[0].noTile, true);
  h.advance(120000);
  assert.equal(h.window.casoraPopup.current, null, 'the real lifecycle closes the untouched automatic popup');
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
screen = fresh();
await screen.popup.refresh();
screen.advance(119999);
assert.notEqual(screen.window.casoraPopup.current, null, 'untouched popup stays open until two minutes');
screen.advance(1);
assert.equal(screen.window.casoraPopup.current, null, 'untouched popup closes at exactly two minutes');
console.log('ring popup: untouched closes exactly 120 seconds after opening');
screen = fresh();
screen.document.hidden = true;
await screen.popup.refresh();
now += 60000;
screen.document.hidden = false;
await screen.popup.refresh();
assert.equal(screen.opened.length, 1, 'the ring opens when the page becomes visible');
screen.advance(119999);
assert.notEqual(screen.window.casoraPopup.current, null, 'a late open gets its own two minutes');
screen.advance(1);
assert.equal(screen.window.casoraPopup.current, null, 'a late open closes two minutes after it opened');
console.log('ring popup: a late visible open counts from the moment it opened');
screen = fresh();
await screen.popup.refresh();
screen.advance(60000);
screen.element.dispatchEvent(new Event('pointerdown'));
screen.advance(240000);
assert.notEqual(screen.window.casoraPopup.current, null, 'a touch inside the popup keeps it open past its deadline');
assert.equal(screen.backCount(), 0, 'the timer never closes a popup someone touched');
console.log('ring popup: touching the popup ends the automatic close');
screen = fresh();
await screen.popup.refresh();
screen.advance(60000);
screen.element.dispatchEvent(new Event('pointerdown'));
screen.advance(30000);
hass.states['binary_sensor.mock_press'].last_changed = new Date(now).toISOString();
await screen.popup.refresh();
assert.equal(screen.opened.length, 1, 'a later ring leaves a touched popup in place');
screen.advance(240000);
assert.notEqual(screen.window.casoraPopup.current, null, 'a later ring does not restart the clock after a touch');
assert.equal(screen.backCount(), 0, 'the touched popup stays until someone closes it');
console.log('ring popup: a new ring keeps a touched popup open');
screen = fresh();
await screen.popup.refresh();
screen.advance(90000);
hass.states['binary_sensor.mock_press'].last_changed = new Date(now).toISOString();
await screen.popup.refresh();
screen.advance(119999);
assert.notEqual(screen.window.casoraPopup.current, null, 'the second ring restarts the two minutes');
screen.advance(1);
assert.equal(screen.window.casoraPopup.current, null, 'an untouched popup closes two minutes after the latest ring');
console.log('ring popup: a new ring restarts the timer');
screen = fresh();
const tapped = { title: 'Klingel', _entity: 'camera.mock_sub' };
screen.window.casoraPopup.open(tapped);
await screen.popup.refresh();
assert.equal(screen.opened.length, 1, 'a ring does not reopen the doorbell popup someone tapped open');
screen.advance(300000);
assert.equal(screen.window.casoraPopup.current, tapped, 'a tap-opened doorbell popup never closes by itself');
assert.equal(screen.backCount(), 0, 'no automatic close runs on a tapped popup');
console.log('ring popup: a tapped doorbell popup never auto-closes');
screen = fresh();
const before = { title: 'Licht' };
screen.window.casoraPopup.open(before);
await screen.popup.refresh();
assert.notEqual(screen.window.casoraPopup.current, before, 'a ring replaces the popup that was open');
screen.advance(120000);
assert.equal(screen.window.casoraPopup.current, before, 'auto-close returns to the popup shown before, as with ‹');
console.log('ring popup: auto-close restores the popup that was open');
screen = fresh();
const prior = { title: 'Licht' };
screen.window.casoraPopup.open(prior);
await screen.popup.refresh();
screen.advance(90000);
hass.states['binary_sensor.mock_press'].last_changed = new Date(now).toISOString();
await screen.popup.refresh();
screen.advance(120000);
assert.equal(screen.window.casoraPopup.current, prior,
  'a second ring keeps the way back to the popup from before the first ring');
console.log('ring popup: a repeated ring keeps the original popup behind ‹');
screen = fresh();
await screen.popup.refresh();
screen.advance(30000);
screen.window.casoraPopup.close();
assert.equal(screen.deadlines.size, 0, 'closing the popup clears the automatic close');
hass.states['binary_sensor.mock_press'].last_changed = new Date(now).toISOString();
await screen.popup.refresh();
assert.equal(screen.opened.length, 2, 'a new ring after a manual close opens a fresh popup');
console.log('ring popup: a manual close cleans up and a new ring opens again');
screen = fresh();
await screen.popup.refresh();
screen.advance(30000);
const page = { title: 'Verlauf' };
screen.window.casoraPopup.open(page);
screen.advance(300000);
assert.equal(screen.window.casoraPopup.current, page, 'the old timer never closes a page someone opened inside the popup');
assert.equal(screen.backCount(), 0, 'no back runs after the popup left its ring page');
console.log('ring popup: navigating inside the popup cancels the old close');
screen = fresh();
await screen.popup.refresh();
screen.advance(30000);
screen.element.isConnected = false;
screen.advance(300000);
assert.equal(screen.backCount(), 0, 'a detached popup is not closed by a stale timer');
hass.states['binary_sensor.mock_press'].last_changed = new Date(now).toISOString();
await screen.popup.refresh();
assert.equal(screen.opened.length, 2, 'a new ring opens after the old popup went away');
console.log('ring popup: an unmounted popup leaves no timer behind');
for (const type of ['keydown', 'focusin', 'wheel']) {
  screen = fresh();
  await screen.popup.refresh();
  screen.advance(60000);
  screen.element.dispatchEvent(new Event(type));
  screen.advance(240000);
  assert.notEqual(screen.window.casoraPopup.current, null, type + ' inside the popup keeps it open past its deadline');
  assert.equal(screen.backCount(), 0, type + ' ends the automatic close like a touch');
}
screen = fresh();
await screen.popup.refresh();
screen.element.dispatchEvent(new Event('pointermove'));
screen.advance(120000);
assert.equal(screen.window.casoraPopup.current, null, 'a mere pointer move does not count as touching');
console.log('ring popup: key press, focus and wheel end the automatic close');

// The consumer seam accepts either camera role, and the lifecycle owns no trigger discovery.
function occurrence(overrides = {}) {
  return { entity: 'binary_sensor.mock_press', at: now, id: new Date(now).toISOString(),
    role: 'doorbell', camera: 'camera.mock_sub', name: 'Mock press', ...overrides };
}
function offer(s, o = occurrence()) { s.window._casoraRingPopup.open(o, tile); }
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
offer(screen, occurrence({ entity: 'binary_sensor.other_detection', role: 'detection', camera: 'camera.other' }));
assert.equal(screen.window.casoraPopup.current, automaticDetection, 'detection does not displace an automatic detection');
assert.equal(screen.opened.length, 1, 'a second detection does not reopen the popup');
for (const [age, expected] of [[119999, 1], [120000, 0], [-60000, 1], [-60001, 0]]) {
  storage.clear(); screen = load(); offer(screen, occurrence({ at: now - age }));
  assert.equal(screen.opened.length, expected, 'freshness boundary at age ' + age);
}
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
assert.equal(screen.window.casoraPopup.current, null, 'late opening gets a full timer');
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
const detection = screen.window.casoraPopup.current;
screen.element.dispatchEvent(new Event('focusin'));
now += 1000;
offer(screen, occurrence({ entity: 'binary_sensor.mock_doorbell', role: 'doorbell' }));
assert.equal(screen.opened.length, 2, 'doorbell interrupts an interacted detection');
screen.advance(120000);
assert.equal(screen.window.casoraPopup.current, detection, 'auto-close returns to detection');
screen.advance(240000);
assert.equal(screen.window.casoraPopup.current, detection, 'returned detection has no old timer');
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
