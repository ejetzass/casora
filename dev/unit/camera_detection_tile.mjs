// Camera tile alerts come from the House listed-trigger helper (#188), not from the popup watcher.
// @deckt: dashboards/casora/button_card_templates.json
import assert from 'node:assert/strict';
import fs from 'node:fs';

const templates = JSON.parse(fs.readFileSync(new URL('../../dashboards/casora/button_card_templates.json', import.meta.url), 'utf8'));
assert.equal(templates.casora_room.variables.notify_camera_detection, true, 'camera detections default on in dashboard variables');
assert.match(templates.casora_camera.state_display, /casoraCameraAlert/);
assert.doesNotMatch(templates.casora_reolink_doorbell.state_display, /tileText\(entity\?\.entity_id/);
assert.doesNotMatch(templates.casora_frigate.state_display, /_casoraCameraTriggers/);
