// Kamera „Status von: …“ (07.10.2026, 1.1.1): Ein Bild über einen Proxy (go2rtc, Frigate, Scrypted,
// ONVIF-Proxy) meldet „bereit“, obwohl die Kamera dahinter weg ist. Je Kamera-Kachel lässt sich eine
// zweite Entität wählen, die sagt, ob die Kamera erreichbar ist (casora-core.js casoraCamOffline).
// Prüft mit erfundenen IDs: (1) ohne Einstellung nie offline (bisheriges Verhalten), (2) andere Kamera
// unavailable/unknown → offline, „idle“ → nicht, (3) Verbindungssensor off → offline, on → nicht,
// (4) Status-Entität fehlt → nicht offline (kein Raten), (5) Zuordnung aus den Kacheln des offenen
// Dashboards (auch in „conditional“), (6) Vorlagen und Sicherheits-Stufe fragen den Helfer.
//   node dev/unit/kamera_status_von.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../../', import.meta.url);
const core = fs.readFileSync(new URL('custom_components/casora/scripts/casora-core.js', root), 'utf8');
const a = core.indexOf('// casora-cam-status:start'), b = core.indexOf('// casora-cam-status:end');
assert.ok(a > 0 && b > a, 'Block casora-cam-status gefunden');

const states = {
  'camera.proxy_flur': { state: 'idle' },
  'camera.echt_flur': { state: 'unavailable' },
  'camera.proxy_garten': { state: 'idle' },
  'camera.echt_garten': { state: 'idle' },
  'camera.proxy_hof': { state: 'idle' },
  'binary_sensor.hof_verbunden': { state: 'off', attributes: { device_class: 'connectivity' } },
  'camera.proxy_keller': { state: 'idle' },
  'binary_sensor.keller_verbunden': { state: 'on', attributes: { device_class: 'connectivity' } },
};
const config = { views: [
  { cards: [{ type: 'custom:casora-smart-row', cards: [
    { type: 'custom:button-card', template: 'casora_camera', entity: 'camera.proxy_flur', variables: { status_entity: 'camera.echt_flur' } },
    { type: 'conditional', conditions: [], card: { type: 'custom:button-card', template: 'casora_camera', entity: 'camera.proxy_hof', variables: { status_entity: 'binary_sensor.hof_verbunden' } } },
  ] }] },
  { cards: [{ type: 'custom:button-card', template: 'casora_camera', entity: 'camera.proxy_garten' }] },
] };
const panel = { isConnected: true, lovelace: { config } };
const res = { querySelector: (q) => (q === 'ha-panel-lovelace' ? panel : null) };
const main = { shadowRoot: { querySelector: (q) => (q === 'partial-panel-resolver' ? res : null) } };
const hass = { states, entities: {
  'camera.proxy_flur': { device_id: 'flur' },
  'camera.proxy_garten': { device_id: 'garten' },
  'camera.proxy_hof': { device_id: 'hof' },
  'camera.proxy_keller': { device_id: 'keller' },
} };
const ha = { hass, shadowRoot: { querySelector: (q) => (q === 'home-assistant-main' ? main : null) } };
const window = {};
const document = { querySelector: (q) => (q === 'home-assistant' ? ha : null) };
new Function('window', 'document', core.slice(a, b))(window, document);
const off = window.casoraCamOffline;

// (1) House camera status wins over a saved tile value, including without a source tile.
window.CASORA_SETTINGS = { cameras: [
  { device_id: 'garten', entity_id: 'camera.proxy_garten', status_entity: 'binary_sensor.garten_verbunden' },
] };
const houseStates = { ...states, 'binary_sensor.garten_verbunden': { state: 'off' } };
assert.equal(window.casoraCamStatusOf('camera.proxy_garten', { status_entity: 'camera.echt_garten' }, hass),
  'binary_sensor.garten_verbunden', 'house Status from wins over the tile');
assert.equal(off('camera.proxy_garten', houseStates, { status_entity: 'camera.echt_garten' }, hass), true,
  'tile reads the house Status from before its own value');
const dashboardConfig = panel.lovelace.config;
panel.lovelace.config = { views: [] };
assert.equal(off('camera.proxy_garten', houseStates, undefined, hass), true,
  'popup on a dashboard with no camera tile reads the house Status from');
panel.lovelace.config = dashboardConfig;
assert.equal(off('camera.proxy_garten', { ...houseStates, 'binary_sensor.garten_verbunden': { state: 'on' } },
  { status_entity: 'camera.echt_garten' }, hass), false, 'house value wins even when the old tile value is offline');

