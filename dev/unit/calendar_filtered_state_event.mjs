// A filtered event in the calendar state must not blank the Agenda tile; the cache's later event shows.
// @deckt: custom_components/casora/scripts/local/06-kalender.js#K.next,K.tile,custom_components/casora/scripts/local/06a-kalender-filter.js#casoraCalendarNext,casoraCalendarAllows
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

// One calendar. The state shows the filtered event 'Mock Noise'; the REST list also has the later 'Mock Dentist'.
const states = { 'calendar.mock_a': { state: 'off', attributes: {
  message: 'Mock Noise', start_time: '2054-11-13 11:00:00', end_time: '2054-11-13 11:30:00', all_day: false } } };
const events = { 'calendar.mock_a': [
  { summary: 'Mock Noise', start: { dateTime: '2054-11-13T11:00:00' }, end: { dateTime: '2054-11-13T11:30:00' } },
  { summary: 'Mock Dentist', start: { dateTime: '2054-11-13T14:00:00' }, end: { dateTime: '2054-11-13T15:00:00' } },
] };

// One calendar module per case, with the given filter word.
function tileFor(filter) {
  const variables = { calendars: [{ entity: 'calendar.mock_a' }] };
  const hass = { states, callApi: (method, path) => {
    const entity = path.split('?')[0].replace('calendars/', '');
    return Promise.resolve(events[entity]);
  } };
  const ha = { hass, shadowRoot: { querySelectorAll: () => [] } };
  const win = { casoraSettings: () => ({ calendar_filter: filter }), addEventListener() {} };
  loadCalendars(win);
  const ctx = vm.createContext({ window: win, document: { querySelector: () => ha }, Date: ClockDate, setTimeout: () => 0, console });
  vm.runInContext(read('06a-kalender-filter.js'), ctx);
  vm.runInContext(read('06-kalender.js'), ctx);
  return { calendar: win._casoraCalendar, variables };
}

// The tile's first call starts the fetch (the states answer until then); the second reads the cache.
async function warmTile(env) {
  env.calendar.tile(states, env.variables);
  await settle();
  return env.calendar.tile(states, env.variables);
}

// 1. The filter hides 'Mock Noise' in the state: the tile shows the later event, not 'Keine Termine'.
{
  const text = await warmTile(tileFor('Mock Noise'));
  assert.equal(text, 'Heute 14:00 · Mock Dentist', 'filtered state event does not blank the tile');
}

// 2. No filter: the state's event is the first one and shows.
{
  const text = await warmTile(tileFor(''));
  assert.equal(text, 'Heute 11:00 · Mock Noise', 'without a filter the earlier event shows');
}
console.log('ok filtered state event does not blank the Agenda tile (2 cases)');
