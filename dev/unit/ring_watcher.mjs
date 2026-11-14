// One watcher for the doorbell tile and listed camera triggers. Devices are invented.
// @deckt: custom_components/casora/scripts/local/26-camera-triggers.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const dir = new URL('../../custom_components/casora/scripts/local/', import.meta.url);
const NOW = Date.parse('2026-11-13T12:00:00Z');
class Clock extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } }
const tile = { type: 'custom:button-card', template: 'casora_reolink_doorbell', entity: 'camera.mock_sub' };
const withTile = { views: [{ cards: [tile] }] }, plain = { views: [{ cards: [{ template: 'casora_light' }] }] };
const pressAt = new Date(NOW - 5000).toISOString();
function env({ cfg, cameras }) {
  let current = cfg;
  const opened = [], timers = { set: 0, cleared: 0 };
  let tick;
  const hass = { panels: { 'mock-dashboard': { component_name: 'lovelace' }, 'casora-studio': { component_name: 'casora-studio' } },
    entities: {
      'camera.mock_sub': { device_id: 'mock', platform: 'reolink', translation_key: 'sub' },
      'binary_sensor.mock_press': { device_id: 'mock', platform: 'reolink', translation_key: 'visitor' },
    }, states: {
      'camera.mock_sub': { state: 'idle' },
      'binary_sensor.mock_press': { state: 'off', last_changed: new Date(NOW - 60000).toISOString() },
    }, callWS: async () => ({}) };
  const window = { CASORA_SETTINGS: { cameras }, route: '/mock-dashboard/home',
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { querySelector: () => ({ hass }), addEventListener() {} },
    addEventListener() {}, setTimeout: () => 1, clearTimeout() {},
    setInterval: fn => { tick = fn; timers.set++; return 9; }, clearInterval: () => { timers.cleared++; },
    _casoraCfgOnce: async () => current,
    casoraCameraPopup: { resolve: () => ({ open: {} }), config: id => ({ entity: id }) },
    _casoraRingPopup: { open: o => { opened.push(o); return true; }, handled() {} } };
  Object.defineProperty(window, 'location', { get: () => ({ pathname: window.route }) });
  const context = vm.createContext({ window, Date: Clock, JSON, Object, Number, Array, Promise });
  for (const f of ['00-finder.js', '26-camera-triggers.js', '24-klingel.js']) vm.runInContext(fs.readFileSync(new URL(f, dir), 'utf8'), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { setCfg: next => { current = next; }, window, hass, opened, timers, settle, tick: () => tick(), ring: window._casoraRing, triggers: window._casoraCameraTriggers };
}
const press = hass => { hass.states['binary_sensor.mock_press'] = { state: 'on', last_changed: pressAt }; };

// The tile path sees what tick() scans: wrap R.lastRing and collect what it returns.
function spyRing(e) {
  const seen = [], real = e.ring.lastRing;
  e.ring.lastRing = (...a) => { const r = real.apply(e.ring, a); if (r) seen.push(r); return r; };
  return seen;
}

// Same press, one identity: through the poller, the tile path (lastRing) and the trigger path (open) agree.
{
  const e = env({ cfg: withTile, cameras: [{ entity_id: 'camera.mock_sub', open_on_ring: true, doorbell_triggers: ['binary_sensor.mock_press'] }] });
  await e.ring.check();                          // the first tick observes off
  await e.settle();
  const seen = spyRing(e);
  press(e.hass);
  assert.equal(seen.length, 0, 'nothing scanned before the tick');
  e.tick();
  await e.settle();
  assert.equal(e.opened.length, 1);
  const tileRing = seen.find(r => r.id === pressAt);
  assert.ok(tileRing, 'the tick scanned the tile source and saw the press');
  assert.equal(e.opened[0].id, tileRing.id, 'tile and trigger path give one occurrence id');
  assert.equal(e.opened[0].id, pressAt);
}

// Camera cards and doorbell tiles are two lists: a card registered for the trigger text is not a doorbell tile.
const card = () => ({ isConnected: true });
{
  const e = env({ cfg: plain, cameras: [{ entity_id: 'camera.mock_sub' }] });
  await e.ring.check();                          // the dashboard is walked once
  e.triggers.recentTriggerText('camera.mock_sub', card());
  await e.ring.check();                          // same config: no new walk
  assert.equal(e.timers.set, 0, 'a registered camera card alone starts no poller');
  assert.equal(e.ring.polling(), false);
}
{
  const kicked = [];
  const e = env({ cfg: plain, cameras: [{ entity_id: 'camera.mock_sub', detection_triggers: ['binary_sensor.mock_press'] }] });
  e.window.casoraKick = c => { kicked.push(c); };
  const mine = card();
  e.triggers.recentTriggerText('camera.mock_sub', mine);
  await e.ring.check();
  e.setCfg({ views: [{ cards: [tile] }] });      // a new config: the dashboard is walked again
  await e.ring.check();
  press(e.hass);
  e.tick();
  await e.settle();
  assert.ok(kicked.includes(mine), 'a config change keeps the registered camera card');
  assert.ok(kicked.every(c => c === mine), 'repaint only touches camera cards, never tile configs');
}

// No doorbell tile and no listed trigger: no poller at all.
{
  const e = env({ cfg: plain, cameras: [{ entity_id: 'camera.mock_sub' }] });
  await e.ring.check();
  assert.equal(e.timers.set, 0, 'no tile and no listed trigger: no poller');
  assert.equal(e.ring.polling(), false);
}

// Listed trigger only (no tile): the watcher runs, one poller, and it does not scan brand sources.
{
  const e = env({ cfg: plain, cameras: [{ entity_id: 'camera.mock_sub', open_on_ring: true, doorbell_triggers: ['binary_sensor.mock_press'] }] });
  await e.ring.check();
  await e.settle();
  assert.equal(e.timers.set, 1, 'a listed trigger alone starts the single poller');
  assert.equal(e.ring.polling(), true);
  await e.ring.check();
  assert.equal(e.timers.set, 1, 'a repeated check keeps the one poller');
  e.window.route = '/casora-studio/x';
  await e.ring.check();
  assert.equal(e.ring.polling(), false, 'the Studio stops the poller');
}

// Tile only: the poller runs, but a brand doorbell that is not listed never opens a popup.
{
  const e = env({ cfg: withTile, cameras: [{ entity_id: 'camera.mock_sub', open_on_ring: true }] });
  await e.ring.check();
  assert.equal(e.timers.set, 1, 'a doorbell tile alone starts the poller');
  await e.settle();
  const seen = spyRing(e);
  press(e.hass);
  assert.equal(seen.length, 0, 'nothing scanned before the tick');
  e.tick();
  await e.settle();
  assert.ok(seen.some(r => r.id === pressAt), 'the tick scans the tile and sees the press');
  assert.equal(e.opened.length, 0, 'an unlisted brand doorbell opens no popup');
}

// Listed and pressed: the same watcher opens exactly one popup with the tile's identity.
{
  const e = env({ cfg: withTile, cameras: [{ entity_id: 'camera.mock_sub', open_on_ring: true, doorbell_triggers: ['binary_sensor.mock_press'] }] });
  await e.ring.check();
  await e.settle();
  press(e.hass);
  e.tick();
  await e.settle();
  assert.equal(e.timers.set, 1, 'tile and trigger share one poller');
  assert.deepEqual(e.opened.map(o => o.id), [pressAt]);
  assert.equal(e.ring.scan(e.hass)[0].lastRing.id, e.opened[0].id);
}
console.log('ring watcher: one poller, one occurrence identity, unlisted brand never opens OK');
