// @deckt: custom_components/casora/panel/casora-panel-settings.js#_csSaverPreview
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadCalendars } from './lib/calendars_block.mjs';

const read = (path) => fs.readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.style = { cssText: '', setProperty() {} };
    this.parentNode = null;
    this.className = '';
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.classes(), ...names])].join(' '); },
      contains: (name) => this.classes().includes(name),
      toggle: (name, on) => { this.className = [...this.classes().filter((x) => x !== name), ...(on ? [name] : [])].join(' '); },
    };
  }
  classes() { return String(this.className).split(/\s+/).filter(Boolean); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  insertBefore(child, before) {
    child.parentNode = this;
    const index = this.children.indexOf(before);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text || this.children.map((child) => child.textContent || '').join(''); }
  getRootNode() { let node = this; while (node.parentNode) node = node.parentNode; return node; }
  querySelectorAll(selector) {
    const match = selector[0] === '.'
      ? (node) => node.classes().includes(selector.slice(1))
      : selector[0] === '#'
        ? (node) => node.id === selector.slice(1)
        : () => false;
    const found = [];
    const visit = (node) => node.children.forEach((child) => { if (match(child)) found.push(child); visit(child); });
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get isConnected() { return true; }
}

const Panel = class {};
const document = { createElement: (tag) => new Element(tag) };
const window = { matchMedia: () => ({ matches: false }), document };
loadCalendars(window);
const context = {
  window,
  document,
  customElements: { whenDefined: () => Promise.resolve(), get: () => Panel },
  console,
  Intl,
  Date,
  Math,
  parseFloat,
  isFinite,
  isNaN,
  parseInt,
  String,
  Number,
  JSON,
  location: { search: '', pathname: '/' },
  __casoraPanelInternals: {},
  URL,
  URLSearchParams,
  setTimeout,
  setInterval: () => 1,
  clearInterval() {},
};
vm.createContext(context);
vm.runInContext(read('custom_components/casora/scripts/local/46-screensaver.js'), context, { filename: '46-screensaver.js' });
vm.runInContext(read('custom_components/casora/panel/casora-panel-settings.js'), context, { filename: 'casora-panel-settings.js' });
// The shared expander row (.adv > .advsum) comes from the Studio's fold code.
vm.runInContext(read('custom_components/casora/panel/casora-panel-b-ux.js'), context, { filename: 'casora-panel-b-ux.js' });
await new Promise((resolve) => setImmediate(resolve));

const SV = window._casoraSaver;
SV.mount = () => ({ update() {}, destroy() {} });
const makePreview = (variables = {}, states = {
  'calendar.example_a': { attributes: { friendly_name: 'A' } },
  'calendar.example_b': { attributes: { friendly_name: 'B' } },
}) => {
  const box = new Element('section'), card = new Element('article');
  box.appendChild(card);
  const panel = {
    _state: { compact: { rooms: [{ name: 'Test', variables: { ...variables } }] } },
    _hass: { states },
    _imgs: [],
    _uxFold: Panel.prototype._uxFold,
  };
  Panel.prototype._csSaverPreview.call(panel, box, card);
  return { box, variables: panel._state.compact.rooms[0].variables };
};
// The shared row around the calendars: its bold word, its closed grey line, and where it sits.
const foldOf = (box) => box.querySelectorAll('.adv').find((row) => row.querySelectorAll('.advsum')[0]?.children[0].textContent === 'Choose calendars');
const greyOf = (box) => foldOf(box).querySelectorAll('.uxsum')[0].textContent;
const lists = (box) => box.querySelectorAll('.cs-saver-list');
const listFor = (box, key) => lists(box).find((list) => list.dataset.key === key);
const calendarRow = (box, id) => listFor(box, 'casora_screensaver_calendars').children.find((row) => row.dataset.id === id);
const rotationRow = (box, id) => listFor(box, 'casora_screensaver_mix').children.find((row) => row.dataset.id === id);

// The calendar list sits in the shared row: closed at first, the grey line names the choice.
const rowed = makePreview({ casora_screensaver_calendars: ['calendar.example_b', 'calendar.gone'] });
assert.ok(foldOf(rowed.box), 'the calendars sit in the shared row');
assert.ok(foldOf(rowed.box).querySelectorAll('.cs-saver-list').length === 1, 'the list is inside the row');
assert.equal(foldOf(rowed.box).classList.contains('open'), false, 'the row starts closed');
assert.equal(greyOf(rowed.box), '1 calendar', 'one calendar picked; one that is gone is not counted');
assert.equal(greyOf(makePreview().box), 'All calendars', 'nothing picked means All calendars');
assert.equal(greyOf(makePreview({ casora_screensaver_calendars: ['calendar.example_a', 'calendar.example_b'] }).box), '2 calendars');
assert.equal(greyOf(makePreview({}, {}).box), 'Nothing to choose', 'nothing available says so, no count of 0');
const aloneRow = makePreview({ casora_screensaver_kind: 'woche' });
const aloneParent = foldOf(aloneRow.box).parentNode;
assert.equal(aloneParent.className, 'cs-saver-lists', 'picked alone: the row is below the mode choices');

// Unset rotation uses SV.selected's real default: every kind is included.
const defaults = makePreview({ casora_screensaver_calendars: ['calendar.example_b'] });
assert.ok(listFor(defaults.box, 'casora_screensaver_calendars'), 'default rotation exposes the shared calendar picker');
assert.equal(calendarRow(defaults.box, 'calendar.example_b').attributes['aria-pressed'], 'true');
assert.equal(calendarRow(defaults.box, 'calendar.example_a').attributes['aria-pressed'], 'false');
for (const kind of ['kalender', 'linie', 'woche']) {
  defaults.box.querySelectorAll('.cs-saver-chip').find((chip) => chip.dataset.kind === kind).onclick();
  assert.ok(listFor(defaults.box, 'casora_screensaver_calendars'), `single ${kind} exposes the shared picker`);
}
defaults.box.querySelectorAll('.cs-saver-chip').find((chip) => chip.dataset.kind === 'kameras').onclick();
assert.equal(listFor(defaults.box, 'casora_screensaver_calendars'), undefined, 'single Cameras does not expose the calendar picker');
const empty = makePreview({}, {});
assert.match(empty.box.textContent, /No calendar found\. The preview shows an example\./, 'no calendars keeps the example empty state');

const severalCalendarKinds = makePreview({
  casora_screensaver_mix: ['wort', 'kalender', 'linie', 'woche'],
});
assert.equal(
  lists(severalCalendarKinds.box).filter((list) => list.dataset.key === 'casora_screensaver_calendars').length,
  1,
  'several calendar modes in rotation still show exactly one shared picker',
);

// With one non-calendar kind selected, the picker is hidden; enabling Calendar restores the same saved choice.
const rotation = makePreview({
  casora_screensaver_mix: ['wort'],
  casora_screensaver_calendars: ['calendar.example_b'],
});
assert.equal(listFor(rotation.box, 'casora_screensaver_calendars'), undefined, 'rotation without calendar kinds hides the picker');
rotationRow(rotation.box, 'kalender').onclick();
assert.ok(listFor(rotation.box, 'casora_screensaver_calendars'), 'enabling Calendar in rotation restores the picker');
assert.equal(calendarRow(rotation.box, 'calendar.example_b').attributes['aria-pressed'], 'true', 'the saved calendar remains selected');
rotationRow(rotation.box, 'kalender').onclick();
assert.equal(listFor(rotation.box, 'casora_screensaver_calendars'), undefined, 'disabling the last calendar kind hides the picker');
assert.deepEqual(rotation.variables.casora_screensaver_calendars, ['calendar.example_b'], 'hiding the picker retains the draft selection');
rotationRow(rotation.box, 'kalender').onclick();
assert.equal(calendarRow(rotation.box, 'calendar.example_b').attributes['aria-pressed'], 'true', 're-showing the picker restores the unchanged selection');
assert.equal(calendarRow(rotation.box, 'calendar.example_a').attributes['aria-pressed'], 'false', 're-showing keeps the other calendar excluded');

console.log('screensaver_calendar_picker: ok');
