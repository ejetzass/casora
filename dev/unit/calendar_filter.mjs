// Calendar filter: one title rule for the Agenda tile, the greeting, the screensavers and the Studio preview.
// The tile's pick is Upstream's rule (one event per calendar from the calendar states, a running event wins,
// then the earliest start); the filter only skips titles.
// @deckt: custom_components/casora/scripts/local/00-finder.js#casoraHomeNext,custom_components/casora/scripts/local/46-screensaver.js#S.context,custom_components/casora/scripts/local/06-kalender.js#K.next,custom_components/casora/scripts/local/06a-kalender-filter.js#casoraCalendarNext,custom_components/casora/scripts/local/46-screensaver.js#S.events,custom_components/casora/scripts/local/06a-kalender-filter.js#casoraFilterAttrsForEvent,custom_components/casora/scripts/local/06a-kalender-filter.js#casoraCalendarTimedFirst,custom_components/casora/scripts/local/06a-kalender-filter.js#casoraCalendarAllows,custom_components/casora/panel/casora-panel-settings.js#_csSaverPreview
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { loadCalendars } from './lib/calendars_block.mjs';

const read = (p) => fs.readFileSync(new URL(`../../custom_components/casora/scripts/local/${p}`, import.meta.url), 'utf8');

let settings = {};
const now = new Date(2054, 10, 13, 10).getTime();
class ClockDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const window = { casoraSettings: () => settings, addEventListener() {} };
loadCalendars(window);
const context = vm.createContext({ window, document: { querySelector: () => null }, setTimeout: () => 0, console, Date: ClockDate });
vm.runInContext(read('06a-kalender-filter.js'), context);
vm.runInContext(read('06-kalender.js'), context);
const calendar = window._casoraCalendar;

// ── Title rule ────────────────────────────────────────────────────────────────
assert.equal(window.casoraCalendarAllows('Termin-bbbbbb ffffff'), true, 'empty settings hide nothing');
assert.equal(window.casoraCalendarAllows('Termin-bbbbbb ffffff', { calendar_filter: 'Termin-bbbbbb ffffff' }), false, 'the entry hides an identical title');
assert.equal(window.casoraCalendarAllows('termin-bbbbbb ffffff (a)', { calendar_filter: 'Termin-bbbbbb ffffff' }), false, 'matching ignores case and keeps fragments');
assert.equal(window.casoraCalendarAllows('Vrijdagmarkt', { calendar_filter: 'Termin-bbbbbb ffffff' }), true, 'a word inside an entry is no separate filter');
assert.equal(window.casoraCalendarAllows('Concert', { calendar_filter: 'a, , b' }), true, 'empty comma entries hide nothing');
assert.equal(window.casoraCalendarAllows('Ballet', { calendar_filter: 'a, , b' }), false, 'each comma entry matches on its own');
console.log('ok calendar filter title rule');

// ── Exported decisions (casora_filter_match) ──────────────────────────────────
const decisions = { entries: ['Termin-aaaaaa', 'Termin-bbbbbb'], events: {
  'Termin-111111': { title: 'Termin-cccccc', matches: ['Termin-aaaaaa'] },
  'Termin-222222': { title: 'Termin-aaaaaa', matches: [] } } };
const codedAttrs = { casora_filter_match: { ...decisions, message: { title: 'Termin-cccccc', matches: ['Termin-aaaaaa'] } } };
settings = { calendar_filter: 'Termin-aaaaaa' };
assert.equal(window.casoraCalendarAllows('Termin-cccccc', null, codedAttrs, 'Termin-111111'), false, 'an exported event decision hides the coded event');
assert.equal(window.casoraCalendarAllows('Termin-aaaaaa', null, codedAttrs, 'Termin-222222'), true, 'a known negative overrides an accidental substring');
assert.equal(window.casoraCalendarAllows('Termin-aaaaaa', null, codedAttrs, 'new-event'), false, 'new events use normal matching');
assert.equal(window.casoraCalendarAllows('Termin-aaaaaa', null, codedAttrs, 'Termin-111111'), false, 'an edited title uses normal matching');
assert.equal(window.casoraCalendarAllows('Termin-cccccc', null, codedAttrs), false, 'the state message decision hides its title');
settings = { calendar_filter: '' };
assert.equal(window.casoraCalendarAllows('Termin-cccccc', null, codedAttrs, 'Termin-111111'), true, 'removing an exported entry stops hiding its event');
settings = { calendar_filter: 'cccc' };
assert.equal(window.casoraCalendarAllows('Termin-cccccc', null, codedAttrs, 'Termin-111111'), false, 'a changed entry uses ordinary substring matching');
settings = { calendar_filter: 'other' };
assert.equal(window.casoraCalendarAllows('Termin-cccccc', null, codedAttrs, 'Termin-111111'), true, 'an unrelated changed entry does not reuse an old decision');
settings = {};

