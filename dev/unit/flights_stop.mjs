// Tracked flights, stopping a flight (49-flights.js): the Stop button on a row of the complete list, the identifier that
// is sent, refusals for stale rows, missing or ambiguous controls and ambiguous identifiers, confirmation from the list,
// unconfirmed and failed outcomes, duplicate presses, external changes, and that rendering never writes.
//   node dev/unit/flights_stop.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#stop,stopView,paint,sec,controls
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const flush = () => new Promise((r) => setImmediate(r));

// Fake clock: the bounded wait is a timer we fire by hand, never a real sleep.
let timers = [];
const listeners = {}; // window listeners by event type, fired by hand below (touch)
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
const plain = (x) => JSON.parse(JSON.stringify(x)); // the module runs in its own realm

const house = () => {
  const calls = [];
  const hass = {
    entities: {}, states: {}, calls,
    callService: (domain, service, data, target) => { calls.push({ domain, service, data, target }); return hass.reply ? hass.reply() : Promise.resolve(); },
  };
  hass.add = (id, o = {}) => {
    hass.entities = { ...hass.entities, [id]: { entity_id: id, platform: 'flightradar24', device_id: o.dev || null, translation_key: o.key || null, entity_category: o.cat || null } };
    if (o.state !== null) hass.states[id] = { entity_id: id, state: o.state ?? 'ok', attributes: o.attrs || {} };
  };
  return hass;
};
// Neutral synthetic flights. Callsign and registration are empty unless a test needs them.
const flight = (id, number, extra = {}) => ({ id, flight_number: number, callsign: '', aircraft_registration: '', tracked_type: 'live', on_ground: 0, ...extra });
const setList = (hass, id, flights) => { hass.states[id] = { entity_id: id, state: String(flights.length), attributes: { flights } }; };
ctx.window._casoraUI = { line: () => '', group: () => '', empty: () => '', stage: () => '' };

// One source on device d1 with its own controls; a second source on device d2 with a remove control of its own.
const base = (flights = []) => {
  const h = house();
  h.add('sensor.a', { dev: 'd1', key: 'additional_tracked', state: String(flights.length), attrs: { flights } });
  h.add('text.add_a', { dev: 'd1', key: 'add_track', cat: 'config', state: '' });
  h.add('text.remove_a', { dev: 'd1', key: 'remove_track', cat: 'config', state: '' });
  h.add('switch.a', { dev: 'd1', key: 'scanning', cat: 'config', state: 'on' });
  h.add('sensor.b', { dev: 'd2', key: 'additional_tracked', state: '0', attrs: { flights: [] } });
  h.add('text.remove_b', { dev: 'd2', key: 'remove_track', cat: 'config', state: '' });
  return h;
};
const list = (h, src = 'sensor.a') => F.sec('list', { pin: src }, h.states, h);

// ── The complete list: every kind of entry has a Stop button, nothing is written by rendering ──
let h = base([
  flight('s1', 'XY123', { tracked_type: 'schedule' }),
  flight('s2', 'XY456', { on_ground: 1 }),
  flight('s3', 'XY789'),
  flight('s4', 'XY000', { on_ground: undefined }),
]);
let html = list(h);
['s1', 's2', 's3', 's4'].forEach((id) => assert.match(html, new RegExp('data-flights-row="' + id + '"'), 'a Stop button for ' + id));
assert.match(html, /Verfolgung beenden/, 'the button is named Stop tracking');
assert.match(html, /Beendet die Verfolgung in FlightRadar24/, 'the effect is explained before the command');
assert.match(html, /data-flights-rm-msg/, 'the feedback sits beside the list');
assert.equal(h.calls.length, 0, 'rendering the list writes nothing');
F.sec('list', { pin: 'sensor.a' }, h.states, h);
list(h); // a list update that re-renders the card
assert.equal(h.calls.length, 0, 're-rendering writes nothing');

// ── The one write: text.set_value on the remove control of the selected source's own instance ──
h = base([flight('s1', 'XY123', { tracked_type: 'schedule' }), flight('f2', 'XY456')]);
let a = F.stop(h, 'sensor.a', 's1');
assert.equal(a.state, 'pending', 'a scheduled entry is eligible for stop tracking');
assert.deepEqual(plain(h.calls.map((c) => [c.domain, c.service, c.data, c.target])), [['text', 'set_value', { value: 'XY123' }, { entity_id: 'text.remove_a' }]], 'one call, the identifier of the row, the control of this instance');

