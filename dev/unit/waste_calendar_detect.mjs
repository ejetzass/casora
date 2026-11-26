// Waste calendar detected by content: 3+ fetched events and more than half match a Bin type, whatever the
// integration or language. Detection only leaves the calendar out of the greeting line.
//   node dev/unit/waste_calendar_detect.mjs
// @deckt: custom_components/casora/scripts/local/00-finder.js#casoraWasteContent,casoraWasteJudge,casoraCalSpan,casoraHomeNext,casoraWasteCalendar custom_components/casora/scripts/local/06-kalender.js#load
import fs from 'node:fs';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.document = { querySelector: () => null };
globalThis.addEventListener = () => {};
globalThis.setTimeout = () => 0;
globalThis.customElements = { get: () => null, define() {}, whenDefined: () => new Promise(() => {}) };
const read = (f) => fs.readFileSync(new URL('../../custom_components/casora/scripts/local/' + f, import.meta.url), 'utf8');
new Function(read('00-finder.js'))();
new Function(read('06-kalender.js'))();
const K = window._casoraCalendar;
const flush = () => new Promise((r) => setImmediate(r));

// The rule on titles (ready-made Bin types, Dutch and German words).
const rule = window.casoraWasteContent;
assert.equal(rule(['GFT', 'PMD', 'Restafval']), true, '3 of 3 match');
assert.equal(rule(['GFT', 'PMD', 'Restafval', 'Tandarts']), true, '3 of 4: a majority');
assert.equal(rule(['GFT', 'PMD']), false, 'only 2 events: too few');
assert.equal(rule(['GFT', 'PMD', 'Tandarts', 'Verjaardag']), false, 'exactly 50% is no majority');
assert.equal(rule(['GFT', 'Tandarts', 'Verjaardag']), false, 'a minority');
assert.equal(rule([]), false, 'no events');

// A Dutch ICS calendar, no waste integration: appointments first, a Waste calendar after the fetch.
const ID = 'calendar.bins_nl', soon = new Date(); soon.setDate(soon.getDate() + 1);
const stamp = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' 00:00:00';
const hass = {
  states: { [ID]: { state: 'off', attributes: { friendly_name: 'Bins NL', message: 'GFT', start_time: stamp(soon), all_day: true } } },
  entities: { [ID]: { platform: 'ics' } }, devices: {}, locale: { language: 'nl' },
};
let titles = [], urls = [];
hass.callApi = (m, path) => { urls.push(path); return Promise.resolve(titles.map((t, i) => ({ summary: t, start: { date: '2026-12-0' + (i + 1) }, end: { date: '2026-12-0' + (i + 2) } }))); };
window.casoraDevice = { waste: () => ({ bins: [] }) };
document.querySelector = (q) => (q === 'home-assistant' ? { hass } : null);
const line = () => window.casoraHomeNext(hass, { casora_greeting_next: true }, new Date());

assert.match(line(), /GFT/, 'before the first fetch the calendar counts as appointments');
await flush(); // the greeting's own fetch (empty list) ends first
titles = ['GFT', 'PMD', 'Restafval'];
await K.load(hass, {}, true); await flush();
assert.equal(window._casoraWasteCals[ID], true, 'the verdict is kept per calendar');
assert.equal(line(), '', 'detected: left out of the greeting line, with no bins from the waste part');
titles = ['GFT', 'PMD'];
await K.load(hass, {}, true); await flush();
assert.match(line(), /GFT/, '2 events: appointments again (refreshed with the fetch)');
titles = ['GFT', 'PMD', 'Tandarts', 'Verjaardag'];
await K.load(hass, {}, true); await flush();
assert.match(line(), /GFT/, 'exactly 50%: appointments');

// Browsing the popup to another month (an empty one) does not change the verdict: only the default window judges.
titles = ['GFT', 'PMD', 'Restafval'];
await K.load(hass, {}, true); await flush();
assert.equal(window._casoraWasteCals[ID], true);
titles = [];
K.month = new Date(new Date().getFullYear() + 1, 5, 1);
await K.load(hass, {}, true); await flush();
assert.equal(window._casoraWasteCals[ID], true, 'another month writes no verdict');
K.month = null;

// A detected calendar does not feed the waste tile: waste() is unchanged by the verdict.
const wasteOf = () => JSON.stringify(window.casoraDevice.waste(hass, {}));
window.casoraDevice = undefined; new Function(read('00-finder.js'))();
window.CASORA_SETTINGS = {};
const before = wasteOf();
window._casoraWasteCals = { [ID]: true };
assert.equal(wasteOf(), before, 'waste() ignores the detected verdict');
assert.notEqual(window.casoraDevice.waste(hass, {}).calendar, ID, 'not picked as the waste calendar');

// The greeting line starts the fetch itself (no calendar tile on the dashboard), in the same window as the tile's.
window._casoraWasteCals = {}; window._casoraWasteTs = {};
titles = ['GFT', 'PMD', 'Restafval'];
urls = [];
await K.load(hass, {}, true); await flush();
const tileUrl = urls[0]; 
window._casoraWasteCals = {}; window._casoraWasteTs = {}; urls = [];
hass.states[ID] = { ...hass.states[ID], last_updated: 'x' }; // a state change makes the next pick fetch again
window.casoraDevice = { waste: () => ({ bins: [] }) };
line(); await flush();
assert.equal(urls[0], tileUrl, 'the greeting fetch uses the tile’s window');
assert.equal(line(), '', 'greeting alone: the calendar is detected after its fetch');
const n = urls.length; line(); await flush();
assert.equal(urls.length, n, 'no new fetch within 5 minutes');
console.log('ok waste_calendar_detect');
