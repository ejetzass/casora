// Listed camera triggers, tested without Home Assistant.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let now = Date.parse('2026-11-13T12:00:00Z');
class Clock extends Date { static now() { return now; } }
const PANELS = { 'mock-dashboard': { component_name: 'lovelace' }, 'other-dashboard': { component_name: 'lovelace' }, config: { component_name: 'config' }, 'casora-studio': { component_name: 'casora-studio' } };
let route = 'mock-dashboard';
const loc = r => ({ get pathname() { return '/' + r(); } });
const window = { location: loc(() => route), CASORA_SETTINGS: { cameras: [
  { entity_id: 'camera.mock', open_on_ring: true, doorbell_triggers: ['binary_sensor.mock', 'event.mock'] },
] } };
const source = fs.readFileSync(new URL('../../custom_components/casora/scripts/local/26-camera-triggers.js', import.meta.url), 'utf8');
vm.runInNewContext(source, { window, Date: Clock, Number, Object, Array, JSON });
const h = { panels: PANELS, states: {
  'binary_sensor.mock': { state: 'on', last_changed: new Date(now).toISOString(), attributes: { friendly_name: 'Mock bell' } },
  'event.mock': { state: 'unknown' },
} };
const scan = () => Array.from(window._casoraCameraTriggers.scan(h));
window._casoraCfgOnce = async () => ({ views: [] });
window.casoraCameraPopup = { resolve: () => ({ open: {} }), config: id => ({ entity: id }) };
window._casoraRingPopup = { open() { return true; }, handled() {} };
assert.equal(scan().length, 0, 'initial on does not prove a press');
h.states['binary_sensor.mock'].state = 'off';
assert.equal(scan().length, 0);
h.states['binary_sensor.mock'].state = 'on';
const shortPress = scan();
assert.equal(shortPress.length, 1, 'short observed press fires');
await window._casoraCameraTriggers.dispatch(h, shortPress);
assert.equal(scan().length, 0, 'sustained on does not repeat');
now += 30000;
h.states['binary_sensor.mock'].state = 'off'; scan();
h.states['binary_sensor.mock'].state = 'on';
h.states['binary_sensor.mock'].last_changed = new Date(now).toISOString();
assert.equal(scan().length, 0, 'cooldown suppresses a second press');
now += 30000;
h.states['binary_sensor.mock'].state = 'off'; scan();
h.states['binary_sensor.mock'].state = 'on';
h.states['binary_sensor.mock'].last_changed = new Date(now).toISOString();
assert.equal(scan().length, 1, 'one minute after the accepted press fires');
h.states['event.mock'].state = new Date(now).toISOString();
assert.equal(scan().length, 1, 'a fresh first event timestamp fires');
assert.equal(scan().length, 0, 'unchanged event does not repeat');
console.log('camera_triggers: transitions and cooldown');

const calls = [];
const cfg = { views: [{ path: 'home', cards: [] }] };
window._casoraRing = { route: () => 'mock-dashboard', dashboard: async () => ({ url: 'mock-dashboard' }) };
window._casoraCfgOnce = async () => cfg;
window.casoraCameraPopup = {
  resolve: () => ({ open: {} }),
  config: id => ({ entity: id }),
};
window._casoraRingPopup = { open: (o, c) => { calls.push(['open', o.camera, c.entity]); return true; },
  handled: o => calls.push(['handled', o.camera]) };
window.CASORA_SETTINGS.cameras = [
  { entity_id: 'camera.first', open_on_ring: true },
  { entity_id: 'camera.second', open_on_ring: true },
];
const occurrences = [
  { entity: 'event.first', at: now, id: 'first', role: 'doorbell', camera: 'camera.first' },
  { entity: 'event.second', at: now, id: 'second', role: 'doorbell', camera: 'camera.second' },
];
await window._casoraCameraTriggers.dispatch(h, occurrences);
assert.deepEqual(calls, [['open', 'camera.first', 'camera.first'], ['handled', 'camera.second']],
  'the first configured camera wins and the loser is handled');
calls.length = 0;
window.casoraCameraPopup.resolve = id => ({ open: { ring: id === 'camera.first' ? 'never' : 'always' } });
const policyOccurrences = occurrences.map((o, i) => ({ ...o, entity: 'event.policy' + i }));
await window._casoraCameraTriggers.dispatch(h, policyOccurrences);
assert.deepEqual(calls, [['open', 'camera.second', 'camera.second']], 'Never blocks only its automatic opening');
calls.length = 0;
cfg.views[0].cards.push({ template: 'casora_mobile_bg' });
await window._casoraCameraTriggers.dispatch(h, occurrences);
assert.deepEqual(calls, [], 'phone layout never opens automatically');
console.log('camera_triggers: policy, ordering and phone exclusion');

