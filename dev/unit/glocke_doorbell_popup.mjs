// Bell rows open the ringing doorbell's own popup, without consuming the row.
// @deckt: custom_components/casora/scripts/casora-core.js#global
// @deckt: custom_components/casora/scripts/local/00-finder.js#global
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const core = fs.readFileSync(new URL('../../custom_components/casora/scripts/casora-core.js', import.meta.url), 'utf8');
const start = core.indexOf('(function () {\n  if (window._casoraNotify) return;');
assert.ok(start > 0);
const mod = core.slice(start, core.indexOf('\n})();', start) + 6);

class Element {
  constructor() {
    this.style = { setProperty() {}, removeProperty() {} };
    this.dataset = {};
    this.children = [];
    this.listeners = {};
    this.classList = { contains: () => false, toggle() {} };
  }
  appendChild(el) { this.children.push(el); el.parentNode = this; return el; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(el => el !== this); this.parentNode = null; }
  setAttribute() {}
  removeAttribute() {}
  getBoundingClientRect() { return { top: 50, bottom: 100, left: 0, right: 300, height: 50 }; }
  getRootNode() { return this; }
  getClientRects() { return [1]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(x => x !== fn); }
  querySelector() { return null; }
  querySelectorAll(sel) {
    const all = this.children.flatMap(el => [el, ...el.querySelectorAll('*')]);
    return sel === '*' ? all : all.filter(el => sel === '.hui-row' && el.className === 'hui-row');
  }
  set innerHTML(value) {
    this.children = [];
    for (const row of value && value.startsWith('[') ? JSON.parse(value) : []) {
      const el = this.appendChild(new Element());
      el.className = 'hui-row';
      el.dataset.casoraMi = row.entity;
    }
  }
}

