// Shared ring discovery and identity without dashboard cards. Devices are invented.
// @deckt: custom_components/casora/scripts/local/26-camera-triggers.js custom_components/casora/scripts/local/00-finder.js#casoraDoorbellSources
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = new URL('../../custom_components/casora/scripts/local/26-camera-triggers.js', import.meta.url);
const storage = new Map();
function load(extra = {}, clock = Date) {
  const window = { sessionStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }, ...extra };
  const context = vm.createContext({ window, document: { querySelector: () => null }, Date: clock, JSON, Object, Number });
  vm.runInContext(fs.readFileSync(new URL('../../custom_components/casora/scripts/local/00-finder.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(source, 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../../custom_components/casora/scripts/local/24-klingel.js', import.meta.url), 'utf8'), context);
  return window._casoraRing;
}
const press = '2026-11-12T12:00:00.000Z';
const h = { entities: {
  'camera.mock_sub': { device_id: 'mock', platform: 'reolink', translation_key: 'sub' },
  'binary_sensor.mock_press': { device_id: 'mock', platform: 'reolink', translation_key: 'visitor' },
}, states: {
  'camera.mock_sub': { state: 'idle' },
  'binary_sensor.mock_press': { state: 'on', last_changed: press },
} };
let ring = load();
let found = ring.scan(h);
assert.equal(found.length, 1, 'registry discovery needs no doorbell tile');
assert.equal(found[0].cam, 'camera.mock_sub');
assert.equal(found[0].lastRing.id, press);
assert.equal(found[0].lastRing.at, Date.parse(press));
console.log('shared ring: global discovery and press identity OK');

const seen = new Set([found[0].lastRing.id]);
for (const state of ['off', 'unavailable', 'off']) {
  h.states['binary_sensor.mock_press'] = { state, last_changed: '2026-11-12T12:00:02.000Z' };
  seen.add(ring.scan(h)[0].lastRing.id);
}
assert.equal(seen.size, 1, 'release and recovery do not create another ring');
ring = load();
assert.equal(ring.scan(h)[0].lastRing?.id, press, 'reload after release retains press time');
const quiet = structuredClone(h);
quiet.entities['binary_sensor.quiet_press'] = quiet.entities['binary_sensor.mock_press'];
delete quiet.entities['binary_sensor.mock_press'];
quiet.states['binary_sensor.quiet_press'] = { state: 'unavailable' };
assert.equal(ring.scan(quiet)[0].lastRing, null);
quiet.states['binary_sensor.quiet_press'] = { state: 'off', last_changed: press };
assert.equal(ring.scan(quiet)[0].lastRing, null, 'unavailable to off is not a press');
quiet.states['binary_sensor.quiet_press'] = { state: 'on', last_changed: press };
assert.equal(ring.scan(quiet)[0].lastRing.id, press, 'off to on gives the press identity');
console.log('shared ring: transitions and reload OK');

// A saved press older than the tile's history window (3 days) is not fed back after a reload.
for (const [days, shown] of [[4, null], [2, true]]) {
  storage.clear();
  const at = Date.now() - days * 86400000, id = new Date(at).toISOString();
  storage.set('casora-ring:binary_sensor.stored', JSON.stringify({ id, at }));
  const got = load().lastRing({ sensor: 'binary_sensor.stored' }, { 'binary_sensor.stored': { state: 'off', last_changed: id } });
  assert.equal(got?.id ?? null, shown ? id : null, days + ' day old saved press');
}
storage.clear();


h.entities['camera.mock_main'] = { device_id: 'mock', platform: 'reolink', translation_key: 'main' };
h.entities['camera.mock_sub'].disabled_by = 'user';
h.entities = { ...h.entities };
assert.equal(ring.scan(h)[0].cam, 'camera.mock_main', 'main is used when sub is disabled');
h.entities['camera.event_bell'] = { device_id: 'event_mock', platform: 'ring' };
h.entities['event.renamed_press'] = { device_id: 'event_mock', platform: 'ring', translation_key: 'ding' };
h.entities['event.renamed_motion'] = { device_id: 'event_mock', platform: 'ring', translation_key: 'motion' };
h.states['event.renamed_press'] = { state: press, attributes: { device_class: 'doorbell', event_type: 'ding' } };
h.states['event.renamed_motion'] = { state: '2026-11-12T12:01:00.000Z', attributes: { device_class: 'motion' } };
h.entities = { ...h.entities };
found = ring.scan(h);
assert.equal(found.length, 2, 'motion is not a doorbell source');
assert.equal(found[1].lastRing.id, press, 'Ring press event works after entity rename');
assert.equal(found[1].cam, 'camera.event_bell');
h.states['event.renamed_press'] = { state: 'unavailable', attributes: { device_class: 'doorbell' } };   // HA keeps device_class while unavailable
assert.equal(ring.scan(h)[1].lastRing.id, press, 'event unavailability is not another ring');
console.log('shared ring: Ring events and camera selection OK');

