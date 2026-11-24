// Tracked flights, adding a flight (49-flights.js): identifier normalization, which control is written, duplicate
// suppression, what counts as confirmation, unconfirmed and failed outcomes, source change while pending, and that
// rendering, previews and list updates never write.
//   node dev/unit/flights_add.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#submit,addView,paint,controls,popup,sec
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const flush = () => new Promise((r) => setImmediate(r));

// Fake clock: the bounded wait is a timer we fire by hand, never a real sleep.
let timers = [];
const listeners = {}; // window listeners by event type, fired by hand below
const ctx = {
  console,
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => null },
  setTimeout: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
  clearTimeout: (t) => { if (t) t.live = false; },
  addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(read('custom_components/casora/scripts/local/49-flights.js'), ctx);
const F = ctx._casoraFlights;
const fire = () => { const due = timers.filter((t) => t.live); timers = []; due.forEach((t) => { t.live = false; t.fn(); }); };

// A hand-built hass with a call log. Registry changes swap hass.entities (as HA does).
const house = () => {
  const calls = [];
  const hass = {
    entities: {}, states: {}, calls,
    callService: (domain, service, data, target) => { calls.push({ domain, service, data, target }); return hass.reply ? hass.reply() : Promise.resolve(); },
  };
  hass.add = (id, o = {}) => {
    hass.entities = { ...hass.entities, [id]: { entity_id: id, platform: o.platform || 'flightradar24', device_id: o.dev || null, translation_key: o.key || null, entity_category: o.cat || null } };
    if (o.state !== null) hass.states[id] = { entity_id: id, state: o.state ?? 'ok', attributes: o.attrs || {} };
  };
  return hass;
};
const flight = (id, number, extra = {}) => ({ id, flight_number: number, callsign: number, aircraft_registration: 'REG-' + id, tracked_type: 'live', on_ground: 0, ...extra });
// Sets the tracked list of a source (a list update: the sensor state changes with it).
const setList = (hass, id, flights) => { hass.states[id] = { entity_id: id, state: String(flights.length), attributes: { flights } }; };
const UI = { line: () => '', group: () => '', empty: () => '', stage: () => '' };
ctx.window._casoraUI = UI;

// One source on device d1 with its own controls; a second device with a control of its own.
const base = (listFlights = []) => {
  const h = house();
  h.add('sensor.a', { dev: 'd1', key: 'additional_tracked', state: String(listFlights.length), attrs: { flights: listFlights } });
  h.add('text.add_a', { dev: 'd1', key: 'add_track', cat: 'config', state: '' });
  h.add('switch.a', { dev: 'd1', key: 'scanning', cat: 'config', state: 'on' });
  h.add('sensor.b', { dev: 'd2', key: 'additional_tracked', state: '0', attrs: { flights: [] } });
  h.add('text.add_b', { dev: 'd2', key: 'add_track', cat: 'config', state: '' });
  return h;
};

// ── Normalization and empty input ──
let h = base();
let a = F.submit(h, 'sensor.a', '   ');
assert.equal(a.state, 'empty', 'blank input is not submitted');
assert.equal(h.calls.length, 0, 'no call for empty input');
a = F.submit(h, 'sensor.a', '  xy123 ');
assert.equal(a.key, 'XY123', 'surrounding whitespace and case are normalized');
assert.equal(a.state, 'pending');
// JSON round-trip: the module runs in its own vm realm, so plain objects would not deep-equal.
assert.deepEqual(JSON.parse(JSON.stringify(h.calls.map((c) => [c.domain, c.service, c.data, c.target]))), [['text', 'set_value', { value: 'XY123' }, { entity_id: 'text.add_a' }]], 'the one call: text.set_value on the selected source\'s control');
assert.equal(F.draft, '  xy123 ', 'what was typed is kept for a retry');

// ── Duplicate in-flight submissions are suppressed ──
const again = F.submit(h, 'sensor.a', 'XY123');
assert.equal(again, a, 'a second press returns the attempt in flight');
assert.equal(h.calls.length, 1, 'no second call while pending');

// ── Success needs a new flight in the list, not the call ──
setList(h, 'sensor.a', [flight('fr-1', 'XY123')]);
assert.equal(F.addView(h, 'sensor.a').state, 'confirmed', 'a new FR24 flight ID matching the identifier confirms');

// ── Already tracked: no write, no claim of a new addition ──
h = base([flight('fr-9', 'AB456')]);
a = F.submit(h, 'sensor.a', 'ab456');
assert.equal(a.state, 'tracked', 'already in the list');
assert.equal(h.calls.length, 0, 'no write for an identifier already tracked');

