// @deckt: dashboards/casora/button_card_templates.json#global
// A camera alert expires on its own timer, whatever sensor.time holds (#168): both helper copies (badge and
// camera popup), both alert kinds (doorbell and detection), every sensor.time state and the timer cleanup.
import assert from 'node:assert/strict';
import './_detection_rule.mjs';
import fs from 'node:fs';
import { testhaus } from './lib/testhaus.mjs';

const templates = JSON.parse(fs.readFileSync(new URL('../../dashboards/casora/button_card_templates.json', import.meta.url)));
const run = (source, card, hass, entity, variables) =>
  new Function('hass', 'states', 'entity', 'variables', source.trim().slice(3, -3))
    .call(card, hass, hass.states, entity, variables);
globalThis.window = globalThis;
// The clock helpers of casora-core.js (the same slice the clock test uses): the templates ask
// window.casoraTimeUnusable whether a sensor.time has a usable value.
const core = fs.readFileSync(new URL('../../custom_components/casora/scripts/casora-core.js', import.meta.url), 'utf8');
const coreFrom = core.indexOf('    window.casoraClockText = function');
const coreTo = core.indexOf('    if (!customElements.get(\'casora-clock\'))', coreFrom);
assert.ok(coreFrom > 0 && coreTo > coreFrom, 'clock helpers in casora-core.js');
new Function('window', 'document', core.slice(coreFrom, coreTo))(globalThis, { querySelector: () => ({ hass: null }) });
const realNow = Date.now;
let now = Date.parse('2026-01-01T12:00:00Z');
Date.now = () => now;
const pending = new Map();
let nextId = 0;
globalThis.setTimeout = (fn, delay) => { const id = ++nextId; pending.set(id, { fn, at: now + delay }); return id; };
globalThis.clearTimeout = (id) => pending.delete(id);
// Move the clock forward and run the timers that are due.
const advance = (ms) => {
  now += ms;
  for (const [id, task] of [...pending]) {
    if (task.at <= now) { pending.delete(id); task.fn(); }
  }
};
const camera = 'camera.testring_view';
const ding = 'event.testring_ding';
const motion = 'event.testring_motion';
const publicHouse = testhaus({ publicOnly: true });
assert.ok(publicHouse.entities[camera] && publicHouse.entities[ding] && publicHouse.entities[motion]);
const hass = {
  entities: { [camera]: { device_id: 'ring' }, [ding]: { device_id: 'ring' }, [motion]: { device_id: 'ring' } },
  states: { [camera]: { entity_id: camera, state: 'idle', attributes: {} },
    [ding]: { entity_id: ding, state: '2026-01-01T12:00:00Z' }, [motion]: { entity_id: motion, state: 'unknown' } },
};
const vars = { cameras: [camera], label: 'Camera' };
// A card that writes its output on every update.
const freshCard = (name, field) => ({ isConnected: true, addController(controller) { this.controller = controller; },
  requestUpdate() { this.output = run(templates[name][field], this, hass, hass.states[camera], vars); } });
const card = { isConnected: true, requestUpdate() { this.output = render(); }, addController(controller) { this.controller = controller; } };
const render = () => run(templates.casora_badge_camera_group.name, card, hass, hass.states[camera], vars);
// The timers that are due run now; a timer that schedules the next one waits for the next round.
const fire = () => {
  for (const [id, task] of [...pending]) {
    if (task.at <= now) { pending.delete(id); task.fn(); }
  }
};
// sensor.time in every state it can be in (the alert must not care).
const CLOCK_STATES = [undefined, '12:00', 'unavailable', 'unknown', ''];
const helperCopies = {
  casora_badge_base: templates.casora_badge_base.variables.casora_camera_alert_helper.value,
  casora_popup_camera: templates.casora_popup_camera.variables.casora_camera_alert_helper.value,
};