const renamed = { entities: {
  'event.mock_ding': { device_id: 'renamed', platform: 'ring', translation_key: 'ding' },
  'camera.a_recording': { device_id: 'renamed', platform: 'ring', translation_key: 'last_recording' },
  'camera.z_last_recording': { device_id: 'renamed', platform: 'ring', translation_key: 'live_view' },
}, states: { 'event.mock_ding': { state: press, attributes: { device_class: 'doorbell' } } } };
assert.equal(load().scan(renamed)[0].cam, 'camera.z_last_recording', 'registry semantics win over renamed camera IDs');

// The 1 s watcher runs only while the current dashboard has a doorbell tile (checked on page change).
const doorbellTile = { type: 'custom:button-card', template: 'casora_reolink_doorbell', entity: 'camera.mock_sub' };
function lifecycle(route, cfg) {
  const listeners = {}, calls = { set: 0, cleared: 0, timeouts: [] };
  let poll;
  const env = { hass: quiet, route, cfg, calls, listeners, tick: () => poll() };
  env.ring = load({
    document: { querySelector: () => ({ hass: env.hass }), addEventListener: (k, fn) => { listeners[k] = fn; } },
    location: { get pathname() { return env.route; } },
    addEventListener: (k, fn) => { listeners[k] = fn; },
    setInterval: fn => { poll = fn; calls.set++; return 7; },
    clearInterval: id => { assert.equal(id, 7); calls.cleared++; },
    setTimeout: (fn, ms) => { calls.timeouts.push(ms); return 1; }, clearTimeout: () => {},
    _casoraCfgOnce: async () => env.cfg,
  });
  quiet.panels = { 'mock-dashboard': { component_name: 'lovelace' }, config: { component_name: 'config' }, 'casora-studio': { component_name: 'casora-studio' } };
  return env;
}
quiet.entities['camera.quiet_sub'] = { device_id: 'mock', platform: 'reolink', translation_key: 'sub' };
quiet.states['camera.quiet_sub'] = { state: 'idle' };
{
  const withTile = { views: [{ cards: [{ type: 'vertical-stack', cards: [doorbellTile] }] }] };
  const plain = { views: [{ cards: [{ type: 'custom:button-card', template: 'casora_light', entity: 'light.mock' }] }] };
  const env = lifecycle('/mock-dashboard/home', withTile);
  env.ring.forget('binary_sensor.quiet_press');
  env.ring.start();
  env.ring.start();
  await env.ring.check();
  assert.equal(env.calls.set, 1, 'one global watcher even after repeated starts');
  quiet.states['binary_sensor.quiet_press'] = { state: 'on', last_changed: '2026-11-12T12:02:00.000Z' };
  env.tick();
  quiet.states['binary_sensor.quiet_press'] = { state: 'off', last_changed: '2026-11-12T12:02:01.000Z' };
  assert.equal(env.ring.scan(quiet)[0].lastRing.id, '2026-11-12T12:02:00.000Z', 'watcher observes presses without a popup');
  env.cfg = plain;
  env.listeners['location-changed']();
  await env.ring.check();
  assert.equal(env.ring.polling(), false, 'a dashboard without a doorbell tile stops the watcher');
  assert.equal(env.calls.cleared, 1);
  env.cfg = withTile;
  await env.ring.check();
  assert.equal(env.calls.set, 2, 'and it starts again when a dashboard has one');
  env.route = '/config/devices';
  await env.ring.check();
  assert.equal(env.ring.polling(), false, 'a page that is no dashboard has no watcher');
  const none = lifecycle('/mock-dashboard/home', plain);
  await none.ring.check();
  assert.equal(none.calls.set, 0, 'no tile, no interval at all');
  const studio = lifecycle('/casora-studio/x', withTile);
  await studio.ring.check();
  assert.equal(studio.calls.set, 0, 'the Studio never runs the watcher');
  const refused = Promise.reject(new Error('not ready'));
  refused.catch(() => {});
  const broken = lifecycle('/mock-dashboard/home', refused);
  await broken.ring.check();
  assert.equal(broken.calls.set, 0, 'an unreadable config does not start the watcher');
  assert.deepEqual([...new Set(broken.calls.timeouts)], [30000], 'and is asked again after the backoff, not every second');
}
console.log('shared ring: page-independent watcher OK');