// ── Duplicate presses while pending: the same attempt, no second command, another row is not sent either ──
assert.equal(F.stop(h, 'sensor.a', 's1'), a, 'a second press returns the attempt in flight');
assert.equal(F.stop(h, 'sensor.a', 'f2'), a, 'another row while one is pending is not sent');
assert.equal(h.calls.length, 1, 'no second command while pending');
assert.equal(timers.filter((t) => t.live).length, 1, 'one bounded wait');

// ── Success needs observed membership removal: the row gone and no entry left with that identifier ──
await flush(); // the command has ended
setList(h, 'sensor.a', [flight('f2', 'XY456')]);
assert.equal(F.stopView(h, 'sensor.a').state, 'confirmed', 'the row is gone from the list: confirmed');
assert.match(list(h), /Verfolgung beendet/, 'the confirmed feedback is shown');
assert.equal(h.calls.length, 1, 'no retry after the confirmation');

// ── Ignored command: no list change, bounded wait, then unconfirmed; a later list update reconciles ──
h = base([flight('f1', 'XY123'), flight('f2', 'XY456')]);
F.stop(h, 'sensor.a', 'f1');
await flush(); // the command returns normally (it logs, it does not raise)
fire();
assert.equal(F.stopView(h, 'sensor.a').state, 'unconfirmed', 'no list evidence: not confirmed, not success');
assert.match(list(h), /Beenden nicht bestätigt/, 'the unconfirmed text is shown');
setList(h, 'sensor.a', [flight('f2', 'XY456')]);
assert.equal(F.stopView(h, 'sensor.a').state, 'confirmed', 'a later list update reconciles the unconfirmed result');
assert.equal(h.calls.length, 1, 'no automatic retry');

// ── Replaced row: the same flight number with another FR24 ID does not confirm the removal of the old row ──
h = base([flight('f1', 'XY123')]);
F.stop(h, 'sensor.a', 'f1');
setList(h, 'sensor.a', [flight('f9', 'XY123')]);
assert.equal(F.stopView(h, 'sensor.a').state, 'pending', 'an entry with the identifier is still tracked: not confirmed yet');
fire();
assert.equal(F.stopView(h, 'sensor.a').state, 'unconfirmed', 'and no removal is claimed');

// ── External removal during the operation: the row is gone, the feedback follows the list ──
h = base([flight('f1', 'XY123'), flight('f2', 'XY456')]);
F.stop(h, 'sensor.a', 'f1');
await flush(); // the command has ended (its promise resolved) before the list is seen
setList(h, 'sensor.a', [flight('f2', 'XY456')]);
assert.equal(F.stopView(h, 'sensor.a').state, 'confirmed', 'the membership is observed, whoever removed it');

// ── External re-addition after a confirmed stop: the old result is dropped, the list speaks for itself ──
setList(h, 'sensor.a', [flight('f2', 'XY456'), flight('f1', 'XY123')]);
assert.equal(F.stopView(h, 'sensor.a'), null, 'the flight is listed again: no stale "stopped" text');

// ── Refusals: nothing is sent ──
h = base([flight('f1', 'XY123')]);
assert.equal(F.stop(h, 'sensor.a', 'gone').state, 'stale', 'a row that is no longer in the list');
assert.equal(h.calls.length, 0);

h = base([flight('f1', 'XY123'), flight('f2', 'XY123')]);
assert.equal(F.stop(h, 'sensor.a', 'f1').state, 'ambiguous', 'two entries share the identifier: the command could remove the other one');
assert.equal(h.calls.length, 0, 'no guess');

// An aircraft stub and a flight on the same airframe share the registration. The integration removes the first entry
// whose identifier matches the one sent. The flight's identifier is its flight number, which the stub does not carry:
// the flight goes, and the registration is not the sent identifier, so the shared registration does not block it.
h = base([{ id: 'a1', flight_number: '', callsign: '', aircraft_registration: 'T-AAAA', tracked_type: 'aircraft', on_ground: 1 },
  flight('f1', 'XY123', { aircraft_registration: 'T-AAAA' })]);