// (2) An empty house value falls back to a saved tile value.
window.CASORA_SETTINGS = { cameras: [{ device_id: 'garten', entity_id: 'camera.proxy_garten' }] };
assert.equal(window.casoraCamStatusOf('camera.proxy_garten', { status_entity: 'camera.echt_garten' }, hass),
  'camera.echt_garten', 'empty house value falls back to the tile');
assert.equal(off('camera.proxy_flur', states), true, 'tile in the dashboard: status camera unavailable');
assert.equal(off('camera.proxy_hof', states), true, 'tile in a conditional: connectivity sensor off');
assert.equal(off('camera.proxy_flur'), true, 'without states: reads hass.states');

// (3) With neither value, the camera itself decides.
assert.equal(window.casoraCamStatusOf('camera.proxy_garten', undefined, hass), 'camera.proxy_garten',
  'camera itself is the final status source');
assert.equal(off('camera.proxy_garten', { ...states, 'camera.proxy_garten': { state: 'unavailable' } }, undefined, hass),
  true, 'camera itself unavailable is offline');
assert.equal(off('camera.proxy_garten', states, undefined, hass), false, 'camera itself idle is online');
assert.equal(window.casoraCamStatusOf('camera.proxy_hof'), 'binary_sensor.hof_verbunden', 'legacy tile map remains');
assert.equal(window.casoraCamStatusOf('camera.proxy_flur_sub', undefined, {
  ...hass, entities: { ...hass.entities, 'camera.proxy_flur_sub': { device_id: 'flur' } },
}), 'camera.echt_flur', 'legacy fallback follows sibling streams of the same camera');
// (4) other camera as status source, from the tile itself
assert.equal(off('camera.proxy_garten', states, { status_entity: 'camera.echt_flur' }), true, 'Status-Kamera unavailable → offline');
assert.equal(off('camera.proxy_garten', states, { status_entity: 'camera.echt_garten' }), false, 'Status-Kamera idle → online');
assert.equal(off('camera.proxy_garten', { ...states, 'camera.echt_garten': { state: 'unknown' } }, { status_entity: 'camera.echt_garten' }), true, 'unknown → offline');
// (5) Verbindungssensor
assert.equal(off('camera.proxy_keller', states, { status_entity: 'binary_sensor.keller_verbunden' }), false, 'verbunden → online');
assert.equal(off('camera.proxy_keller', { ...states, 'binary_sensor.keller_verbunden': { state: 'off' } }, { status_entity: 'binary_sensor.keller_verbunden' }), true, 'getrennt → offline');
// (6) fehlende Status-Entität
assert.equal(off('camera.proxy_garten', states, { status_entity: 'camera.gibt_es_nicht' }), false, 'fehlende Status-Entität → kein Raten');
// Studio-Vorschau: ungespeicherte Zuordnung geht vor, leere Liste heißt „keine“
assert.equal(off('camera.proxy_garten', states, { casora_camera_status: { 'camera.proxy_garten': 'camera.echt_flur' } }), true, 'Vorschau-Zuordnung');
assert.equal(off('camera.proxy_flur', states, { casora_camera_status: {} }), false, 'Vorschau ohne Zuordnung');

// (7) Aufrufer
const tpl = JSON.parse(fs.readFileSync(new URL('dashboards/casora/button_card_templates.json', root), 'utf8'));
const has = (k, re) => re.test(JSON.stringify(tpl[k]));
const runTemplate = (source, entity, states, variables, currentHass) => {
  const body = source.slice(source.indexOf('[[[') + 3, source.lastIndexOf(']]]'));
  return new Function('entity', 'states', 'variables', 'hass', 'user', 'window',
    `return (function () {${body}\n}).call(this);`).call({}, entity, states, variables, currentHass, null, window);
};
window.CASORA_SETTINGS = { cameras: [
  { device_id: 'garten', entity_id: 'camera.proxy_garten', status_entity: 'binary_sensor.garten_verbunden' },
] };
const cameraEntity = { ...states['camera.proxy_garten'], entity_id: 'camera.proxy_garten' };
assert.equal(runTemplate(tpl.casora_camera.state_display, cameraEntity, houseStates,
  { status_entity: 'camera.echt_garten' }, hass), 'Offline', 'camera tile consumes the shared house-first status');
assert.match(runTemplate(tpl.casora_badge_camera_group.name, null, houseStates,
  { cameras: ['camera.proxy_garten'] }, hass), /Offline/, 'camera badge consumes the shared house-first status');