cfg.views[0].cards = [];
window.CASORA_SETTINGS.cameras = [{ entity_id: 'camera.retry', open_on_ring: true }];
window.casoraCameraPopup.resolve = () => ({ open: {} });
const retry = { entity: 'event.retry', at: now, id: 'retry', role: 'doorbell', camera: 'camera.retry' };
let attempts = 0;
window._casoraRingPopup.open = () => { attempts++; return attempts > 1; };
assert.equal(await window._casoraCameraTriggers.dispatch(h, [retry]), false, 'suppressed opening keeps the occurrence retryable');
assert.equal(await window._casoraCameraTriggers.dispatch(h, [retry]), true, 'fresh retry opens');
await window._casoraCameraTriggers.dispatch(h, [retry]);
assert.equal(attempts, 2, 'a real opening spends the cooldown');
window._casoraRingPopup.open = (o, c) => { calls.push(['open', o.camera, c.entity]); return true; };

window.CASORA_SETTINGS.cameras = [{ entity_id: 'camera.mock', doorbell_triggers: ['binary_sensor.recovered'] }];
const recoveredAt = now - 10000;
const historyHass = { states: { 'binary_sensor.recovered': { state: 'on', attributes: { friendly_name: 'Mock' } } },
  callWS: async () => ({ 'binary_sensor.recovered': [
    { state: 'off', last_changed: new Date(now - 20000).toISOString() },
    { state: 'on', last_changed: new Date(recoveredAt).toISOString() },
  ] }) };
const recovered = await window._casoraCameraTriggers.recover(historyHass);
assert.equal(recovered.length, 1, 'Recorder verifies off-to-on');
assert.equal(recovered[0].at, recoveredAt);
assert.equal(recovered[0].id, new Date(recoveredAt).toISOString(), 'recovered identity matches live timestamps');
window.CASORA_SETTINGS.cameras[0].doorbell_triggers = ['binary_sensor.excluded'];
historyHass.states['binary_sensor.excluded'] = { state: 'on' };
historyHass.callWS = async () => ({});
assert.equal((await window._casoraCameraTriggers.recover(historyHass)).length, 0, 'excluded history fails closed');
console.log('camera_triggers: verified Recorder recovery');

// Same physical press assigned to two cameras must not mark the winner handled
// before a hidden-page lifecycle has had a chance to open it.
calls.length = 0;
cfg.views[0].cards = [];
window.casoraCameraPopup.resolve = () => ({ open: { ring: 'always' } });
window.CASORA_SETTINGS.cameras = [
  { entity_id: 'camera.first' }, { entity_id: 'camera.second' },
];
await window._casoraCameraTriggers.dispatch(h, [
  { entity: 'event.shared', at: now, id: 'shared', role: 'doorbell', camera: 'camera.first' },
  { entity: 'event.shared', at: now, id: 'shared', role: 'doorbell', camera: 'camera.second' },
]);
assert.deepEqual(calls, [['open', 'camera.first', 'camera.first']], 'one identity is not handled ahead of its deferred winner');

calls.length = 0;
let release;
route = 'mock-dashboard';
window._casoraCfgOnce = () => new Promise(resolve => { release = resolve; });
const pending = window._casoraCameraTriggers.dispatch(h, occurrences);
await new Promise(resolve => setImmediate(resolve));
route = 'other-dashboard';
release(cfg);
await pending;
assert.deepEqual(calls, [], 'a route change while loading does not open an old dashboard occurrence');
console.log('camera_triggers: shared identity and asynchronous route guard');

function freshWatcher() {
  const w = { location: loc(() => route), CASORA_SETTINGS: { cameras: [{ entity_id: 'camera.mock', doorbell_triggers: ['event.fresh'] }] } };
  vm.runInNewContext(source, { window: w, Date: Clock, Number, Object, Array, JSON });
  return w._casoraCameraTriggers;
}
for (const [age, expected] of [[119999, 1], [120000, 0], [120001, 0], [-60000, 1], [-60001, 0]]) {
  const entity = { state: new Date(now - age).toISOString() };
  const watcher = freshWatcher();
  assert.equal(watcher.scan({ states: { 'event.fresh': entity } }).length, expected, `freshness at age ${age}`);
}
const initial = freshWatcher();
window.CASORA_SETTINGS.cameras = [{ entity_id: 'camera.mock', doorbell_triggers: ['binary_sensor.restart'] }];
const restartHass = { states: { 'binary_sensor.restart': { state: 'on', last_changed: new Date(now).toISOString() } },
  callWS: async () => ({ 'binary_sensor.restart': [{ s: 'on', lc: now / 1000 }] }) };