for (const [copy, source] of Object.entries(helperCopies)) {
  for (const clockState of CLOCK_STATES) {
    const label = `${copy} with sensor.time '${clockState === undefined ? 'missing' : clockState}'`;
    for (const [kind, eventId, word] of [['doorbell', ding, /klingel/i], ['detection', motion, /Bewegung erkannt/]]) {
      delete window.casoraCameraAlert;
      pending.clear();
      now = Date.parse('2026-01-01T12:00:00Z');
      hass.states[ding].state = kind === 'doorbell' ? '2026-01-01T12:00:00Z' : 'unknown';
      hass.states[motion].state = kind === 'detection' ? '2026-01-01T12:00:00Z' : 'unknown';
      if (clockState === undefined) delete hass.states['sensor.time'];
      else hass.states['sensor.time'] = { state: clockState };
      const fresh = { isConnected: true, addController(controller) { this.controller = controller; },
        requestUpdate() { this.output = run(templates.casora_badge_camera_group.name, this, hass, hass.states[camera], vars); } };
      run(source, fresh, hass, hass.states[camera], vars);
      assert.match(run(templates.casora_badge_camera_group.name, fresh, hass, hass.states[camera], vars), word,
        `${label}: the ${kind} alert shows while its window is open`);
      assert.equal(pending.size, 1, `${label}: the ${kind} alert schedules its own expiry timer`);
      for (let i = 0; i < 1000; i++) {
        run(templates.casora_badge_camera_group.name, fresh, hass, hass.states[camera], vars);
        assert.equal(pending.size, 1, `${label}: repeated renders leave one waiting timer`);
      }
      now += 301000;
      fire();
      assert.match(fresh.output, /Ruhig/, `${label}: the ${kind} alert is gone after its window`);
      assert.equal(pending.size, 0, `${label}: no timer remains after the ${kind} alert expired`);
    }
  }
}

// Two alerts at once: each keeps its own window (the doorbell first, then the detection).
// The helper returns one string, so the doorbell keeps priority and hides a detection until its window ends.
// This priority is kept until #169 decides how overlapping alerts are shown; do not change it before that.
{
  delete window.casoraCameraAlert;
  pending.clear();
  now = Date.parse('2026-01-01T12:00:00Z');
  hass.states[ding].state = '2026-01-01T12:00:00Z';
  hass.states[motion].state = '2026-01-01T12:01:00Z';
  delete hass.states['sensor.time'];
  const both = { isConnected: true, addController(controller) { this.controller = controller; },
    requestUpdate() { this.output = run(templates.casora_badge_camera_group.name, this, hass, hass.states[camera], vars); } };
  run(helperCopies.casora_badge_base, both, hass, hass.states[camera], vars);
  assert.match(run(templates.casora_badge_camera_group.name, both, hass, hass.states[camera], vars), /klingel/i,
    'both alerts: the doorbell shows');
  assert.equal(pending.size, 1, 'both alerts: one timer for the card');
  now += 301000;
  fire();
  assert.match(both.output, /Bewegung erkannt/, 'the doorbell window is over, the detection still runs');
  assert.equal(pending.size, 1, 'the detection schedules the next expiry');
  now += 61000;
  fire();
  assert.match(both.output, /Ruhig/, 'the detection window is over too');
  assert.equal(pending.size, 0, 'no timer remains');
}

// One dead camera of two: the badge shows the count, and the live camera's alert keeps its own expiry timer (F4).
{
  delete window.casoraCameraAlert;
  pending.clear();
  now = Date.parse('2026-01-01T12:00:00Z');
  const yard = 'camera.testring_yard';
  hass.entities[yard] = { device_id: 'ring' };
  hass.states[yard] = { entity_id: yard, state: 'idle', attributes: {} };
  hass.states[camera].state = 'unavailable';
  hass.states[ding].state = '2026-01-01T12:00:00Z';
  hass.states[motion].state = 'unknown';
  delete hass.states['sensor.time'];
  const twoCams = { cameras: [camera, yard], label: 'Camera' };
  const partly = { isConnected: true, addController(controller) { this.controller = controller; },
    requestUpdate() { this.output = run(templates.casora_badge_camera_group.name, this, hass, hass.states[yard], twoCams); } };
  run(helperCopies.casora_badge_base, partly, hass, hass.states[yard], twoCams);
  partly.requestUpdate();
  assert.match(partly.output, /1 offline/, 'one dead camera of two: the count shows');
  assert.equal(pending.size, 1, 'a dead camera does not cancel the live camera\'s alert timer');
  now += 301000;
  fire();
  assert.match(partly.output, /1 offline/, 'after the window: the count still shows');
  assert.equal(pending.size, 0, 'no timer remains after the alert expired');
  hass.states[camera].state = 'idle';
  delete hass.states[yard];
  delete hass.entities[yard];
}

