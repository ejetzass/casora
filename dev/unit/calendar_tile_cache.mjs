// The Agenda tile's pick reads the shared event cache when it is ready, and falls back to the states.
// @deckt: custom_components/casora/scripts/local/06-kalender.js#K.next,loadCache,stamp,K.load,K.repaint
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { loadCalendars } from './lib/calendars_block.mjs';

const read = (p) => fs.readFileSync(new URL(`../../custom_components/casora/scripts/local/${p}`, import.meta.url), 'utf8');

const now = new Date(2054, 10, 13, 10).getTime();
class ClockDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const settle = () => new Promise(resolve => setImmediate(resolve));

// Upstream main's state rule (06-kalender.js K.next on upstream/main), copied as the reference.
const upstreamNext = (states, cals, at) => {
  let best = null;
  cals.forEach(c => {
    const s = states[c.entity], a = s && s.attributes;
    if (!a || !a.message || !a.start_time) return;
    const st = new Date(String(a.start_time).replace(' ', 'T')), en = new Date(String(a.end_time || a.start_time).replace(' ', 'T'));
    if (isNaN(st)) return;
    const ev = { name: a.message, start: st, end: en, allDay: !!a.all_day, on: s.state === 'on', cal: c };
    if (!ev.on && en < at) return;
    if (!best || (ev.on && !best.on) || (ev.on === best.on && st < best.start)) best = ev;
  });
  return best;
};

// One calendar module per case. events: REST list per entity (null: the fetch fails).
function setup({ states, events, settings = {} }) {
  const cals = Object.keys(states).map(entity => ({ entity }));
  const variables = { calendars: cals };
  const hass = { states, callApi: (method, path) => {
    const entity = path.split('?')[0].replace('calendars/', '');
    const list = events[entity];
    if (list === null) return Promise.reject(new Error('fetch failed'));
    return Promise.resolve(list);
  } };
  const ha = { hass, shadowRoot: { querySelectorAll: () => [] } };
  const win = { casoraSettings: () => settings, addEventListener() {} };
  loadCalendars(win);
  const ctx = vm.createContext({ window: win, document: { querySelector: () => ha }, Date: ClockDate, setTimeout: () => 0, console });
  vm.runInContext(read('06a-kalender-filter.js'), ctx);
  vm.runInContext(read('06-kalender.js'), ctx);
  return { calendar: win._casoraCalendar, variables, cals, hass, win };
}

// Calendar REST shape: timed events have start.dateTime, all-day events start.date.
const timed = (summary, start, end) => ({ summary, start: { dateTime: start }, end: { dateTime: end } });
const allDay = (summary, date, endDate) => ({ summary, start: { date }, end: { date: endDate } });

// The tile's first call starts the fetch (the states answer until then); the second reads the cache.
async function warm(env) {
  env.calendar.next(env.hass.states, env.variables);
  await settle();
  return env.calendar.next(env.hass.states, env.variables);
}

// 1. Equality with Upstream's state rule, no filter: the four cases of the ticket.
const equal = [
  {
    name: 'two events running at once in one calendar',
    states: { 'calendar.mock_a': { state: 'on', attributes: { message: 'Termin A', start_time: '2054-11-13 09:00:00', end_time: '2054-11-13 11:00:00', all_day: false } } },
    events: { 'calendar.mock_a': [timed('Termin A', '2054-11-13T09:00:00', '2054-11-13T11:00:00'), timed('Termin B', '2054-11-13T09:30:00', '2054-11-13T12:00:00')] },
  },
  {
    name: "one calendar's fetch failed",
    states: {
      'calendar.mock_a': { state: 'off', attributes: { message: 'Termin A', start_time: '2054-11-13 14:00:00', end_time: '2054-11-13 15:00:00', all_day: false } },
      'calendar.mock_b': { state: 'off', attributes: { message: 'Termin B', start_time: '2054-11-13 12:00:00', end_time: '2054-11-13 13:00:00', all_day: false } },
    },
    events: { 'calendar.mock_a': null, 'calendar.mock_b': [timed('Termin B', '2054-11-13T12:00:00', '2054-11-13T13:00:00')] },
  },
  {
    name: 'an event outside the fetched window',
    states: { 'calendar.mock_c': { state: 'off', attributes: { message: 'Fernes Treffen', start_time: '2055-01-15 14:00:00', end_time: '2055-01-15 15:00:00', all_day: false } } },
    events: { 'calendar.mock_c': [] },
  },
  {
    name: 'no events',
    states: { 'calendar.mock_d': { state: 'off', attributes: {} } },
    events: { 'calendar.mock_d': [] },
  },
];
for (const c of equal) {
  const env = setup({ states: c.states, events: c.events });
  const cached = await warm(env);
  const reference = upstreamNext(c.states, env.cals, new ClockDate());
  assert.equal(cached ? cached.name : null, reference ? reference.name : null, `equal to Upstream's rule: ${c.name}`);
}
console.log('ok tile pick equals Upstream state rule without a filter (4 cases)');

// 2. A filtered running all-day event is skipped; the same calendar's next timed event shows.
{
  const states = { 'calendar.mock_a': { state: 'on', attributes: { message: 'Lunch', start_time: '2054-11-13 00:00:00', end_time: '2054-11-14 00:00:00', all_day: true } } };
  const events = { 'calendar.mock_a': [allDay('Lunch', '2054-11-13', '2054-11-14'), timed('Zahnarzt', '2054-11-13T15:00:00', '2054-11-13T16:00:00')] };
  const env = setup({ states, events, settings: { calendar_filter: 'lunch' } });
  const ev = await warm(env);
  assert.equal(ev ? ev.name : null, 'Zahnarzt', 'a filtered running event is skipped; the next event of the same calendar shows');
  env.calendar.load(env.hass, env.variables);
  await settle();
  assert.ok(env.calendar.html('day', env.variables).includes('Lunch'), 'the calendar popup still lists the filtered event');
}
console.log('ok filtered running event is skipped, the popup keeps it');

// 3. Cache not ready, or the fetch failed: the tile shows the state rule's event.
{
  const states = { 'calendar.mock_a': { state: 'on', attributes: { message: 'Termin A', start_time: '2054-11-13 09:00:00', end_time: '2054-11-13 11:00:00', all_day: false } } };
  const pending = setup({ states, events: { 'calendar.mock_a': null } });
  assert.equal(pending.calendar.next(states, pending.variables)?.name, 'Termin A', 'before the cache is ready: the state rule');
  await settle();
  assert.equal(pending.calendar.next(states, pending.variables)?.name, 'Termin A', 'after a failed fetch: the state rule');
}
console.log('ok cache not ready or failed falls back to the state rule');