assert.equal(window._casoraCameraTriggers.scan(restartHass).length, 0, 'a fresh restart-created on timestamp is not an observed transition');
assert.equal((await window._casoraCameraTriggers.recover(restartHass)).length, 0, 'an initial on history row is not a transition');
assert.equal(initial.scan({ states: {} }).length, 0);
console.log('camera_triggers: freshness boundaries and restart-like samples');

{
  let intervals = 0, requests = 0, stopped = 0;
  route = 'mock-dashboard';
  const listeners = {};
  const hass = { panels: PANELS, states: {}, callWS: async () => { requests++; return {}; } };
  const w = {
    CASORA_SETTINGS: { cameras: [{ entity_id: 'camera.mock' }] },
    document: { querySelector: () => ({ hass }), addEventListener() {} },
    addEventListener: (name, fn) => { listeners[name] = fn; }, setInterval: () => { intervals++; return 1; }, clearInterval: () => { stopped++; },
    location: loc(() => route), _casoraCfgOnce: async () => ({ views: [] }),
  };
  vm.runInNewContext(source, { window: w, Date: Clock, Number, Object, Array, JSON });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(intervals, 0, 'no interval without listed triggers');
  assert.equal(requests, 0, 'no history without listed triggers');
  w.CASORA_SETTINGS.cameras[0].doorbell_triggers = ['event.mock'];
  await listeners['casora-settings-changed']();
  assert.equal(intervals, 1, 'a listed trigger starts prompt one-second watching');
  route = 'casora-studio';
  await listeners['location-changed']();
  assert.equal(stopped, 1, 'leaving the dashboard stops the watcher');
  route = 'config';
  await listeners['location-changed']();
  assert.equal(intervals, 1, 'non-dashboard routes do not start watching');
}

// Exercise the actual scheduled watcher: a slower Recorder answer must participate
// in the same arbitration as a fresh event.
{
  const calls = [], listeners = {};
  let releaseHistory, tick;
  const hass = { panels: PANELS, states: {
    'binary_sensor.first': { state: 'on', last_changed: new Date(now).toISOString() },
    'event.second': { state: new Date(now).toISOString() },
  }, callWS: () => new Promise(resolve => { releaseHistory = resolve; }) };
  const w = {
    CASORA_SETTINGS: { cameras: [
      { entity_id: 'camera.first', open_on_ring: true, doorbell_triggers: ['binary_sensor.first'] },
      { entity_id: 'camera.second', open_on_ring: true, doorbell_triggers: ['event.second'] },
    ] },
    document: { querySelector: () => ({ hass }), addEventListener: (k, f) => { listeners[k] = f; } },
    addEventListener() {}, setInterval: fn => { tick = fn; },
    location: loc(() => 'mock-dashboard'),
    _casoraCfgOnce: async () => ({ views: [] }),
    casoraCameraPopup: { resolve: () => ({ open: {} }), config: id => ({ entity: id }) },
    _casoraRingPopup: { open: o => calls.push(['open', o.camera]), handled: o => calls.push(['handled', o.camera]) },
  };
  vm.runInNewContext(source, { window: w, Date: Clock, Number, Object, Array, JSON });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [], 'wait for same-tick recovery before arbitration');
  releaseHistory({ 'binary_sensor.first': [
    { s: 'off', lc: (now - 20000) / 1000 }, { s: 'on', lc: (now - 10000) / 1000 },
  ] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['open', 'camera.first'], ['handled', 'camera.second']],
    'recovered first camera beats simultaneous live second camera');
  tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2, 'the losing occurrence is not queued for a later popup');
}

{
  const calls = [];
  let tick, requests = 0;
  const at = now - 3000;
  const hass = { panels: PANELS, states: { 'binary_sensor.lag': { state: 'off', last_changed: new Date(now).toISOString() } },
    callWS: async () => ++requests === 1 ? {} : { 'binary_sensor.lag': [
      { s: 'off', lc: (at - 1000) / 1000 }, { s: 'on', lc: at / 1000 },
    ] } };
  const w = {
    CASORA_SETTINGS: { cameras: [{ entity_id: 'camera.lag', open_on_ring: true, doorbell_triggers: ['binary_sensor.lag'] }] },
    document: { querySelector: () => ({ hass }), addEventListener() {} },
    addEventListener() {}, setInterval: fn => { tick = fn; },
    location: loc(() => 'mock-dashboard'),
    _casoraCfgOnce: async () => ({ views: [] }),
    casoraCameraPopup: { resolve: () => ({ open: {} }), config: id => ({ entity: id }) },
    _casoraRingPopup: { open: o => calls.push(o.camera), handled() {} },
  };
  vm.runInNewContext(source, { window: w, Date: Clock, Number, Object, Array, JSON });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  now += 7000;
  tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 2, 'Recorder lag gets a bounded retry');
  assert.deepEqual(calls, ['camera.lag'], 'verified later history opens the popup');
}