assert.match(runTemplate(tpl.casora_badge_security_group.name, null, houseStates,
  { cameras: ['camera.proxy_garten'] }, hass), /Kamera offline/, 'security badge consumes the shared house-first status');
assert.ok(has('casora_camera', /casoraCamOffline\?\.\(entity\?\.entity_id, states, variables\)\) return \\"Offline\\"/), 'Kachel: „Offline“');
assert.ok(has('casora_badge_security_group', /casoraCamOffline\?\.\(id, states\)\) r\.camDead\+\+/), 'Sicherheits-Badge: „Kamera offline“');
assert.ok(has('casora_badge_camera_group', /casoraCamOffline/), 'Kamera-Badge');
assert.ok(has('casora_popup_camera', /casoraCamOffline/), 'Kamera-Popup');
const finden = fs.readFileSync(new URL('custom_components/casora/scripts/local/00-finder.js', root), 'utf8');
assert.ok(/dom === 'camera' && !!\(window\.casoraCamOffline && window\.casoraCamOffline\(id, S\)\)/.test(finden), 'Sicherheits-Stufe (Farben)');
const types = fs.readFileSync(new URL('custom_components/casora/panel/casora-panel-types.js', root), 'utf8');
const typeBlock = (id) => {
  const start = types.indexOf(`{ id: "${id}"`);
  const next = types.indexOf('\n  { id: "', start + 1);
  return start < 0 ? '' : types.slice(start, next < 0 ? types.length : next);
};
assert.doesNotMatch(typeBlock('casora_camera'), /key: "status_entity"/, 'camera tile editor no longer shows Status from');
assert.doesNotMatch(typeBlock('casora_frigate'), /key: "status_entity"/, 'Frigate tile editor no longer shows Status from');
// The Studio preview has its own copy of the rule: a freshly opened Studio has not loaded casora-core.js.
const panelSrc = fs.readFileSync(new URL('custom_components/casora/panel/casora-panel.js', root), 'utf8');
const statusCopy = panelSrc.match(/const camStatusOf = (\(id, map, cameras, hass\) => \{[\s\S]*?\n\};)\n/);
const offlineCopy = panelSrc.match(/const camOffline = (\(id, states, map, cameras, hass\) => \{[\s\S]*?\n\};)\n/);
assert.ok(statusCopy && offlineCopy, 'Studio: camera status resolver and evaluator found');
assert.ok(!/window\.casoraCamOffline/.test(offlineCopy[1]), 'Studio: the copy does not need casora-core.js');
const studioStatus = new Function('return ' + statusCopy[1])();
const studioOff = new Function('camStatusOf', 'return ' + offlineCopy[1])(studioStatus);
assert.equal(studioStatus('camera.a', {}, [{ device_id: 'a', entity_id: 'camera.a', status_entity: 'binary_sensor.house' }],
  { entities: { 'camera.a': { device_id: 'a' } } }), 'binary_sensor.house', 'Studio preview uses house config first');
assert.equal(studioStatus('camera.a', { 'camera.a': 'camera.tile' }, [{ device_id: 'a', entity_id: 'camera.a' }],
  { entities: { 'camera.a': { device_id: 'a' } } }), 'camera.tile', 'Studio preview falls back to tile values');
assert.equal(studioStatus('camera.a', {}, [], { entities: { 'camera.a': { device_id: 'a' } } }), 'camera.a',
  'Studio preview falls back to the camera itself');
for (const [cam, sid, st] of [['camera.a', 'camera.b', 'idle'], ['camera.a', 'camera.b', 'unavailable'], ['camera.a', 'camera.b', 'unknown'], ['camera.a', 'camera.b', ''],
  ['camera.a', 'binary_sensor.b', 'on'], ['camera.a', 'binary_sensor.b', 'off'], ['camera.a', 'binary_sensor.b', 'unavailable'], ['camera.a', 'sensor.b', 'off']]) {
  const S = { [sid]: { state: st } };
  const H = { entities: { [cam]: { device_id: 'a' } } };
  assert.equal(studioOff(cam, S, { [cam]: sid }, [], H), off(cam, S, { casora_camera_status: { [cam]: sid } }, H),
    `Studio = dashboard: ${sid} ${st}`);
}
assert.equal(studioOff('camera.a', {}, { 'camera.a': 'camera.b' }, [], { entities: {} }), false, 'Studio: missing status entity is not offline');
assert.equal(studioOff('camera.a', { 'camera.a': { state: 'unavailable' } }, {}, [], { entities: {} }), true,
  'Studio: the camera itself is offline without an override');

console.log('ok – Kamera „Status von“: house → tile → camera, tile/badges/popup and no-tile seam');