quiet.states['binary_sensor.quiet_press'] = { state: 'on', last_changed: '2026-11-12T12:03:00.123456+00:00' };
assert.equal(ring.scan(quiet)[0].lastRing.id, '2026-11-12T12:03:00.123Z', 'identity uses the press timestamp at Recorder precision');
quiet.states['binary_sensor.quiet_press'] = { state: 'off' };
assert.equal(load().scan(quiet)[0].lastRing.id, '2026-11-12T12:03:00.123Z', 'reload retains canonical timestamp');
const noStorage = { sessionStorage: { getItem() { throw Error('unavailable'); }, setItem() { throw Error('unavailable'); } } };
const precise = { sensor: 'binary_sensor.precise' };
const live = load(noStorage).lastRing(precise, { [precise.sensor]: { state: 'on', last_changed: '2026-11-12T12:03:00.123456+00:00' } });
const recovered = load(noStorage).lastRing(precise, { [precise.sensor]: { state: 'off' } }, [{ kind: 'ring', at: 1794484980123.456 }]);
assert.deepEqual({ ...recovered }, { ...live }, 'live and Recorder identities agree without storage after release/reload');
assert.equal(live.at, 1794484980123, 'canonicalization does not shift the semantic press time');

let enumerations = 0;
const indexed = structuredClone(renamed);
for (let i = 0; i < 50; i++) {
  indexed.entities['event.indexed_' + i] = { device_id: 'indexed_' + i, platform: 'ring', translation_key: 'ding' };
  indexed.entities['camera.indexed_' + i] = { device_id: 'indexed_' + i, platform: 'ring', translation_key: 'live_view' };
}
indexed.entities = new Proxy(indexed.entities, { ownKeys(target) { enumerations++; return Reflect.ownKeys(target); } });
ring = load();
ring.scan(indexed);
const initialEnumerations = enumerations;
assert.ok(initialEnumerations <= 2, 'discovery shares one device index instead of enumerating the registry for each doorbell');
for (let i = 0; i < 100; i++) ring.scan(indexed);
assert.equal(enumerations, initialEnumerations, 'steady-state ticks reuse registry discovery');
indexed.entities = { ...indexed.entities, 'camera.z_last_recording': { ...indexed.entities['camera.z_last_recording'], disabled_by: 'user' } };
assert.ok(!ring.scan(indexed).some(c => c.sensor === 'event.mock_ding'), 'a replacement registry invalidates discovery');

let now = Date.parse('2026-11-12T12:04:00Z');
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const requests = [];
let recordedPress = 1794484980.123456;
const historyHouse = { entities: {
  'camera.history': { device_id: 'history', platform: 'reolink', translation_key: 'sub' },
  'binary_sensor.history': { device_id: 'history', platform: 'reolink', translation_key: 'visitor' },
  'binary_sensor.detection': { device_id: 'history', platform: 'reolink', translation_key: 'person' },
}, states: {
  'camera.history': { state: 'idle' },
  'binary_sensor.history': { state: 'off', last_changed: '2026-11-12T12:03:01Z' },
  'binary_sensor.detection': { state: 'off' },
}, callWS: async request => {
  requests.push(request);
  return { 'binary_sensor.history': [{ s: 'off', lc: 1794484800 }, { s: 'on', lc: recordedPress }, { s: 'off', lc: recordedPress + 1 }] };
} };
ring = load(noStorage, Clock);
ring.scan(historyHouse);
await new Promise(resolve => setImmediate(resolve));
assert.equal(ring.scan(historyHouse)[0].lastRing.id, '2026-11-12T12:03:00.123Z', 'narrow Recorder recovery agrees with live press identity');
assert.deepEqual(Array.from(requests[0].entity_ids), ['binary_sensor.history'], 'background recovery never requests detection history');
for (let i = 0; i < 2000; i++) { now += 1000; ring.scan(historyHouse); }
assert.equal(requests.length, 1, 'unchanged background watcher retains latest recovery without periodic history fetches');
historyHouse.states['binary_sensor.history'] = { state: 'on', last_changed: new Date(now).toISOString() };
ring.scan(historyHouse);
historyHouse.states['binary_sensor.history'] = { state: 'off', last_changed: new Date(now + 1000).toISOString() };
ring.scan(historyHouse);
await new Promise(resolve => setImmediate(resolve));
assert.equal(requests.length, 1, 'release recovery waits for Recorder even after an observed press');
now += 20000;
recordedPress = (now - 1000) / 1000;
historyHouse.states['binary_sensor.history'] = { state: 'off', last_changed: new Date(now).toISOString() };
ring.scan(historyHouse);
assert.equal(requests.length, 1, 'unseen short press waits for Recorder to flush');
now += 7000;
ring.scan(historyHouse);
await new Promise(resolve => setImmediate(resolve));
assert.equal(requests.length, 2, 'an unseen release triggers one narrow recovery');
assert.equal(ring.scan(historyHouse)[0].lastRing.id, new Date(recordedPress * 1000).toISOString(), 'press between ticks recovers its actual press time, not the release');
console.log('shared ring: bounded press-only recovery OK');