{
  const calls = [], listeners = {};
  let tick;
  route = 'casora-studio';
  const hass = { panels: PANELS, states: { 'event.pending': { state: new Date(now).toISOString() } } };
  const w = {
    CASORA_SETTINGS: { cameras: [{ entity_id: 'camera.pending', open_on_ring: true, doorbell_triggers: ['event.pending'] }] },
    document: { querySelector: () => ({ hass }), addEventListener() {} },
    addEventListener: (name, fn) => { listeners[name] = fn; }, setInterval: fn => { tick = fn; },
    location: loc(() => route),
    _casoraCfgOnce: async () => ({ views: [] }),
    casoraCameraPopup: { resolve: () => ({ open: {} }), config: id => ({ entity: id }) },
    _casoraRingPopup: { open: o => calls.push(o.id), handled() {} },
  };
  vm.runInNewContext(source, { window: w, Date: Clock, Number, Object, Array, JSON });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [], 'Studio does not open');
  route = 'mock-dashboard';
  listeners['location-changed']();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1, 'the pending occurrence opens on an eligible dashboard');
  now += 30000;
  hass.states['event.pending'].state = new Date(now).toISOString();
  tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1, 'a distinct occurrence inside the cooldown is suppressed');
}
{
  const w = { CASORA_SETTINGS: { cameras: [
    { entity_id: 'camera.one', detection_triggers: ['binary_sensor.detect', 'event.detect'] },
  ] } };
  vm.runInNewContext(source, { window: w, Date: Clock, Number, Object, Array, JSON });
  const states = {
    'binary_sensor.detect': { state: 'off', attributes: { friendly_name: 'Naam-Detection' } },
    'event.detect': { state: 'unknown' },
  };
  assert.equal(w._casoraCameraTriggers.scan({ states }).length, 0);
  states['binary_sensor.detect'].state = 'on';
  states['binary_sensor.detect'].last_changed = new Date(now).toISOString();
  let result = w._casoraCameraTriggers.scan({ states });
  assert.equal(result.length, 1, 'listed detection binary transition fires');
  assert.equal(result[0].role, 'detection');
  states['event.detect'].state = new Date(now).toISOString();
  result = w._casoraCameraTriggers.scan({ states });
  assert.equal(result.length, 1, 'listed detection event fires');
  assert.equal(result[0].role, 'detection');
}

{
  calls.length = 0;
  route = 'mock-dashboard';
  window._casoraCfgOnce = async () => cfg;
  window.CASORA_SETTINGS.cameras = [
    { entity_id: 'camera.first', open_on_detection: true },
    { entity_id: 'camera.second', open_on_ring: true, open_on_detection: true },
  ];
  window.casoraCameraPopup.resolve = () => ({ open: {} });
  const detect = { entity: 'event.detect', at: now, id: 'detect', role: 'detection', camera: 'camera.first' };
  const ring = { entity: 'event.ring', at: now, id: 'ring', role: 'doorbell', camera: 'camera.second' };
  await window._casoraCameraTriggers.dispatch(h, [detect, ring]);
  assert.deepEqual(calls, [['open', 'camera.second', 'camera.second'], ['handled', 'camera.first']],
    'ring wins over an earlier configured detection');
  calls.length = 0;
  window.casoraCameraPopup.resolve = () => ({ open: { detection: 'never' } });
  await window._casoraCameraTriggers.dispatch(h, [{ ...detect, entity: 'event.other_detect' }]);
  assert.deepEqual(calls, [], 'Never blocks a detection');
  window.casoraCameraPopup.resolve = () => ({ open: { detection: 'always' } });
  window.CASORA_SETTINGS.cameras[0].open_on_detection = false;
  await window._casoraCameraTriggers.dispatch(h, [{ ...detect, entity: 'event.other_detect' }]);
  assert.deepEqual(calls, [['open', 'camera.first', 'camera.first']], 'Always overrides the default off');
}

{
  const w = { CASORA_SETTINGS: { cameras: [
    { entity_id: 'camera.one', detection_triggers: ['binary_sensor.recover_detection'] },
  ] } };
  vm.runInNewContext(source, { window: w, Date: Clock, Number, Object, Array, JSON });
  const result = await w._casoraCameraTriggers.recover({
    states: { 'binary_sensor.recover_detection': { state: 'on' } },
    callWS: async () => ({ 'binary_sensor.recover_detection': [
      { s: 'off', lc: (now - 2000) / 1000 }, { s: 'on', lc: (now - 1000) / 1000 },
    ] }),
  });
  assert.equal(result.length, 1, 'Recorder recovers a verified detection');
  assert.equal(result[0].role, 'detection');
}