// Contract gaps: a uid without its own decision, title-less decisions, and entries the export did not know.
settings = { calendar_filter: 'foo' };
const messageOnly = { casora_filter_match: { entries: ['foo'], message: { matches: [] } } };
assert.equal(window.casoraCalendarAllows('foo bar', null, messageOnly, 'u1'), true,
  'a uid missing from the events map takes the message decision (as the state message, like uid null)');
assert.equal(window.casoraCalendarAllows('foo bar', null, messageOnly), true, 'the same with no uid');
assert.equal(window.casoraCalendarAllows('zzz', null, { casora_filter_match: { events: { u1: { matches: ['foo'] } } } }, 'u1'), true,
  'a title-less event decision does not hide an edited title');
settings = { calendar_filter: 't' };
assert.equal(window.casoraCalendarAllows('t', null, { casora_filter_match: { message: { title: 't', matches: ['foo'] } } }), false,
  'without the export list, a decision speaks only for the entries it names; a new entry uses normal matching');
settings = {};
console.log('ok calendar filter contract gaps');
console.log('ok exported calendar filter decisions');

// ── Section form (Studio: calendar_filter = { words, timed_first }) ─────────
// The decision and the entry list come from the section's words; the plain text form still works.
{
  const sectionAttrs = { casora_filter_match: { entries: ['foo'], events: {
    'Termin-333333': { title: 'Termin-dddddd', matches: ['foo'] } }, message: { title: 'Termin-eeeeee', matches: [] } } };
  assert.equal(window.casoraCalendarAllows('Termin-dddddd', { calendar_filter: { words: 'foo', timed_first: true } }, sectionAttrs, 'Termin-333333'), false,
    'a section with words applies the recorded uid decision');
  assert.equal(window.casoraCalendarAllows('Termin-dddddd', { calendar_filter: 'foo' }, sectionAttrs, 'Termin-333333'), false,
    'the plain text form still applies the recorded uid decision');
  assert.equal(window.casoraCalendarAllows('Termin-dddddd', { calendar_filter: { words: 'bar', timed_first: true } }, sectionAttrs, 'Termin-333333'), true,
    'a section entry the export did not know uses the text match');
  assert.equal(window.casoraCalendarAllows('Termin-dddddd', { calendar_filter: { timed_first: true } }, sectionAttrs, 'Termin-333333'), true,
    'a section without words hides nothing');
  console.log('ok calendar filter section form');
}

// ── Agenda tile: Upstream's pick, the filter skips titles ─────────────────────
const states = {
  'calendar.mock_day': { state: 'on', attributes: { message: 'Termin-bbbbbb ffffff', start_time: '2054-11-13 00:00:00', end_time: '2054-11-14 00:00:00', all_day: true } },
  'calendar.mock_meeting': { state: 'off', attributes: { message: 'Termin-gggggg', start_time: '2054-11-13 14:00:00', end_time: '2054-11-13 15:00:00', all_day: false } },
};
const variables = { calendars: Object.keys(states).map(entity => ({ entity })) };

settings = {};
assert.equal(calendar.tile(states, variables), 'Heute · Termin-bbbbbb ffffff', 'empty filter: the running all-day event wins, as on Upstream main');
settings = { calendar_filter: 'Termin-bbbbbb ffffff' };
assert.equal(calendar.tile(states, variables), 'Heute 14:00 · Termin-gggggg', 'a filtered running event leaves its calendar out of the pick');
settings = { calendar_filter: 'Termin-gggggg' };
assert.equal(calendar.tile(states, variables), 'Heute · Termin-bbbbbb ffffff', 'a filtered timed event never shows');
settings = { calendar_filter: 'Termin-gggggg, Termin-bbbbbb ffffff' };
assert.equal(calendar.tile(states, variables), 'Keine Termine', 'every title filtered: no event left');
console.log('ok Agenda tile pick with the filter');