const flush = () => new Promise(resolve => setImmediate(resolve));
function recoveryHouse(callWS) {
  const house = structuredClone({ entities: historyHouse.entities, states: historyHouse.states });
  house.states['binary_sensor.history'] = { state: 'off', last_changed: new Date(now - 60000).toISOString() };
  house.callWS = callWS;
  return house;
}
async function hour(r, house) {
  for (let i = 0; i < 3600; i++) { now += 1000; r.scan(house); await flush(); }
}
for (const error of [new Error('disconnected'), { code: 'unauthorized' }, { code: 'unknown_command' }]) {
  let calls = 0;
  const times = [];
  const house = recoveryHouse(async () => { calls++; times.push(now); throw error; });
  const r = load(noStorage, Clock);
  r.scan(house);
  await flush();
  await hour(r, house);
  assert.equal(calls, error.code ? 1 : 4, 'permanent failures stop; transient failures have a four-request budget per release');
  if (!error.code) assert.deepEqual(times.map(t => t - times[0]), [0, 30000, 90000, 210000], 'transient retries back off instead of polling every 30 seconds');
}

for (const change of ['forget', 'remove', 'replace', 'replace_uid']) {
  storage.clear();
  let resolve;
  const house = recoveryHouse(() => new Promise(r => { resolve = r; }));
  const r = load({}, Clock);
  r.scan(house);
  const resolveOld = resolve;
  if (change === 'forget') r.forget('binary_sensor.history');
  else {
    house.entities = structuredClone(house.entities);
    if (change === 'remove') delete house.entities['binary_sensor.history'];
    else if (change === 'replace_uid') {
      house.entities['binary_sensor.history'].unique_id = 'replacement';
    } else {
      house.entities['binary_sensor.history'].device_id = 'replacement';
      house.entities['camera.history'].device_id = 'replacement';
    }
    r.scan(house);
  }
  resolveOld({ 'binary_sensor.history': [{ s: 'on', lc: (now - 10000) / 1000 }] });
  await flush();
  assert.equal(r.lastRing({ sensor: 'binary_sensor.history' }, {}), null, change + ' invalidates pending recovery');
}
{
  let calls = 0, resolve;
  const house = recoveryHouse(() => { calls++; return new Promise(r => { resolve = r; }); });
  const r = load(noStorage, Clock);
  r.scan(house);
  const resolveOld = resolve;
  house.entities['binary_sensor.history'].translation_key = 'replacement';
  resolveOld({ 'binary_sensor.history': [{ s: 'on', lc: (now - 10000) / 1000 }] });
  await flush();
  await hour(r, house);
  assert.equal(calls, 1, 'an in-place owner change ends the stale recovery instead of retrying every tick');
}
storage.clear();
{
  const house = recoveryHouse(undefined);
  const r = load({}, Clock);
  house.states['binary_sensor.history'] = { state: 'on', last_changed: new Date(now - 10000).toISOString() };
  const expected = r.scan(house)[0].lastRing.id;
  house.states['binary_sensor.history'] = { state: 'off', last_changed: new Date(now - 9000).toISOString() };
  house.entities = structuredClone(house.entities);
  house.entities['camera.preferred'] = { ...house.entities['camera.history'], translation_key: 'main' };
  house.entities['camera.history'].disabled_by = 'user';
  assert.equal(r.scan(house)[0].lastRing.id, expected, 'camera preference changes preserve press ownership');
  house.entities = structuredClone(house.entities);
  house.entities['binary_sensor.history'].device_id = 'replacement';
  house.entities['camera.preferred'].device_id = 'replacement';
  assert.equal(r.scan(house)[0].lastRing, null, 'reused sensor ID does not inherit the previous device ring');
  assert.equal(load({}, Clock).scan(house)[0].lastRing, null, 'replacement also clears persisted press');
}