// ── Matching is by number, callsign or registration; a reused number with an old ID does not confirm ──
h = base([flight('old-1', 'XY123')]);
F.submit(h, 'sensor.a', 'XY123');
assert.equal(F.submit(h, 'sensor.a', 'XY123').state, 'tracked', 'an older entry with the same number counts as tracked: no write');
assert.equal(h.calls.length, 0);
h = base([]);
a = F.submit(h, 'sensor.a', 'REG-NEW');
assert.equal(h.calls[0].data.value, 'REG-NEW', 'a registration is an accepted identifier');
setList(h, 'sensor.a', [flight('fr-2', 'QQ1', { aircraft_registration: 'REG-NEW' })]);
assert.equal(F.addView(h, 'sensor.a').state, 'confirmed', 'matched by registration');

// ── Correct instance and no fallback ──
h = base();
h.add('text.extra_a', { dev: 'd1', key: 'add_track', cat: 'config', state: '' });
a = F.submit(h, 'sensor.a', 'XY123');
assert.equal(a.state, 'ambiguous', 'two add controls on the source device: none is picked');
assert.equal(h.calls.length, 0);

h = base();
delete h.entities['text.add_a']; // the control is disabled: the registry no longer lists it
a = F.submit(h, 'sensor.a', 'XY123');
assert.equal(a.state, 'missing', 'a disabled or missing control is not replaced by another instance\'s');
assert.equal(h.calls.length, 0, 'no call to the other instance');

h = base();
h.states['text.add_a'].state = 'unavailable';
assert.equal(F.submit(h, 'sensor.a', 'XY123').state, 'unavailable', 'unavailable control: actionable, no call');
assert.equal(h.calls.length, 0);

// ── Ignored command: no list change, bounded wait, then unconfirmed; a later list update reconciles ──
h = base();
a = F.submit(h, 'sensor.a', 'XY123');
assert.equal(timers.filter((t) => t.live).length, 1, 'one bounded wait');
fire();
assert.equal(F.addView(h, 'sensor.a').state, 'unconfirmed', 'no list evidence: not confirmed, not success');
setList(h, 'sensor.a', [flight('fr-3', 'XY123')]);
assert.equal(F.addView(h, 'sensor.a').state, 'confirmed', 'a later list update reconciles the unconfirmed result');
assert.equal(h.calls.length, 1, 'no automatic retry');

// ── A refused call (the user may not use the control) is named as a permission problem, with the next step ──
h = base();
h.reply = () => Promise.reject(Object.assign(new Error('Unauthorized'), { code: 'unauthorized' }));
a = F.submit(h, 'sensor.a', 'XY123');
await flush();
assert.equal(a.state, 'denied', 'a refused call is denied, not a generic failure');
assert.match(F.sec('add', { pin: 'sensor.a' }, h.states, h), /Keine Berechtigung, den Flug hinzuzufügen\. Bitte einen Administrator/, 'denied: the next step is named');
h.reply = () => Promise.reject(new Error('Unauthorized'));
const second = F.submit(h, 'sensor.a', 'XY321'); // a new press after a denial
assert.notEqual(second, a, 'after a denial a new press starts a new attempt');
await flush();
assert.equal(second.state, 'denied', 'a message that says unauthorized is denied too');
delete h.reply;
fire();

// ── Failure without a raised error still reads unconfirmed; a raised error reads failed ──
h = base();
h.reply = () => Promise.reject(new Error('service failed'));
a = F.submit(h, 'sensor.a', 'XY123');
await flush();
assert.equal(a.state, 'failed', 'a raised service error is a failure');
delete h.reply;
const retry = F.submit(h, 'sensor.a', 'XY123');
assert.notEqual(retry, a, 'after a failure a new press starts a new attempt');
assert.equal(h.calls.length, 2, 'the second call is the user\'s own press, not an automatic retry');
fire();

// ── Source change while pending drops the attempt; the old source\'s list does not confirm it ──
h = base();
h.add('sensor.c', { dev: 'd3', key: 'additional_tracked', state: '0', attrs: { flights: [] } });
F.submit(h, 'sensor.a', 'XY123');
assert.equal(F.addView(h, 'sensor.c'), null, 'another source: no attempt shown');
setList(h, 'sensor.a', [flight('fr-4', 'XY123')]);
assert.equal(F.addView(h, 'sensor.a'), null, 'the dropped attempt does not come back, and does not confirm');
fire();
assert.equal(F.addView(h, 'sensor.a'), null, 'its timer does nothing once dropped');