// A calendar that casoraCalendars leaves out reaches no tile pick.
settings = {};
assert.equal(calendar.tile(states, { calendars: [{ entity: 'calendar.mock_meeting' }] }), 'Heute 14:00 · Termin-gggggg', 'only the calendars casoraCalendars gives count');
assert.equal(calendar.tile(states, { calendars: [{ entity: 'calendar.mock_day' }] }), 'Heute · Termin-bbbbbb ffffff', 'a calendar left out by casoraCalendars is not picked');
console.log('ok Agenda tile uses casoraCalendars');

// ── Greeting line ─────────────────────────────────────────────────────────────
settings = { calendar_filter: 'Termin-bbbbbb ffffff' };
const finder = fs.readFileSync(new URL('../../custom_components/casora/scripts/local/00-finder.js', import.meta.url), 'utf8');
vm.runInContext(finder.slice(finder.indexOf('// casora-home-next:start'), finder.indexOf('// casora-home-next:end')), context);
assert.equal(window.casoraHomeNext({ states }, { casora_greeting_next: true }, new ClockDate()), 'Heute 14:00 Termin-gggggg', 'the greeting excludes the filtered title');
console.log('ok greeting line uses the filter');

// ── Screensavers ──────────────────────────────────────────────────────────────
vm.runInContext(read('46-screensaver.js'), context);
const saver = window._casoraSaver;
const events = [
  { title: 'Termin-bbbbbb ffffff', start: now - 10 * 3600000, end: now + 14 * 3600000, allDay: true },
  { title: 'Termin-gggggg', start: now + 4 * 3600000, end: now + 5 * 3600000, allDay: false },
];
for (const kind of ['linie', 'woche', 'kalender']) {
  const view = saver.context({ kind, now: new ClockDate(), hass: { states: {} }, events, settings, rooms: [], sun: null, wx: null, daily: [], hourly: [], bins: [] });
  const html = saver.html(kind, view);
  assert.ok(!html.includes('Termin-bbbbbb ffffff') && html.includes('Termin-gggggg'), `${kind} applies the shared Calendar filter`);
}

// Recorded mock decisions apply only to the exact calendar event they describe.
{
  const start = now - 3600000, end = now + 3600000;
  const stateTime = (n) => {
    const d = new Date(n);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
      + ' ' + [d.getHours(), d.getMinutes(), d.getSeconds()].map((v) => String(v).padStart(2, '0')).join(':');
  };
  const replayStates = {
    'calendar.mock': { state: 'on', attributes: {
      message: 'opaque replay title', start_time: stateTime(start), end_time: stateTime(end), all_day: false,
      casora_filter_match: { message: { matches: ['private entry'] } },
    } },
  };
  const replayEvents = [
    { title: 'opaque replay title', start, end, allDay: false, cal: 'calendar.mock' },
    { title: 'opaque replay title', start: end + 3600000, end: end + 7200000, allDay: false, cal: 'calendar.mock' },
  ];
  const view = saver.context({ kind: 'woche', now: new ClockDate(), hass: { states: replayStates }, events: replayEvents,
    settings: { calendar_filter: 'private entry' }, rooms: [], sun: null, wx: null, daily: [], hourly: [], bins: [] });
  assert.deepEqual(view.events.map((e) => e.start), [end + 3600000],
    'the replay decision hides its matching occurrence but not another occurrence in the same calendar');
}
console.log('ok screensavers apply the filter');
console.log('ok screensaver replay decisions stay with their matching event');

// The calendar popup is intentionally outside the title filter.
{
  calendar.ev = [
    { name: 'Termin-bbbbbb ffffff', start: new ClockDate(), end: new ClockDate(+new ClockDate() + 3600000), allDay: false, cal: 'calendar.mock_day' },
    { name: 'Termin-gggggg', start: new ClockDate(+new ClockDate() + 7200000), end: new ClockDate(+new ClockDate() + 10800000), allDay: false, cal: 'calendar.mock_meeting' },
  ];
  const popup = calendar.html('day', { calendars: [] });
  assert.ok(popup.includes('Termin-bbbbbb ffffff') && popup.includes('Termin-gggggg'),
    'the popup continues to list a title hidden by the Calendar filter');
}
console.log('ok calendar popup remains unfiltered');