assert.equal(F.stop(h, 'sensor.a', 'f1').state, 'pending', 'a unique flight number is sent although the registration is shared');
assert.deepEqual(plain(h.calls[0].data), { value: 'XY123' }, 'the flight number is the identifier sent');
fire();
// The aircraft stub's identifier is its registration, which the flight carries: the command could take the flight instead.
h = base([{ id: 'a1', flight_number: '', callsign: '', aircraft_registration: 'T-AAAA', tracked_type: 'aircraft', on_ground: 1 },
  flight('f1', 'XY123', { aircraft_registration: 'T-AAAA' })]);
assert.equal(F.stop(h, 'sensor.a', 'a1').state, 'ambiguous', 'the aircraft entry\'s registration is carried by the flight');
assert.equal(h.calls.length, 0, 'nothing is sent');

h = base([flight('f1', 'XY123'), flight('f2', '', { callsign: 'XY123' })]);
assert.equal(F.stop(h, 'sensor.a', 'f1').state, 'ambiguous', 'a callsign that equals the number of another entry is ambiguous too');
assert.equal(h.calls.length, 0);

h = base([flight('f3', '', { callsign: 'TST9' })]);
a = F.stop(h, 'sensor.a', 'f3');
assert.deepEqual(plain(h.calls[0].data), { value: 'TST9' }, 'without a flight number the callsign is the identifier');
fire(); // no list evidence: the attempt ends unconfirmed, and the next press is a new one

h = base([flight('f4', '', { aircraft_registration: '' })]);
assert.equal(F.stop(h, 'sensor.a', 'f4').state, 'noident', 'no supported identifier: nothing to send');
assert.equal(h.calls.length, 0);

h = base([flight('f5', 'XY500')]);
delete h.entities['text.remove_a'];
assert.equal(F.stop(h, 'sensor.a', 'f5').state, 'missing_ctl', 'a missing control is not replaced by another instance\'s');
assert.equal(h.calls.length, 0, 'no call to the other instance');

h = base([flight('f5', 'XY500')]);
h.add('text.remove_x', { dev: 'd1', key: 'remove_track', cat: 'config', state: '' });
assert.equal(F.stop(h, 'sensor.a', 'f5').state, 'ambiguous_ctl', 'two remove controls on the device: none is picked');
assert.equal(h.calls.length, 0);

h = base([flight('f5', 'XY500')]);
h.states['text.remove_a'].state = 'unavailable';
assert.equal(F.stop(h, 'sensor.a', 'f5').state, 'unavailable_ctl', 'unavailable control: actionable, no call');
assert.equal(h.calls.length, 0);

h = base([flight('f5', 'XY500')]);
h.states['sensor.a'].state = 'unavailable';
assert.equal(F.stop(h, 'sensor.a', 'f5').state, 'source', 'an unavailable source is not used for a stop');
assert.equal(h.calls.length, 0);

// ── Service error: a raised error reads failed, and a new press is the user\'s own ──
h = base([flight('f1', 'XY123')]);
h.reply = () => Promise.reject(new Error('service failed'));
a = F.stop(h, 'sensor.a', 'f1');
await flush();
assert.equal(a.state, 'failed', 'a raised service error is a failure');
const again = F.stop(h, 'sensor.a', 'f1');
assert.notEqual(again, a, 'after a failure a new press starts a new attempt');
assert.equal(h.calls.length, 2, 'the second call is the user\'s own press, not an automatic retry');

// ── Source change while pending drops the attempt; the old source\'s list does not confirm it ──
h = base([flight('f1', 'XY123')]);
F.stop(h, 'sensor.a', 'f1');
assert.equal(F.stopView(h, 'sensor.b'), null, 'another source: no attempt shown');
assert.equal(F.stop(h, 'sensor.b', 'zz').state, 'stale', 'another source is not held up by a pending stop on this one');
setList(h, 'sensor.a', []);
assert.equal(F.stopView(h, 'sensor.a'), null, 'the dropped attempt does not come back, and does not confirm');
fire();
assert.equal(F.stopView(h, 'sensor.a'), null, 'its timer does nothing once dropped');

// ── Studio: the buttons are shown disabled and never send ──
h = base([flight('f1', 'XY123')]);
ctx.window.casoraInStudio = () => true;
assert.match(list(h), /data-flights-stop[^>]*disabled/, 'Studio preview: disabled');
assert.equal(F.stop(h, 'sensor.a', 'f1'), null, 'Studio: no stop');
assert.equal(h.calls.length, 0);
ctx.window.casoraInStudio = undefined;