// ── Rendering, previews and list updates never write ──
h = base();
const sec = (part, pin = 'sensor.a') => F.sec(part, { pin }, h.states, h);
const html = sec('add');
assert.match(html, /data-flights-add-btn/, 'the Add control is rendered');
assert.match(html, /Flugnummer, Rufzeichen oder Registrierung/, 'the help names the accepted forms');
assert.ok(F.popup(h.states, h, {}), 'popup renders');
F.addView(h, 'sensor.a');
setList(h, 'sensor.a', [flight('fr-5', 'ZZ9')]);
assert.equal(h.calls.length, 0, 'rendering, popup and list updates issue no command');

// ── Studio: the field is shown disabled and never submits ──
h = base();
ctx.window.casoraInStudio = () => true;
assert.match(sec('add'), /disabled/, 'Studio preview: disabled');
assert.equal(F.submit(h, 'sensor.a', 'XY123'), null, 'Studio: no submit');
assert.equal(h.calls.length, 0);
ctx.window.casoraInStudio = undefined;

// ── No source to add to: no field ──
h = base();
assert.equal(sec('add', ''), '', 'no source resolved: no Add field');
assert.equal(F.popup(h.states, h, {}).type !== undefined, true);
// ── Touch: a scroll that starts on the Add button is no tap (10 px, as in the sibling modules) ──
h = base();
ctx.document = { querySelector: (sel) => (sel === 'home-assistant' ? { hass: h } : null), querySelectorAll: () => [] };
const el = (attr, extra = {}) => ({ hasAttribute: (a) => a === attr, getAttribute: (a) => ({ 'data-flights-src': 'sensor.a' })[a] ?? null, ...extra });
const touchAt = (type, x, y, path) => ({ type, cancelable: false, touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }],
  composedPath: () => path, stopPropagation() {}, preventDefault() {} });
const fireTouch = (ev) => (listeners[ev.type] || []).forEach((fn) => fn(ev));
const addBtn = el('data-flights-add-btn');
fireTouch(touchAt('input', 0, 0, [el('data-flights-in', { value: 'XY123' })])); // the typed text (input listener)
fireTouch(touchAt('touchstart', 100, 100, [addBtn]));
fireTouch(touchAt('touchend', 100, 160, [addBtn])); // a 60 px drag, a scroll
assert.equal(h.calls.length, 0, 'a scroll that starts on Add sends nothing');
fireTouch(touchAt('touchstart', 100, 100, [addBtn]));
fireTouch(touchAt('touchend', 103, 104, [addBtn])); // 3 px: a tap
assert.equal(h.calls.length, 1, 'a tap on Add sends once');
assert.equal(h.calls[0].data.value, 'XY123');
ctx.document = { querySelector: () => null, querySelectorAll: () => [] };

