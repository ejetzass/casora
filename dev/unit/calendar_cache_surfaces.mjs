// The greeting line and the day-line screensaver take their next appointment from the shared cache pick.
// @deckt: custom_components/casora/scripts/local/00-finder.js#casoraHomeNext,custom_components/casora/scripts/local/46-screensaver.js#DRAW.linie,S.context,custom_components/casora/scripts/local/06-kalender.js#K.next,K.allowsTitle,loadCache,custom_components/casora/scripts/local/06a-kalender-filter.js#casoraCalendarAllows,casoraFilterAttrsForEvent
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { loadCalendars } from './lib/calendars_block.mjs';

const read = (p) => fs.readFileSync(new URL(`../../custom_components/casora/scripts/local/${p}`, import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

const now = new Date(2054, 10, 13, 10).getTime();
class ClockDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}

// The state shows the later appointment; the API knows a running one (HA shows one event per calendar).
const states = {
  'calendar.mock_a': { state: 'off', attributes: { message: 'Termin Spaet', start_time: '2054-11-13 16:00:00', end_time: '2054-11-13 17:00:00', all_day: false } },
};
const events = { 'calendar.mock_a': [
  { summary: 'Termin Jetzt', start: { dateTime: '2054-11-13T09:30:00' }, end: { dateTime: '2054-11-13T12:00:00' } },
  { summary: 'Termin Spaet', start: { dateTime: '2054-11-13T16:00:00' }, end: { dateTime: '2054-11-13T17:00:00' } },
] };
const hass = { states, callApi: (method, path) => Promise.resolve(events[path.split('?')[0].replace('calendars/', '')] || []) };
const ha = { hass, shadowRoot: { querySelectorAll: () => [] } };

const win = { casoraSettings: () => ({}), addEventListener() {} };
loadCalendars(win);
const ctx = vm.createContext({ window: win, document: { querySelector: () => ha }, Date: ClockDate, setTimeout: () => 0, console });
vm.runInContext(read('06a-kalender-filter.js'), ctx);
vm.runInContext(read('06-kalender.js'), ctx);
const finder = fs.readFileSync(new URL('../../custom_components/casora/scripts/local/00-finder.js', import.meta.url), 'utf8');
vm.runInContext(finder.slice(finder.indexOf('// casora-home-next:start'), finder.indexOf('// casora-home-next:end')), ctx);
vm.runInContext(read('46-screensaver.js'), ctx);

// Warm the shared cache (the first read starts the fetch), then ask the greeting and the screensaver.
win._casoraCalendar.next(states, { calendars: [{ entity: 'calendar.mock_a' }] });
await settle();

// 1. Greeting line: the cache pick (a running event wins).
assert.equal(win.casoraHomeNext({ states }, { casora_greeting_next: true }, new ClockDate()), 'Jetzt Termin Jetzt', 'the greeting shows the cache pick');
console.log('ok greeting line takes the cache pick');

// 2. Day-line screensaver: the next appointment at the top is the cache pick.
const saver = win._casoraSaver;
const view = saver.context({ kind: 'linie', now: new ClockDate(), hass, events: [], settings: {}, rooms: [], sun: null, wx: null, daily: [], hourly: [], bins: [], media: null, cams: [] });
const html = saver.html('linie', view);
assert.ok(html.includes('Termin Jetzt'), 'the day line shows the cache pick at the top');
console.log('ok day-line screensaver takes the cache pick');

// 3. Day-line screensaver: an all-day tile pick does not hide the timed appointments the day line found itself.
// The tile's pick is the ongoing all-day event; the day line only shows timed events, so it keeps its own choice.
const allDayStates = {
  'calendar.mock_b': { state: 'on', attributes: { message: 'Tag Frei', start_time: '2054-11-13 00:00:00', end_time: '2054-11-14 00:00:00', all_day: true } },
};
events['calendar.mock_b'] = [
  { summary: 'Tag Frei', start: { date: '2054-11-13' }, end: { date: '2054-11-14' } },
  { summary: 'Termin Laeuft', start: { dateTime: '2054-11-13T09:30:00' }, end: { dateTime: '2054-11-13T11:00:00' } },
  { summary: 'Termin Danach', start: { dateTime: '2054-11-13T13:30:00' }, end: { dateTime: '2054-11-13T14:30:00' } },
];
const allDayHass = { states: allDayStates, callApi: hass.callApi };
const allDayCal = { calendars: [{ entity: 'calendar.mock_b' }] };
win._casoraCalendar.next(allDayStates, allDayCal);
await settle();
assert.equal(win._casoraCalendar.next(allDayStates, allDayCal, null, now).allDay, true, 'precondition: the tile picks the all-day event');
const at = (h, m) => new Date(2054, 10, 13, h, m).getTime();
const lineEvents = [
  { title: 'Tag Frei', start: at(0, 0), end: at(24, 0), allDay: true, cal: 'calendar.mock_b' },
  { title: 'Termin Laeuft', start: at(9, 30), end: at(11, 0), allDay: false, cal: 'calendar.mock_b' },
  { title: 'Termin Danach', start: at(13, 30), end: at(14, 30), allDay: false, cal: 'calendar.mock_b' },
];
const lineCal = { hass: allDayHass, cals: ['calendar.mock_b'] };
const running = saver.dayLine(lineEvents, now, lineCal);
assert.equal(running.running && running.running.title, 'Termin Laeuft', 'the running timed appointment leads, not nothing');
const allDayHtml = saver.html('linie', saver.context({ kind: 'linie', now: new ClockDate(), hass: allDayHass, cals: ['calendar.mock_b'], events: lineEvents, settings: {}, rooms: [], sun: null, wx: null, daily: [], hourly: [], bins: [], media: null, cams: [] }));
assert.ok(allDayHtml.includes('Termin Laeuft') && !allDayHtml.includes('Heute nichts mehr'), 'the headline names the running appointment');
const later = saver.dayLine(lineEvents, at(11, 15), lineCal);
assert.equal(later.next && later.next.title, 'Termin Danach', 'between appointments the next timed one leads');
console.log('ok day-line screensaver keeps its timed choice when the tile picks an all-day event');

// 4. Exported decisions reach the greeting's pick through the cache: a no-match decision keeps the event,
// a recorded match hides it. The state carries no message, so only the uid decision can apply.
{
  const greet = async (matches) => {
    const st = { 'calendar.mock_b': { state: 'off', attributes: { casora_filter_match: {
      entries: ['lunch'], events: { 'uid-1': { title: 'Lunch Termin', matches } } } } } };
    const h = { states: st, callApi: (m, path) => Promise.resolve(path.includes('mock_b') ? [
      { summary: 'Lunch Termin', uid: 'uid-1', start: { dateTime: '2054-11-13T15:00:00' }, end: { dateTime: '2054-11-13T16:00:00' } }] : []) };
    const w = { casoraSettings: () => ({ calendar_filter: 'lunch' }), addEventListener() {} };
    loadCalendars(w);
    const c = vm.createContext({ window: w, document: { querySelector: () => ({ hass: h, shadowRoot: { querySelectorAll: () => [] } }) },
      Date: ClockDate, setTimeout: () => 0, console });
    vm.runInContext(read('06a-kalender-filter.js'), c);
    vm.runInContext(read('06-kalender.js'), c);
    vm.runInContext(finder.slice(finder.indexOf('// casora-home-next:start'), finder.indexOf('// casora-home-next:end')), c);
    const cals = [{ entity: 'calendar.mock_b' }];
    w._casoraCalendar.next(st, { calendars: cals });
    await settle();
    return w.casoraHomeNext({ states: st }, { casora_greeting_next: true }, new ClockDate());
  };
  assert.equal(await greet([]), 'Heute 15:00 Lunch Termin', 'a recorded no-match decision keeps the cache event in the greeting');
  assert.equal(await greet(['lunch']), '', 'a recorded match decision hides the cache event from the greeting');
}
console.log('ok greeting takes exported decisions on cache events');