async function setup(kind, options = {}) {
  const source = kind === 'ring' ? 'event.mock_doorbell_ding' : 'binary_sensor.mock_visitor';
  const cam = 'camera.mock_doorbell_sub';
  const when = Date.now() - 60000;
  const states = {
    [source]: { state: kind === 'ring' ? new Date(when).toISOString() : 'on',
      attributes: { friendly_name: 'Mock Doorbell', ...(kind === 'ring' ? { device_class: 'doorbell' } : {}) } },
    [cam]: { state: 'idle', attributes: { friendly_name: 'Mock Camera' } },
  };
  const registry = {
    [source]: { device_id: 'mock-bell', platform: kind, translation_key: kind === 'ring' ? 'ding' : 'visitor' },
    [cam]: { device_id: 'mock-bell', platform: kind, translation_key: kind === 'ring' ? 'live_view' : 'sub' },
  };
  const entries = [{ entity_id: source, state: states[source].state, when: when / 1000 }];
  if (options.released) {
    entries.push({ entity_id: source, state: 'off', when: when / 1000 + 3 });
    states[source].state = 'off';
  }
  if (options.lock) {
    states['lock.mock_gate'] = { state: 'locked', attributes: { friendly_name: 'Mock Gate' } };
    entries.push({ entity_id: 'lock.mock_gate', state: 'locked', when: when / 1000 - 10 });
  }
  if (options.unrelatedVisitor) {
    states['binary_sensor.mock_guest'] = { state: 'on', attributes: { friendly_name: 'Mock Guest' } };
    registry['binary_sensor.mock_guest'] = { platform: 'example', translation_key: 'visitor', device_id: 'mock-other' };
    entries.push({ entity_id: 'binary_sensor.mock_guest', state: 'on', when: when / 1000 - 20 });
  }
  if (options.orphan) delete registry[cam];
  if ((options.listed || options.detection) && !options.brandListed) registry[source] = { platform: 'example', device_id: 'mock-other' };
  const tileCam = options.mainTile ? 'camera.mock_doorbell_main' : cam;
  if (options.mainTile) {
    states[tileCam] = { state: 'idle', attributes: { friendly_name: 'Mock Main Camera' } };
    registry[tileCam] = { device_id: 'mock-bell', platform: kind, translation_key: 'main' };
  }
  const hass = { states, entities: registry, devices: {}, areas: {}, callWS: async () => entries };
  const body = new Element(), tile = new Element(), wrong = new Element(), sub = new Element();
  const popup = { template: kind === 'ring' ? 'casora_popup_camera' : 'casora_popup_reolink_doorbell', variables: { door_lock: 'lock.mock_gate' } };
  tile._config = { type: 'custom:button-card', entity: tileCam, template: kind === 'ring' ? 'casora_camera' : 'casora_reolink_doorbell', tap_action: {} };
  tile._config.tap_action.casora_popup = popup;
  if (options.hiddenTile) tile._config.visibility = [{ condition: 'user', users: ['mock-other-user'] }];
  tile._handleAction = function () {
    for (const fn of [...(this.listeners['hass-action'] || [])]) {
      fn({ detail: { config: this._config, action: 'tap' }, stopPropagation() {} });
    }
  };
  wrong._config = { entity: 'camera.other_doorbell', template: 'casora_camera', tap_action: { casora_popup: {} } };
  if (options.subTile) {
    sub._config = { type: 'custom:button-card', entity: cam, template: 'casora_camera',
      tap_action: { casora_popup: { template: 'casora_popup_camera' } } };
    sub._handleAction = tile._handleAction;
  }
  const document = { readyState: 'loading', hidden: false, body,
    querySelector: sel => sel === 'home-assistant' ? { hass, dispatchEvent() {} } : null,
    querySelectorAll: sel => sel === 'button-card' ? [wrong, ...(options.subTile ? [sub] : []), ...(options.noTile ? [] : [tile])] : [],
    addEventListener() {}, createElement: tag => {
      const el = new Element();
      if (tag === 'button-card') {
        el.setConfig = cfg => {
          el._config = { ...cfg };
          if (!cfg.tap_action && ['casora_camera', 'casora_reolink_doorbell'].includes(cfg.template)) {
            el._config.tap_action = { casora_popup: {
              template: cfg.template === 'casora_camera' ? 'casora_popup_camera' : 'casora_popup_reolink_doorbell',
            } };
          }
        };
        el._handleAction = tile._handleAction;
      }
      return el;
    } };
  const store = {}, opened = [], moreInfo = [], delays = [];
  const ctx = vm.createContext({ console, document, location: { pathname: '/mock/home' },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
    setTimeout: (fn, ms) => { delays.push(ms); if (ms === 80) fn(); return 0; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    CustomEvent: class {},
    Event: class {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }) });
  Object.assign(ctx, { window: ctx, innerWidth: 1000, addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    casoraHaptic() {}, casoraSecurityIcon: () => 'lock',
    _casoraCfgOnce: async () => ({ views: [{ cards: options.configTile ? [tile._config] : [] }] }),
    _casoraUI: { tokens: { font: 'mock' }, group: rows => JSON.stringify(rows) },
    casoraMenuGlass: { radius: '20px', apply() {}, lockScroll() {}, dropTop: () => 50, enter() {} },
    casoraPopup: { open: cfg => opened.push(cfg), moreInfo: id => moreInfo.push(id) } });
  if (options.listed || options.detection) {
    ctx.CASORA_SETTINGS = { cameras: [{ entity_id: cam, doorbell_triggers: options.listed ? [source] : [],
      detection_triggers: options.detection ? [source] : [], open_on_ring: false, open_on_detection: false }] };
    if (options.realListed) {
      ctx._casoraNotifyOpenViaCard = (_id, done, cfg) => { opened.push(cfg); done(true); };
      vm.runInContext(fs.readFileSync(new URL('../../custom_components/casora/scripts/local/25-camera-popup.js', import.meta.url), 'utf8'), ctx);
      vm.runInContext(fs.readFileSync(new URL('../../custom_components/casora/scripts/local/45-ring-popup.js', import.meta.url), 'utf8'), ctx);
    } else ctx.casoraCameraPopup = { open: (id, done) => { opened.push({ canonical: id }); done(true); } };
  }
  if (options.hiddenAll) ctx.casoraVisibleIds = async () => [];
  if (options.hiddenSub) ctx.casoraVisibleIds = async ids => ids.filter(id => id !== cam);
  ctx.customElements = { whenDefined: () => new Promise(() => {}), get: () => null };
  if (!options.noFinder) vm.runInContext(fs.readFileSync(new URL('../../custom_components/casora/scripts/local/00-finder.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(mod, ctx);
  if (options.realManual) {
    delete ctx.casoraCameraPopup;
    ctx.casoraNoEval = value => value;
    vm.runInContext(fs.readFileSync(new URL('../../custom_components/casora/scripts/local/25-camera-popup.js', import.meta.url), 'utf8'), ctx);
    ctx._casoraNotifyOpenViaCard = (id, done, config) => { opened.push(config); done(true); };
  }
  if (!options.noFinder && !options.detection && (!options.listed || options.brandListed)) assert.ok(ctx.casoraNotifySources(hass).some(row => row.entity === source && row.kinds.includes('doorbell')),
    'the Studio exception list recognizes the same doorbell source');
  const N = ctx._casoraNotify;
  await N.refresh();
  assert.equal(N.rows.length, options.lock ? 2 : 1, `${kind}: a press creates one doorbell row`);
  N.open(new Element());
  const menu = body.children[0], inner = menu.children[0];
  const list = inner.children.find(el => el.querySelectorAll('.hui-row').length);
  const click = async row => {
    const event = { composedPath: () => [row, list], preventDefault() {}, stopPropagation() {} };
    for (const fn of list.listeners.click || []) fn(event);
    // Routing and visibility checks are promise-based.
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  return { N, list, click, opened, moreInfo, popup, tile, source, store, hass, registry, cam, ctx, delays };
}

const ring = await setup('ring');
assert.equal(ring.N.rows.length, 1, 'one doorbell notification');
assert.equal(ring.N.rows[0].entity, ring.source, 'the source remains the notification identity');
const before = JSON.stringify(ring.N.rows), count = ring.N.count, store = JSON.stringify(ring.store);
await ring.click(ring.list.querySelectorAll('.hui-row')[0]);
assert.equal(ring.opened.length, 1, 'tapping the Ring-style row opens a popup');
assert.equal(ring.opened[0].template, ring.popup.template);
assert.equal(ring.opened[0].src, ring.tile, 'the matching tile supplies the popup and its options');
assert.deepEqual(ring.moreInfo, [], 'no raw event more-info');
assert.equal(JSON.stringify(ring.N.rows), before, 'opening does not remove or alter the row');
assert.equal(ring.N.count, count, 'opening does not mark the row read');
assert.equal(JSON.stringify(ring.store), store, 'opening does not change persisted read/done state');
const reolink = await setup('reolink');
assert.equal(reolink.N.rows.length, 1, 'a Reolink visitor press creates a row without a device class or guessed ID');
const reolinkBefore = JSON.stringify({ rows: reolink.N.rows, count: reolink.N.count, store: reolink.store });
await reolink.click(reolink.list.querySelectorAll('.hui-row')[0]);
assert.equal(reolink.opened.length, 1, 'tapping the Reolink-style row opens a popup');
assert.equal(reolink.opened[0].template, reolink.popup.template);
assert.equal(reolink.opened[0].src, reolink.tile);
assert.equal(JSON.stringify({ rows: reolink.N.rows, count: reolink.N.count, store: reolink.store }), reolinkBefore,
  'opening a Reolink popup leaves rows, count, and persisted read/done state unchanged');
const mainTile = await setup('reolink', { mainTile: true });
await mainTile.click(mainTile.list.querySelectorAll('.hui-row')[0]);
assert.equal(mainTile.opened[0].src, mainTile.tile, 'the configured main tile wins over the discovered sub stream');
assert.deepEqual(mainTile.opened[0].variables, mainTile.popup.variables, 'configured popup options survive drawer routing');
const storedMain = await setup('reolink', { mainTile: true, noTile: true, configTile: true });
await storedMain.click(storedMain.list.querySelectorAll('.hui-row')[0]);
assert.equal(storedMain.opened[0].src._config.entity, 'camera.mock_doorbell_main', 'an unrendered configured main tile wins over a generic sub-stream popup');
assert.equal(storedMain.opened[0].variables.door_lock, 'lock.mock_gate', 'stored popup options survive drawer routing');
const hiddenMain = await setup('reolink', { mainTile: true, noTile: true, configTile: true, hiddenTile: true });
await hiddenMain.click(hiddenMain.list.querySelectorAll('.hui-row')[0]);
assert.equal(hiddenMain.opened.length, 0, 'a configured main tile hidden for this user is not exposed through its sub stream');
assert.deepEqual(hiddenMain.moreInfo, [], 'a hidden configured tile does not fall back to more-info');
// Every candidate camera is hidden for this user: the fallback to all cameras must still hit the guard.
const hiddenAll = await setup('reolink', { mainTile: true, noTile: true, configTile: true, hiddenTile: true, hiddenAll: true });
await hiddenAll.click(hiddenAll.list.querySelectorAll('.hui-row')[0]);
assert.equal(hiddenAll.opened.length, 0, 'with every candidate camera hidden, the guard still blocks the popup');
assert.deepEqual(hiddenAll.moreInfo, [], 'and no more-info dialog opens either');
const bothTiles = await setup('reolink', { mainTile: true, subTile: true });
await bothTiles.click(bothTiles.list.querySelectorAll('.hui-row')[0]);
assert.equal(bothTiles.opened[0].src, bothTiles.tile, 'the doorbell tile wins over a separate sub camera tile');
assert.equal(bothTiles.opened[0].template, bothTiles.popup.template);
const hiddenSub = await setup('reolink', { mainTile: true, subTile: true, hiddenSub: true });
await hiddenSub.click(hiddenSub.list.querySelectorAll('.hui-row')[0]);
assert.equal(hiddenSub.opened[0].src, hiddenSub.tile, 'a hidden sub camera tile does not shadow the visible doorbell tile');
assert.equal(hiddenSub.opened[0].template, hiddenSub.popup.template);
const released = await setup('reolink', { released: true });
assert.equal(released.N.rows.length, 1, 'releasing the visitor sensor does not create another ring');
await released.click(released.list.querySelectorAll('.hui-row')[0]);
assert.equal(released.opened[0].src, released.tile, 'a released press still opens its doorbell tile');
await setup('ring', { unrelatedVisitor: true });
const orphan = await setup('ring', { orphan: true });
await orphan.click(orphan.list.querySelectorAll('.hui-row')[0]);
assert.equal(orphan.opened.length, 0, 'no unrelated doorbell popup when the device has no camera');
assert.deepEqual(orphan.moreInfo, [orphan.source]);
const loading = await setup('ring', { noFinder: true });
await loading.click(loading.list.querySelectorAll('.hui-row')[0]);
assert.deepEqual(loading.moreInfo, [loading.source], 'a tap before local finders load falls back safely');
const mixed = await setup('ring', { lock: true });
const lockRow = mixed.N.rows.find(row => row.entity === 'lock.mock_gate');
assert.equal(JSON.stringify(lockRow.opens), '["casora_badge_lock_group","casora_popup_lock"]', 'other rows retain their popup routing');
assert.equal(lockRow.done, false, 'other rows retain their done behavior');
const lockEl = mixed.list.querySelectorAll('.hui-row').find(el => el._casoraRow.entity === 'lock.mock_gate');
await mixed.click(lockEl);
assert.equal(mixed.opened.length, 0, 'a lock row never opens a camera popup');
assert.deepEqual(mixed.moreInfo, ['lock.mock_gate'], 'an unconfigured lock keeps its more-info fallback');
const untiled = await setup('ring', { noTile: true });
await untiled.click(untiled.list.querySelectorAll('.hui-row')[0]);
assert.equal(untiled.opened.length, 1, 'a Ring camera without a rendered tile can still open');
assert.equal(untiled.opened[0].template, 'casora_popup_camera', 'a Ring camera never gets a synthetic Reolink popup');
for (const brandListed of [false, true]) {
  const listed = await setup('reolink', { listed: true, brandListed, noTile: true });
  assert.equal(listed.N.rows.length, 1, 'listed and brand classification share one Logbook row');
  await listed.click(listed.list.querySelectorAll('.hui-row')[0]);
  assert.equal(listed.opened[0].canonical, listed.cam, 'listed row manually opens its canonical camera despite default off');
}
const detection = await setup('reolink', { detection: true, noTile: true });
assert.equal(detection.N.rows[0].label, 'Mock Doorbell erkannt');
await detection.click(detection.list.querySelectorAll('.hui-row')[0]);
assert.equal(detection.opened[0].canonical, detection.cam, 'detection row opens manually even when automatic opening is off');
assert.ok(detection.ctx.casoraNotifySources(detection.hass).some(row => row.entity === detection.source && row.kinds.includes('detection')),
  'listed detections are available in the exceptions list');
detection.N.configureFrom({ notify_camera_detection: false });
await detection.N.refresh();
assert.equal(detection.N.rows.length, 0, 'dashboard category hides detection rows');
detection.N.configureFrom({});
await detection.N.refresh();
assert.equal(detection.N.rows.length, 1, 'another dashboard defaults to showing detections');
detection.hass.callWS = async () => [];
await detection.N.refresh();
assert.equal(detection.N.rows.length, 0, 'missing Logbook history does not fabricate a detection');
const detectionManual = await setup('reolink', { detection: true, noTile: true, realManual: true });
await detectionManual.click(detectionManual.list.querySelectorAll('.hui-row')[0]);
assert.equal(detectionManual.opened[0].entity, detectionManual.cam, 'the real manual camera opener receives the camera');
assert.ok(!detectionManual.delays.includes(120000), 'manual bell opening does not arm an automatic close');
const overlap = await setup('reolink', { detection: true, listed: true, brandListed: true });
assert.equal(overlap.N.rows.length, 1, 'a brand and both listed roles share one row');
overlap.N.configureFrom({ notify_camera_detection: false });
await overlap.N.refresh();
assert.equal(overlap.N.rows.length, 1, 'turning off detections does not hide a ring row');
overlap.N.configureFrom({ notify_doorbell: false });
await overlap.N.refresh();
assert.equal(overlap.N.rows.length, 0, 'ring rows remain under the Doorbell category');
const realManual = await setup('reolink', { listed: true, realListed: true, noTile: true });
await realManual.click(realManual.list.querySelectorAll('.hui-row')[0]);
assert.equal(realManual.opened[0].template, 'casora_camera', 'bell invokes the real canonical camera opener');
assert.equal(realManual.opened[0].entity, realManual.cam);
assert.equal(realManual.delays.includes(120000), false, 'manual bell opening never arms automatic close');
console.log('ok glocke_doorbell_popup');
