// Integrated Studio preview: state-message metadata uses the same decision as the shared rule.
// @deckt: custom_components/casora/panel/casora-panel.js#_paintTile,tileStateWord,custom_components/casora/scripts/local/06a-kalender-filter.js#casoraCalendarAllows
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { loadPanel } from './lib/testhaus.mjs';

const { P } = await loadPanel();
const element = () => {
  const children = {};
  return { dataset: {}, classList: { add() {}, toggle() {} }, style: { setProperty() {} },
    appendChild() {}, setAttribute() {}, querySelector: s => children[s] || (children[s] = element()) };
};
globalThis.document = { createElement: element };
globalThis.casoraDevice = { waste: () => ({ calendar: null }) };
globalThis.casoraI18n = { t: s => s === 'No events' ? 'Keine Termine' : s };
delete globalThis.casoraCalendarAllows;
new Function(fs.readFileSync(new URL('../../custom_components/casora/scripts/local/06a-kalender-filter.js', import.meta.url), 'utf8'))();
const allows = globalThis.casoraCalendarAllows;
const calls = [];
globalThis.casoraCalendarAllows = (...args) => { calls.push(args); return allows(...args); };

const id = 'calendar.mock';
const states = { [id]: { attributes: { message: 'Termin-cccccc', casora_filter_match: {
  entries: ['Termin-aaaaaa'], message: { title: 'Termin-cccccc', matches: ['Termin-aaaaaa'] },
} } } };
const draft = { calendar_filter: 'Termin-aaaaaa', calendars: [{ entity: id }] };
const panel = Object.create(P);
panel._hass = { states };
panel._cs = { S: draft };
panel._tileEnt = () => null;
panel._tileKey = () => 'calendar';
panel._inactiveIconColor = () => '';
panel._smartSortOn = () => false;
const tile = { template: 'casora_calendar', variables: {} };
const preview = () => panel._paintTile(tile, 0, { tiles: [tile] }).querySelector('.mstate').textContent;

assert.equal(preview(), 'Keine Termine', 'positive exported match hides a differently coded message');
assert.equal(calls.length, 1);
assert.deepEqual(calls[0], ['Termin-cccccc', draft, states, id], 'preview passes the draft and message context');
states[id].attributes.message = 'Termin-aaaaaa';
states[id].attributes.casora_filter_match.message = { title: 'Termin-aaaaaa', matches: [] };
assert.equal(preview(), 'Termin-aaaaaa', 'negative exported match overrides an accidental coded substring');
assert.deepEqual(calls[1], ['Termin-aaaaaa', draft, states, id]);
console.log('ok integrated Studio calendar message metadata');
