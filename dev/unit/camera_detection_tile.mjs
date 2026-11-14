// Plain camera tile alerts use the shared listed-trigger watcher.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let now = Date.parse('2026-11-13T12:00:00Z');
class Clock extends Date { static now() { return now; } }
let timer, stopped = false;
const window = {
  CASORA_SETTINGS: { cameras: [{ entity_id: 'camera.mock', detection_triggers: ['event.mock'] }] },
  setInterval: fn => { timer = fn; return 1; },
  clearInterval: () => { stopped = true; },
};
const source = fs.readFileSync(new URL('../../custom_components/casora/scripts/local/26-camera-triggers.js', import.meta.url), 'utf8');
vm.runInNewContext(source, { window, Date: Clock, Number, Object, Array, JSON });
const watcher = window._casoraCameraTriggers;
let redraws = 0;
const card = { isConnected: true, requestUpdate: () => redraws++ };
assert.equal(watcher.recentTriggerText('camera.mock', card), '');
const states = { 'event.mock': { state: new Date(now).toISOString(), attributes: { friendly_name: 'Naam-Beweging' } } };
watcher.scan({ states });
assert.equal(watcher.recentTriggerText('camera.mock', card), 'Naam-Beweging · gerade eben');
assert.ok(redraws > 0, 'new occurrences redraw the tile');
now += 180000;
timer();
assert.equal(watcher.recentTriggerText('camera.mock', card), 'Naam-Beweging · vor 3 Min.');
window.casoraTr = text => text === 'vor 3 Min.' ? '3 min ago' : text;
assert.equal(watcher.recentTriggerText('camera.mock', card), 'Naam-Beweging · 3 min ago', 'only the age is translated');
now += 120000;
timer();
assert.equal(watcher.recentTriggerText('camera.mock', card), '', 'the line clears without a Home Assistant state update');
assert.equal(stopped, true, 'the redraw timer stops once no alert remains');
const templates = JSON.parse(fs.readFileSync(new URL('../../dashboards/casora/button_card_templates.json', import.meta.url), 'utf8'));
assert.equal(templates.casora_room.variables.notify_camera_detection, true, 'camera detections default on in dashboard variables');
assert.match(templates.casora_camera.state_display, /_casoraCameraTriggers\?\.recentTriggerText/);
assert.doesNotMatch(templates.casora_reolink_doorbell.state_display, /tileText\(entity\?\.entity_id/);
assert.doesNotMatch(templates.casora_frigate.state_display, /_casoraCameraTriggers/);
