// Camera popup settings resolve independently without migrating tile values.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../custom_components/casora/panel/casora-panel-personal.js', import.meta.url), 'utf8');
const window = {};
new Function('window', 'document', fs.readFileSync(new URL('../../custom_components/casora/scripts/local/25-camera-popup.js', import.meta.url), 'utf8'))(window, {});
new Function('window', 'customElements', source)(window, { get: () => null, whenDefined: () => ({ then() {} }) });
const camera = { device_id: 'mock-device', entity_id: 'camera.mock_main' };
const hass = { entities: { 'camera.mock_sub': { device_id: 'mock-device' } } };
const rooms = [{ tiles: [{ type: 'conditional', card: { entity: 'camera.mock_sub', variables: {
  alert_window_minutes: 8, show_stream_variants: true,
} } }] }];
const popup = { alert_window_minutes: 12 };
const before = structuredClone({ rooms, popup });
assert.deepEqual(window.casoraPersonal.cameraPopupValues(camera, hass, rooms, popup),
  { alert_window_minutes: 12, show_stream_variants: true });
assert.deepEqual({ rooms, popup }, before, 'reading fallback does not write anything');
const types = fs.readFileSync(new URL('../../custom_components/casora/panel/casora-panel-types.js', import.meta.url), 'utf8');
const cameraType = types.slice(types.indexOf('{ id: "casora_camera"'), types.indexOf('{ id: "casora_alarm"'));
assert.match(cameraType, /settingsLink: "cameras"/, 'Camera tile offers the settings link');
assert.doesNotMatch(cameraType, /key: "(alert_window_minutes|show_stream_variants)"/,
  'Camera tile no longer offers its own popup fields');