for (const initial of ['empty', 'older']) {
  const release = now - 1000, oldPress = now - 60000, newPress = release - 1000;
  let calls = 0, committed = false;
  const house = recoveryHouse(async () => {
    calls++;
    return { 'binary_sensor.history': committed
      ? [{ s: 'off', lc: (oldPress - 1000) / 1000 }, { s: 'on', lc: newPress / 1000 }, { s: 'off', lc: release / 1000 }]
      : initial === 'empty' ? [] : [{ s: 'on', lc: oldPress / 1000 }, { s: 'off', lc: (oldPress + 1000) / 1000 }] };
  });
  house.states['binary_sensor.history'].last_changed = new Date(release).toISOString();
  const r = load(noStorage, Clock);
  r.scan(house); now += 7000; r.scan(house); await flush();
  assert.equal(calls, 1);
  assert.equal(r.scan(house)[0].lastRing?.at ?? null, initial === 'empty' ? null : oldPress, 'incomplete response retains a genuine older press, never a release timestamp');
  committed = true;
  now += 30000; r.scan(house); await flush();
  assert.equal(r.scan(house)[0].lastRing?.at, newPress, 'late Recorder commit recovers the actual latest press');
  await hour(r, house);
  assert.equal(calls, 2, 'fresh release evidence ends recovery');
}
{
  let calls = 0;
  const house = recoveryHouse(async () => { calls++; return {}; });
  const r = load(noStorage, Clock);
  r.scan(house); await hour(r, house);
  assert.equal(calls, 4, 'permanently incomplete history exhausts the same bounded budget');
  house.states['binary_sensor.history'].last_changed = new Date(now).toISOString();
  r.scan(house); now += 7000; r.scan(house); await flush();
  assert.equal(calls, 5, 'a later release can start recovery after the previous budget exhausted');
}
{
  const a = now, b = now + 500, release = now + 600;
  let calls = 0;
  const house = recoveryHouse(async () => {
    calls++;
    return { 'binary_sensor.history': [
      { s: 'on', lc: a / 1000 }, { s: 'off', lc: (a + 100) / 1000 },
      { s: 'on', lc: b / 1000 }, { s: 'off', lc: release / 1000 },
    ] };
  });
  const r = load(noStorage, Clock);
  house.states['binary_sensor.history'] = { state: 'on', last_changed: new Date(a).toISOString() };
  assert.equal(r.scan(house)[0].lastRing.at, a);
  now += 1000;
  house.states['binary_sensor.history'] = { state: 'off', last_changed: new Date(release).toISOString() };
  r.scan(house); now += 7000; r.scan(house); await flush();
  assert.equal(r.scan(house)[0].lastRing.at, b, 'observing A on does not hide B completing between polls');
  await hour(r, house);
  assert.equal(calls, 1, 'fresh evidence stops the conservative release check');
}
{
  // A release seen fresh may not be in the Recorder yet: wait SECOND_PRESS_MS before reading history.
  let calls = 0;
  const house = recoveryHouse(async () => { calls++; return {}; });
  house.states['binary_sensor.history'].last_changed = new Date(now - 1000).toISOString();
  const r = load(noStorage, Clock);
  r.scan(house); await flush();
  assert.equal(calls, 0, 'a fresh release does not read history at once');
  now += 6000; r.scan(house); await flush();
  assert.equal(calls, 0, 'and still waits before SECOND_PRESS_MS has passed');
  now += 2000; r.scan(house); await flush();
  assert.equal(calls, 1, 'then reads history once');
}
console.log('shared ring: retry budgets, ownership, Recorder lag and inter-poll presses OK');
