// Studio: a picked calendar that is the Waste calendar (detected, the draft Settings one, or Waste Collection Schedule)
// shows a hint under its row; nothing is filtered or stored. Real panel class, fake hass.
//   node dev/unit/studio_waste_calendar_warning.mjs
// @deckt: custom_components/casora/panel/casora-panel-personal.js#_casoraPersonalGroups, custom_components/casora/scripts/local/00-finder.js#casoraWasteScan,casoraWasteCalendar,casoraCalendars
// @deckt: custom_components/casora/panel/casora-panel-personal.js#_casoraPersonalGroups, custom_components/casora/panel/casora-panel-personal.js#binTypesBad, custom_components/casora/panel/casora-panel.js#_iconSheet
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const noop = () => {};
const flush = () => new Promise((r) => setImmediate(r));
const mk = (tag) => {
  const cls = new Set();
  return {
    tagName: String(tag).toUpperCase(), children: [], attributes: {}, dataset: {}, style: { setProperty: noop },
    className: '', textContent: '', innerHTML: '', value: '', parentElement: null, isConnected: true,
    classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)),
      toggle: (c, on) => ((on === undefined ? !cls.has(c) : on) ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
    setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; }, append(...c) { c.forEach((x) => this.appendChild(x)); },
    replaceChildren() { this.children = []; }, focus: noop, remove: noop,
    addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], matches: () => false,
  };
};
const DOM = { createElement: mk, createTextNode: (t) => ({ textContent: t }), querySelector: () => null, addEventListener: noop, removeEventListener: noop };
globalThis.window = globalThis;
globalThis.document = DOM;
globalThis.addEventListener = noop;
globalThis.setTimeout = () => 0;
globalThis.requestAnimationFrame = () => 0;
globalThis.fetch = () => Promise.reject(new Error('offline'));
new Function(read('custom_components/casora/scripts/local/00-finder.js'))();

let Panel = null;
const stub = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : stub()), apply: () => stub(), construct: () => stub() });
globalThis.location = { pathname: '/' };
globalThis.matchMedia = () => ({ matches: false, addEventListener: noop });
globalThis.HTMLElement = class {};
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem: noop, removeItem: noop }, configurable: true });
globalThis.customElements = { get: () => Panel, define: (n, c) => { Panel = c; }, whenDefined: () => new Promise(noop) };
const fix = (s) => s.replace(/import\.meta\.url/g, '"http://x/casora-panel.js?v=0"');
const info = console.info; console.info = noop;
globalThis.document = stub();
new Function(fix(read('custom_components/casora/panel/casora-panel-types.js')))();
new Function(fix(read('custom_components/casora/panel/casora-panel.js')))();
globalThis.document = DOM;
console.info = info;
globalThis.customElements = { get: () => Panel, define: noop, whenDefined: () => Promise.resolve() };
new Function(read('custom_components/casora/panel/casora-panel-personal.js'))();
await flush();
const P = Panel.prototype;
const { normalize, prune, binTypesBad } = window.casoraPersonal;