// ── Scanning off: the stop says so at once, nothing is sent and nothing waits 30 s ──
h = base([flight('f1', 'XY123')]);
h.states['switch.a'] = { entity_id: 'switch.a', state: 'off', attributes: { friendly_name: 'Datenabfrage' } };
const off = F.stop(h, 'sensor.a', 'f1');
assert.equal(off.state, 'scanning', 'scanning off: its own state');
assert.equal(h.calls.length, 0, 'scanning off: no stop command');
assert.equal(timers.filter((t) => t.live).length, 0, 'scanning off: no 30 s wait');
assert.match(list(h), /Datenabfrage ist in FlightRadar24 ausgeschaltet/, 'the feedback names the switch');

// ── A missing remove control hides only the Stop buttons: the rows stay, the missing part is named ──
h = base([flight('f1', 'XY123')]);
delete h.entities['text.remove_a'];
html = list(h);
assert.doesNotMatch(html, /<button[^>]*data-flights-stop/, 'no Stop button without the control');
assert.match(html, /data-flights-row="f1"/, 'the row stays');
assert.match(html, /fehlt, was Casora braucht: das Steuerelement zum Beenden/, 'the missing part is named');
assert.doesNotMatch(html, /flights-stop-help/, 'no explanation of a button that is not there');

// Two controls on the device are not a missing part: the button stays and the press names the ambiguity.
h = base([flight('f1', 'XY123')]);
h.add('text.remove_x', { dev: 'd1', key: 'remove_track', cat: 'config', state: '' });
html = list(h);
assert.match(html, /data-flights-stop/, 'the Stop button stays with two controls');
assert.doesNotMatch(html, /fehlt, was Casora braucht/, 'no missing-part text: the part is there');

// ── No flight ID: no button, because a row without an ID cannot be told apart from its neighbours ──
h = base([{ flight_number: 'XY700', tracked_type: 'live', on_ground: 0 }]);
assert.doesNotMatch(list(h), /<button[^>]*data-flights-stop/, 'no button for an entry without an FR24 ID');

// ── A row replaced while the command is still pending is not confirmed before the command ends ──
h = base([flight('f1', 'XY123')]);
h.reply = () => new Promise(() => {}); // the command has not ended
F.stop(h, 'sensor.a', 'f1');
setList(h, 'sensor.a', [flight('f9', 'XY999')]); // the row is gone, no XY123 left
assert.equal(F.stopView(h, 'sensor.a').state, 'pending', 'no "stopped" text while the command is pending');
delete h.reply;
fire(); // the never-ending attempt above times out before the next press