// ── Access: the field has a label, a visible focus ring and wrapping help (WCAG 2.4.7 focus visible, 1.4.3 contrast) ──
h = base();
const field = sec('add');
const inputId = (field.match(/<input[^>]*id="([^"]+)"/) || [])[1];
assert.ok(inputId, 'the add input has an id');
assert.match(field, new RegExp('<label for="' + inputId + '"'), 'the visible label names the input (axe: label)');
assert.match(field, /\[data-flights-in\]:focus-visible[^{]*\{[^}]*outline:\s*2px/, 'the input shows a 2px focus ring');
assert.match(field, /\[data-flights-add-btn\]:focus-visible[^{]*\{[^}]*outline:\s*2px/, 'the Add button shows a 2px focus ring');
assert.match(field, /\[data-flights-in\]:focus-visible[^{]*\{[^}]*var\(--casora-popup-ui-action/, 'the ring uses the popup action colour token, as the sibling modules do');
assert.doesNotMatch(field, /nowrap/, 'no help or status text is set to nowrap');
assert.match(field, /id="flights-add-help"[^>]*white-space:normal/, 'the help text wraps');
assert.doesNotMatch(field, /id="flights-add-help"[^>]*opacity:\.75/, 'the help text keeps full contrast (4.5:1)');

fire(); // an attempt left pending by the touch test above expires first
// ── Scanning off: the field says so at once, nothing is sent and nothing waits 30 s ──
h = base();
h.states['switch.a'] = { entity_id: 'switch.a', state: 'off', attributes: { friendly_name: 'Datenabfrage' } };
const off = F.submit(h, 'sensor.a', 'XY123');
assert.equal(h.calls.length, 0, 'scanning off: no add command');
assert.equal(off.state, 'scanning', 'scanning off: its own state');
assert.equal(timers.filter((t) => t.live).length, 0, 'scanning off: no 30 s wait');
assert.match(sec('add'), /Datenabfrage ist in FlightRadar24 ausgeschaltet/, 'scanning off: the field names the switch');
// A scanning switch that cannot be confirmed on blocks the add like Stop: nothing is sent, the missing part is named.
for (const st of ['unavailable', 'unknown']) {
  h = base();
  h.states['switch.a'] = { entity_id: 'switch.a', state: st, attributes: {} };
  const unk = F.submit(h, 'sensor.a', 'XY123');
  assert.equal(h.calls.length, 0, `scanning ${st}: no add command`);
  assert.equal(unk.state, 'noscan', `scanning ${st}: its own state`);
  assert.match(sec('add'), /fehlt, was Casora braucht: der Schalter für die Datenabfrage/, `scanning ${st}: the missing part is named`);
}

// ── One wording for both commands: Add and Stop name the switch the same way ──
h = base([flight('fr-1', 'XY123')]);
h.add('text.remove_a', { dev: 'd1', key: 'remove_track', cat: 'config', state: '' });
h.states['switch.a'] = { entity_id: 'switch.a', state: 'off', attributes: { friendly_name: 'Datenabfrage' } };
F.submit(h, 'sensor.a', 'XY999');
const addMsg = sec('add');
const stop = F.stop(h, 'sensor.a', 'fr-1');
assert.equal(stop.state, 'scanning', 'scanning off: the stop says so too');
assert.equal(h.calls.length, 0, 'scanning off: no stop command');
const stopMsg = F.sec('list', { pin: 'sensor.a' }, h.states, h);
const wording = /Datenabfrage ist in FlightRadar24 ausgeschaltet(?!\.)/;
assert.match(addMsg, wording, 'the add feedback names the switch');
assert.match(stopMsg, wording, 'the stop feedback says the same');
assert.doesNotMatch(addMsg, /Schalte den Schalter/, 'the add feedback has no second sentence');
assert.doesNotMatch(stopMsg, /Schalte den Schalter/, 'the stop feedback has no second sentence');
fire();

// ── A missing part hides only Add: the list stays, the missing part is named ──
h = base([flight('fr-1', 'XY123')]);
delete h.entities['text.add_a'];
let missAdd = sec('add');
assert.doesNotMatch(missAdd, /data-flights-in/, 'no Add field without the control');
assert.doesNotMatch(missAdd, /data-flights-add-btn/, 'no Add button without the control');
assert.match(missAdd, /fehlt, was Casora braucht: das Eingabefeld zum Hinzufügen/, 'the missing part is named');
assert.match(F.sec('list', { pin: 'sensor.a' }, h.states, h), /data-flights-row="fr-1"/, 'the list and its rows stay');

h = base([flight('fr-1', 'XY123')]);
delete h.entities['switch.a'];
missAdd = sec('add');
assert.doesNotMatch(missAdd, /data-flights-add-btn/, 'no Add button without the scanning switch');
assert.match(missAdd, /fehlt, was Casora braucht: der Schalter für die Datenabfrage/, 'the missing part is named');
assert.match(F.sec('list', { pin: 'sensor.a' }, h.states, h), /data-flights-row="fr-1"/, 'the list and its rows stay');

// Both parts missing: the one note names both, not only the first one found.
h = base([flight('fr-1', 'XY123')]);
delete h.entities['text.add_a'];
delete h.entities['switch.a'];
const bothMissing = sec('add');
assert.doesNotMatch(bothMissing, /data-flights-add-btn/, 'no Add button without the add field and the switch');
assert.match(bothMissing, /In FlightRadar24 fehlen zwei Teile, die Casora braucht: das Eingabefeld zum Hinzufügen und der Schalter für die Datenabfrage/, 'the note names both missing parts');

// ── Failure names a next step, in Casora\'s own words ──
h = base();
h.reply = () => Promise.reject(new Error('service failed'));
F.submit(h, 'sensor.a', 'XY123');
await flush();
assert.equal(F.addView(h, 'sensor.a').state, 'failed');
assert.match(F.sec('add', { pin: 'sensor.a' }, h.states, h), /Prüfe die Flugkennung[^<]*versuche es erneut/, 'failure: a next step');
delete h.reply;

// ── Typing after an outcome clears the old status line (the next action starts) ──
h = base();
F.submit(h, 'sensor.a', '');
assert.equal(F.addView(h, 'sensor.a').state, 'empty');
(listeners.input || []).forEach((fn) => fn(touchAt('input', 0, 0, [el('data-flights-in', { value: 'X' })])));
assert.equal(F.addView(h, 'sensor.a'), null, 'typing clears the empty-input message');

console.log('ok flights_add');