function panelWith(hass) {
  const p = Object.create(P);
  p._hass = hass;
  p.shadowRoot = { getElementById: () => ({}), appendChild: noop, querySelectorAll: () => [] };
  p.rows = [];
  p._flowGroup = () => { const l = mk('div'); l.parentElement = mk('div'); return l; };
  p._flowRow = (list, o) => { const row = mk('div'); p.rows.push({ o, row }); return { row }; };
  p._combo = () => ({ wrap: mk('div') });
  p._entityList = () => [];
  p._status = noop;
  return p;
}
const st = (name) => ({ state: 'off', attributes: { friendly_name: name } });
const hass = {
  states: { 'calendar.family': st('Family'), 'calendar.bins_nl': st('Bins'), 'calendar.set': st('Set'), 'calendar.wcs': st('Wcs') },
  entities: { 'calendar.family': { platform: 'google' }, 'calendar.bins_nl': { platform: 'ics' }, 'calendar.set': { platform: 'caldav' },
    'calendar.wcs': { platform: 'waste_collection_schedule' } },
  devices: {}, locale: { language: 'en' },
};
let titles = [], calls = 0;
hass.callApi = (m, path) => { calls++; return Promise.resolve(titles.map((t, i) => ({ summary: t, start: { date: '2026-12-0' + (i + 1) }, end: { date: '2026-12-0' + (i + 2) } }))); };
const HINT = 'Waste calendar: the greeting line skips it.';
// Draw the Calendars group for the draft S; returns, per picked calendar, the hint text (or null).
function hints(S) {
  let again = 0;
  const p = panelWith(hass);
  P._casoraPersonalGroups.call(p, mk('div'), S, ['calendars'], () => { again++; });
  const rows = p.rows.filter((r) => r.row.classList.contains('casora-calrow'));
  return { again: () => again, out: rows.map((r) => { const w = r.row.children.find((c) => c.className === 'casora-pwarn'); return w ? w.textContent : null; }) };
}
const draft = (cals, wasteCal) => { const S = normalize({}); S.calendars = cals.map((entity) => ({ entity, name: '' })); S.waste.calendar = wasteCal || ''; return S; };
window.CASORA_SETTINGS = {};

// No verdict yet, nothing set: no hint (counts as appointments); a Waste Collection Schedule calendar needs none.
window._casoraWasteCals = {}; window._casoraWasteTs = { 'calendar.family': Date.now(), 'calendar.bins_nl': Date.now(), 'calendar.set': Date.now() };
assert.deepEqual(hints(draft(['calendar.family', 'calendar.bins_nl'])).out, [null, null], 'no verdict: no hint');
assert.deepEqual(hints(draft(['calendar.wcs'])).out, [HINT], 'a Waste Collection Schedule calendar');
// The Settings calendar is read from the draft, so the hint follows the edit.
assert.deepEqual(hints(draft(['calendar.family', 'calendar.set'], 'calendar.set')).out, [null, HINT], 'the Settings calendar (draft)');
assert.deepEqual(hints(draft(['calendar.set'], '')).out, [null], 'cleared in the draft: no hint');
// Detected by content.
window._casoraWasteCals = { 'calendar.bins_nl': true, 'calendar.family': false };
assert.deepEqual(hints(draft(['calendar.family', 'calendar.bins_nl'])).out, [null, HINT], 'detected: hint; other calendar: none');

// The hint only informs: the picked calendar still counts for the tile and popup, and nothing is stored.
window.casoraSettings = () => ({ calendars: [{ entity: 'calendar.bins_nl', name: 'Bins' }] });
assert.deepEqual(window.casoraCalendars(hass, null).map((c) => c.entity), ['calendar.bins_nl'], 'tile and popup keep the picked calendar');
delete window.casoraSettings;
const S2 = draft(['calendar.bins_nl']); hints(S2);
assert.deepEqual(prune(S2).calendars, [{ entity: 'calendar.bins_nl' }], 'the stored calendar is unchanged');

// Studio has not scanned: it fetches the picked calendars once, then draws again; the verdict arrives -> hint.
window._casoraWasteCals = {}; window._casoraWasteTs = {};
titles = ['GFT', 'PMD', 'Restafval'];
const first = hints(draft(['calendar.bins_nl']));
assert.deepEqual(first.out, [null], 'before the verdict: no hint');
await flush();
assert.equal(first.again(), 1, 'drawn again once the verdicts arrived');
assert.deepEqual(hints(draft(['calendar.bins_nl'])).out, [HINT], 'after the verdict: hint');
const n = calls; hints(draft(['calendar.bins_nl'])); await flush();
assert.equal(calls, n, 'no second fetch within 5 minutes');
console.log('ok studio_waste_calendar_warning');
