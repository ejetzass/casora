// Timed first: the Agenda tile shows a running timed event, then the next timed event today, then a running
// all-day event, then the next event. Off (default, or a plain text filter): the order of Upstream's state rule.
// @deckt: custom_components/casora/scripts/local/06-kalender.js#K.next,K.tile
// @deckt: custom_components/casora/scripts/local/06a-kalender-filter.js#casoraCalendarTimedFirst
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { loadCalendars } from './lib/calendars_block.mjs';
import { loadDayWordIn } from './lib/day_word.mjs';

const read = (p) => fs.readFileSync(new URL(`../../custom_components/casora/scripts/local/${p}`, import.meta.url), 'utf8');

// Mock clock: 13 Nov 2054, 10:00 local time.
const now = new Date(2054, 10, 13, 10).getTime();
class ClockDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}

// One calendar module with the given saved settings. The tile reads the settings through window.casoraSettings.
function setup({ states, settings }) {
  const cals = Object.keys(states).map(entity => ({ entity }));
  const variables = { calendars: cals };
  const hass = { states, callApi: () => Promise.reject(new Error('no fetch in this test')) };
  const ha = { hass, shadowRoot: { querySelectorAll: () => [] } };
  const win = { casoraSettings: () => settings, addEventListener() {} };
  loadCalendars(win);
  const ctx = vm.createContext({ window: win, document: { querySelector: () => ha }, Date: ClockDate, setTimeout: () => 0, console });
  loadDayWordIn(ctx);
  vm.runInContext(read('06a-kalender-filter.js'), ctx);
  vm.runInContext(read('06-kalender.js'), ctx);
  return { calendar: win._casoraCalendar, variables, states, win };
}

const state = (on, message, start, end, allDay) => ({ state: on ? 'on' : 'off', attributes: { message, start_time: start, end_time: end, all_day: allDay } });
const ganztag = state(true, 'Ganztag', '2054-11-13 00:00:00', '2054-11-14 00:00:00', true);
const besprechung = state(true, 'Besprechung', '2054-11-13 09:00:00', '2054-11-13 11:00:00', false);
const zahnarzt = state(false, 'Zahnarzt', '2054-11-13 15:00:00', '2054-11-13 16:00:00', false);
const morgen = state(false, 'Morgen', '2054-11-14 09:00:00', '2054-11-14 10:00:00', false);
const onSettings = { calendar_filter: { timed_first: true } };
const offSettings = { calendar_filter: { timed_first: false } };

// 1. A running timed event beats a running all-day event (timed first on), not with it off.
{
  const states = { 'calendar.mock_a': ganztag, 'calendar.mock_b': besprechung };
  assert.equal(setup({ states, settings: onSettings }).calendar.tile(states, { calendars: [{ entity: 'calendar.mock_a' }, { entity: 'calendar.mock_b' }] }), 'Jetzt · Besprechung');
  assert.equal(setup({ states, settings: offSettings }).calendar.tile(states, { calendars: [{ entity: 'calendar.mock_a' }, { entity: 'calendar.mock_b' }] }), 'Heute · Ganztag');
}
console.log('ok running timed event first when on; off keeps the running all-day event');

// 2. A timed event later today beats a running all-day event (on); off keeps the all-day event.
{
  const states = { 'calendar.mock_a': ganztag, 'calendar.mock_b': zahnarzt };
  const variables = { calendars: [{ entity: 'calendar.mock_a' }, { entity: 'calendar.mock_b' }] };
  assert.equal(setup({ states, settings: onSettings }).calendar.tile(states, variables), 'Heute 15:00 · Zahnarzt');
  assert.equal(setup({ states, settings: offSettings }).calendar.tile(states, variables), 'Heute · Ganztag');
}
console.log('ok timed event later today beats a running all-day event when on');

// 3. A running all-day event beats the next event tomorrow (on): the rest of the order is unchanged.
{
  const states = { 'calendar.mock_a': ganztag, 'calendar.mock_b': morgen };
  const variables = { calendars: [{ entity: 'calendar.mock_a' }, { entity: 'calendar.mock_b' }] };
  assert.equal(setup({ states, settings: onSettings }).calendar.tile(states, variables), 'Heute · Ganztag');
}
console.log('ok running all-day event stays ahead of the next event tomorrow');

// 4. A plain text filter (the old string form) keeps timed first off.
{
  const states = { 'calendar.mock_a': ganztag, 'calendar.mock_b': zahnarzt };
  const variables = { calendars: [{ entity: 'calendar.mock_a' }, { entity: 'calendar.mock_b' }] };
  assert.equal(setup({ states, settings: { calendar_filter: 'Mittagessen' } }).calendar.tile(states, variables), 'Heute · Ganztag');
}
console.log('ok a text-only filter means timed first off');

// 5. The tile reads the saved settings only: a draft that was not saved changes nothing; saving applies it.
{
  const states = { 'calendar.mock_a': ganztag, 'calendar.mock_b': zahnarzt };
  const variables = { calendars: [{ entity: 'calendar.mock_a' }, { entity: 'calendar.mock_b' }] };
  const env = setup({ states, settings: offSettings });
  const draft = { calendar_filter: { timed_first: true } };
  assert.equal(env.calendar.tile(states, variables), 'Heute · Ganztag', 'draft on, not saved: tile unchanged');
  env.win.casoraSettings = () => draft;
  assert.equal(env.calendar.tile(states, variables), 'Heute 15:00 · Zahnarzt', 'saved on: tile shows the timed event');
}
console.log('ok the tile follows the saved setting only');