// The tile renders safely during the brief startup gap before its shared rule loads.
{
  const isolatedWindow = { casoraSettings: () => settings, addEventListener() {} };
  const isolatedContext = vm.createContext({ window: isolatedWindow, document: { querySelector: () => null }, setTimeout: () => 0, console, Date: ClockDate });
  vm.runInContext(read('06-kalender.js'), isolatedContext);
  assert.equal(isolatedWindow._casoraCalendar.tile(states, variables), 'Keine Termine',
    'a missing shared rule does not throw during startup');
}
console.log('ok calendar tile tolerates a missing startup rule');

const settle = () => new Promise(resolve => setImmediate(resolve));

// Exercise the Studio's real lazy loader in a fresh window, without dashboard scripts. The real Studio has
// window.casoraSettings (from 00-finder.js), but it returns {}: the settings page never sets CASORA_SETTINGS on load.
// The preview takes the filter from the settings page's draft, as the kind chips take theirs.
{
  class PreviewPanel {}
  const previewWindow = { casoraSettings: () => ({}),
    casoraTr: () => '', casoraEnergyPrefs: {}, addEventListener() {} };
  // Any DOM call the Studio makes returns a stub; only the calls the test reads are real.
  const node = () => new Proxy(function () {}, {
    get: (target, key) => (key in target ? target[key] : (target[key] = key === 'isConnected' ? false : node())),
    set: (target, key, value) => { target[key] = value; return true; },
    apply: () => node(),
  });
  const previewDocument = { createElement: node, querySelector: () => null };
  const previewContext = vm.createContext({ window: previewWindow, document: previewDocument,
    customElements: { whenDefined: () => Promise.resolve(), get: () => PreviewPanel },
    setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, console, Date: ClockDate });
  const loaded = [];
  previewWindow.casoraImportScript = async path => {
    loaded.push(path);
    vm.runInContext(fs.readFileSync(new URL('../../custom_components/casora/scripts/' + path, import.meta.url), 'utf8'), previewContext);
  };
  vm.runInContext(fs.readFileSync(new URL('../../custom_components/casora/panel/casora-panel-settings.js', import.meta.url), 'utf8'), previewContext);
  await settle();
  const studio = new PreviewPanel();
  studio._cs = { S: { calendar_filter: 'Termin-aaaaaa' } };
  studio._csSaverPreview({ insertBefore() {} }, {});
  await settle();
  // Once the scripts are loaded the Studio draws the preview: capture the options it hands to the module.
  let studioMount = null;
  previewWindow._casoraSaver.KINDS = [];
  previewWindow._casoraSaver.mount = (host, kind, o) => { studioMount = o; return { update() {}, destroy() {} }; };
  studio._csSaverPreview({ insertBefore() {} }, {});
  assert.ok(studioMount, 'the Studio mounts the screensaver preview');
  assert.ok(!loaded.includes('local/06-kalender.js'), 'the Studio preview does not load the whole Calendar module');
  assert.equal(previewWindow._casoraCalendar, undefined, 'the Studio gets no calendar tile helpers from the preview');
  assert.equal(previewWindow.casoraClimateActive, undefined, 'the Studio keeps its own thermostat words');
  const coded = { 'calendar.mock_wire': { attributes: { casora_filter_match: {
    entries: ['Termin-aaaaaa'], events: { 'Termin-111111': { title: 'Termin-cccccc', matches: ['Termin-aaaaaa'] } }
  } } } };
  const codedEvents = [
    { title: 'Termin-cccccc', uid: 'Termin-111111', cal: 'calendar.mock_wire', start: now, end: now + 3600000 },
    { title: 'Visible', uid: 'other', cal: 'calendar.mock_wire', start: now, end: now + 3600000 },
  ];
  const view = previewWindow._casoraSaver.context(Object.assign({}, studioMount.context(), { kind: 'linie', now: new ClockDate(),
    hass: { states: coded }, events: codedEvents, rooms: [], sun: null, wx: null, daily: [], hourly: [], bins: [] }));
  assert.deepEqual(Array.from(view.events, event => event.title), ['Visible'], 'Studio preview applies the saved Calendar filter from the settings draft');
  console.log('ok Studio preview lazy-loads the Calendar filter');
}