// ── Access: the stop texts wrap, the buttons show a focus ring, and the secondary text keeps its contrast ──
h = base([flight('f1', 'XY123')]);
html = list(h);
assert.doesNotMatch(html, /nowrap/, 'no stop text is set to nowrap');
assert.match(html, /id="flights-stop-help"[^>]*white-space:normal/, 'the explanation wraps');
assert.match(html, /data-flights-rm-msg[^>]*white-space:normal/, 'the feedback wraps');
assert.match(html, /\[data-flights-stop\]:focus-visible[^{]*\{[^}]*outline:\s*2px/, 'the Stop button shows a 2px focus ring');
assert.match(html, /\[data-flights-stop\]:focus-visible[^{]*\{[^}]*var\(--casora-popup-ui-action/, 'the ring uses the popup action colour token, as the sibling modules do');
assert.match(html, /data-flights-rm-msg[^>]*tabindex="-1"/, 'the feedback line can take the focus when the row it followed is gone');
assert.doesNotMatch(html, /opacity:\.75/, 'secondary text uses a colour token, not reduced opacity');

// ── The empty state keeps the confirmation: the last row goes and "stopped" still shows ──
h = base([flight('f1', 'XY123')]);
F.stop(h, 'sensor.a', 'f1');
await flush();
setList(h, 'sensor.a', []);
assert.match(list(h), /Verfolgung beendet/, 'the confirmation survives the list emptying');

// ── The next action clears the stop feedback: adding a flight drops it, and stopping drops the add line ──
h = base([flight('f1', 'XY123')]);
F.stop(h, 'sensor.a', 'f1');
await flush();
setList(h, 'sensor.a', []);
assert.match(list(h), /Verfolgung beendet/);
F.submit(h, 'sensor.a', 'XY500');
assert.equal(F.stopView(h, 'sensor.a'), null, 'an add clears the stop line');
h = base([flight('f1', 'XY123')]);
F.submit(h, 'sensor.a', '');
F.stop(h, 'sensor.a', 'f1');
assert.equal(F.addView(h, 'sensor.a'), null, 'a stop clears the add line');

fire(); // the attempt left pending above expires first: one removal per source at a time
// ── A refused command (the user may not use the control) is named as a permission problem, with the next step ──
h = base([flight('f1', 'XY123')]);
h.reply = () => Promise.reject(Object.assign(new Error('Unauthorized'), { code: 'unauthorized' }));
a = F.stop(h, 'sensor.a', 'f1');
await flush();
assert.equal(a.state, 'denied', 'a refused command is denied, not a generic failure');
assert.match(list(h), /Keine Berechtigung, die Verfolgung zu beenden\. Bitte einen Administrator/, 'denied: the next step is named');
delete h.reply;

// ── The row goes while the command still runs: "stopped" waits for the command's end, then is settled at once ──
h = base([flight('f1', 'XY123'), flight('f2', 'XY456')]);
let release;
h.reply = () => new Promise((r) => { release = r; });
a = F.stop(h, 'sensor.a', 'f1');
setList(h, 'sensor.a', [flight('f2', 'XY456')]);
assert.equal(F.stopView(h, 'sensor.a').state, 'pending', 'no claim while the command runs');
ctx.document = { querySelector: (sel) => (sel === 'home-assistant' ? { hass: h } : null), querySelectorAll: () => [] };
release();
await flush(); // no list draw in between: the command's end alone settles it
assert.equal(a.state, 'confirmed', 'the command ends: the removal is confirmed at once, not by the 30 s wait');
fire();
assert.equal(a.state, 'confirmed', 'and the wait does not turn it into unconfirmed');
delete h.reply;
ctx.document = { querySelector: () => null };

// ── Keyboard focus: the page's buttons are redrawn as the card does; focus and disabled state live on each button ──
let focused = null, focusLog = [], buttons = [];
const drawButtons = (flights) => {
  buttons = flights.map((f) => {
    const el = { disabled: false, getAttribute: (n) => (n === 'data-flights-row' ? f.id : null), hasAttribute: (n) => n === 'data-flights-stop',
      focus() { focused = el; focusLog.push(f.id); }, getRootNode() { return { activeElement: focused }; } };
    return el;
  });
};
ctx.document = { querySelector: () => null, querySelectorAll: (sel) => (sel === '[data-flights-stop]' ? buttons : []) };

// A stop from the keyboard: the focus goes to the Stop button that takes the place of the row (the same position).
const three = [flight('f1', 'XY123'), flight('f2', 'XY456'), flight('f3', 'XY789')];
h = base(three);
drawButtons(three);
focused = buttons[1];
F.stop(h, 'sensor.a', 'f2');
await flush(); // the command returns; the list then drops row 2
const rest = [three[0], three[2]];
setList(h, 'sensor.a', rest);
drawButtons(rest);
list(h); // the card draws again without row 2
fire(); fire(); // the focus step runs after the draw
assert.equal(focusLog[focusLog.length - 1], 'f3', 'focus moves to the Stop button that took the row\'s place');
assert.equal(F.stopView(h, 'sensor.a').state, 'confirmed');

// A command that is ignored: the row stays, and the focus returns to its Stop button once the buttons are enabled again.
const two = [flight('f1', 'XY123'), flight('f2', 'XY456')];
h = base(two);
drawButtons(two);
focused = buttons[0];
F.stop(h, 'sensor.a', 'f1');
await flush();
fire(); fire();
assert.equal(F.stopView(h, 'sensor.a').state, 'unconfirmed');
assert.equal(focusLog[focusLog.length - 1], 'f1', 'no removal: focus is back on the same row\'s Stop button');
ctx.document = { querySelector: () => null, querySelectorAll: () => [] };

// ── The user moves the focus to the Add field while a stop runs: the settle must not take it back to a Stop button ──
for (const withEvent of [true, false]) { // with the browser's focusin, and without it (the check at settle time alone)
  const rows = [flight('f1', 'XY123'), flight('f2', 'XY456'), flight('f3', 'XY789')];
  h = base(rows);
  drawButtons(rows);
  const addField = { focus() { focused = addField; focusLog.push('add'); } };
  ctx.document = { querySelector: () => null, get activeElement() { return focused; },
    querySelectorAll: (sel) => (sel === '[data-flights-stop]' ? buttons : sel === '[data-flights-in]' ? [addField] : []) };
  focused = buttons[1];
  const att = F.stop(h, 'sensor.a', 'f2');
  focused = addField; // the user tabs on to the Add field and types
  if (withEvent) (listeners.focusin || []).forEach((fn) => fn({ type: 'focusin' }));
  focusLog.length = 0;
  await flush(); // the command returns; the list still shows the row
  const rest = [rows[0], rows[2]];
  setList(h, 'sensor.a', rest);
  drawButtons(rest);
  list(h); // the draw that confirms the stop
  fire(); fire();
  assert.equal(F.stopView(h, 'sensor.a').state, 'confirmed', 'the stop settled (withEvent=' + withEvent + ')');
  assert.equal(focused, addField, 'the focus stays in the Add field after the stop settles (withEvent=' + withEvent + ')');
  assert.deepEqual(focusLog, [], 'no Stop button takes the focus (withEvent=' + withEvent + ')');
  assert.equal(att.refocus, false, 'the pending refocus is dropped once the user moved focus (withEvent=' + withEvent + ')');
}
ctx.document = { querySelector: () => null };

// ── Touch: a scroll that starts on a Stop button stops nothing (10 px, as in the sibling modules) ──
h = base([flight('f1', 'XY123')]);
ctx.document = { querySelector: (sel) => (sel === 'home-assistant' ? { hass: h } : null), querySelectorAll: () => [] };
const stopEl = { hasAttribute: (n) => n === 'data-flights-stop', getAttribute: (n) => ({ 'data-flights-src': 'sensor.a', 'data-flights-row': 'f1' })[n] ?? null };
const touch = (type, x, y) => ({ type, cancelable: false, touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }],
  composedPath: () => [stopEl], preventDefault() {}, stopPropagation() {} });
const fireTouch = (ev) => (listeners[ev.type] || []).forEach((fn) => fn(ev));
fireTouch(touch('touchstart', 100, 100));
fireTouch(touch('touchend', 100, 160)); // a 60 px drag
assert.equal(h.calls.length, 0, 'a scroll that starts on Stop stops nothing');
fireTouch(touch('touchstart', 100, 100));
fireTouch(touch('touchend', 103, 104)); // a 3 px tap
assert.equal(h.calls.length, 1, 'a tap on Stop sends once');
ctx.document = { querySelector: () => null };
fire();

// ── Dutch wording: no English loan word in the stop texts ──
const nl = JSON.parse(read('custom_components/casora/translations/dashboard/phrases/nl.json'));
['Mehrere Einträge haben diese Kennung. Es wurde nichts beendet.', 'Dieser Eintrag ist nicht mehr in der Liste.',
  'Für diesen Eintrag gibt es keine Kennung zum Beenden.'].forEach((k) => {
  assert.equal(typeof nl.exact[k], 'string', 'nl has the phrase');
  assert.doesNotMatch(nl.exact[k], /\bitems?\b/i, 'nl: no "item" in "' + k.slice(0, 30) + '"');
});

// Last: the outcome line of a stop stays until the next action, so this block runs after the others.
// ── Scanning switch missing, unavailable or unknown: it cannot be confirmed, so nothing is sent (as with Add) ──
['missing', 'unavailable', 'unknown'].forEach((kind) => {
  h = base([flight('f1', 'XY123')]);
  if (kind === 'missing') delete h.entities['switch.a'];
  else h.states['switch.a'].state = kind;
  const cut = F.stop(h, 'sensor.a', 'f1');
  assert.equal(cut.state, 'noscan', kind + ': its own state');
  assert.equal(h.calls.length, 0, kind + ': no stop command');
  assert.equal(timers.filter((t) => t.live).length, 0, kind + ': no 30 s wait');
  assert.match(list(h), /In FlightRadar24 fehlt, was Casora braucht: der Schalter für die Datenabfrage/, kind + ': the missing part is named');
  fire();
});

console.log('ok flights_stop');