// The timer belongs to the card: it goes with the card and comes back with it.
{
  delete window.casoraCameraAlert;
  pending.clear();
  now = Date.parse('2026-01-01T12:00:00Z');
  hass.states[ding].state = '2026-01-01T12:00:00Z';
  hass.states[motion].state = 'unknown';
  hass.states['sensor.time'] = { state: '12:00' };
  const live = { isConnected: true, addController(controller) { this.controller = controller; },
    requestUpdate() { this.output = run(templates.casora_badge_camera_group.name, this, hass, hass.states[camera], vars); } };
  run(helperCopies.casora_badge_base, live, hass, hass.states[camera], vars);
  live.requestUpdate();
  assert.match(live.output, /klingel/i, 'a usable sensor.time does not replace the alert');
  assert.equal(pending.size, 1, 'a usable sensor.time does not suppress the timer');
  live.controller.hostDisconnected();
  assert.equal(pending.size, 0, 'removing the card clears its timer');
  live.requestUpdate();
  assert.equal(pending.size, 0, 'a render while disconnected does not restart the timer');
  live.controller.hostConnected();
  assert.equal(pending.size, 1, 'reconnecting the card resumes expiry checks');
  hass.states[camera].state = 'unavailable';
  live.requestUpdate();
  assert.equal(pending.size, 0, 'an offline camera clears its hidden alert timer');
  hass.states[camera].state = 'idle';
  live.controller.hostDisconnected();
  assert.equal(pending.size, 0, 'the timer is gone with the card');

  // No alert, no timer.
  pending.clear();
  hass.states[ding].state = 'unknown';
  const idle = { isConnected: true, addController(controller) { this.controller = controller; },
    requestUpdate() { this.output = run(templates.casora_badge_camera_group.name, this, hass, hass.states[camera], vars); } };
  run(helperCopies.casora_badge_base, idle, hass, hass.states[camera], vars);
  idle.requestUpdate();
  assert.match(idle.output, /Ruhig/, 'no alert: the badge is idle');
  assert.equal(pending.size, 0, 'no alert: no timer');
  delete hass.states['sensor.time'];
}

// Every card that shows the alert expires on its own.
for (const [name, field] of [
  ['casora_cameras', 'state_display'],
  ['casora_badge_camera_group', 'name'],
  ['casora_badge_security', 'name'],
  ['casora_badge_contact_group', 'name'],
]) {
  const fresh = { isConnected: true, addController(controller) { this.controller = controller; },
    requestUpdate() { this.output = run(templates[name][field], this, hass, hass.states[camera], vars); } };
  for (const [kind, eventId, word] of [['doorbell', ding, /klingel/i], ['detection', motion, /Bewegung erkannt/]]) {
    pending.clear();
    now = Date.parse('2026-01-01T12:00:00Z');
    hass.states[ding].state = kind === 'doorbell' ? '2026-01-01T12:00:00Z' : 'unknown';
    hass.states[motion].state = kind === 'detection' ? '2026-01-01T12:00:00Z' : 'unknown';
    assert.match(run(templates[name][field], fresh, hass, hass.states[camera], vars), word, `${name}: the ${kind} alert`);
    assert.equal(pending.size, 1, `${name}: the ${kind} alert schedules its own expiry timer`);
    now += 301000;
    fire();
    assert.match(fresh.output, /Ruhig/, `${name}: the ${kind} alert is gone after its window`);
    assert.equal(pending.size, 0, `${name}: no timer remains`);
  }
}
hass.states[ding].state = 'unknown';
hass.states[motion].state = 'unknown';
Date.now = realNow;
console.log('camera_alert_expiry: ok');
