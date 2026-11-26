// Studio: edit the Bin types (casora-panel-personal.js, waste group) with the real panel class and a fake hass.
// A draft in cs.S until "Save settings"; the icon only from the picker (casora-panel.js _iconSheet with a callback).
//   LC_ALL=en_US.UTF-8 TZ=UTC node dev/unit/studio_bin_types.mjs
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

function panelWith() {
  const p = Object.create(P);
  p._hass = { states: {}, entities: {}, devices: {} };
  p.shadowRoot = { getElementById: () => ({}), appendChild: noop, querySelectorAll: () => [] };
  p.rows = []; p.menus = [];
  p._flowGroup = () => { const l = mk('div'); l.parentElement = mk('div'); return l; };
  p._flowRow = (list, o) => { const row = mk('div'); p.rows.push({ o, row }); return { row }; };
  p._combo = () => ({ wrap: mk('div') });
  p._entityList = () => [];
  p._status = noop;
  p._menuAt = (b, items, cb) => { p.menus.push({ items, cb }); };
  return p;
}
// Draw the waste group for the draft S; the bin type rows are the ones with the class casora-binrow.
function draw(S) {
  const p = panelWith();
  P._casoraPersonalGroups.call(p, mk('div'), S, ['waste'], noop);
  const rows = p.rows.filter((r) => r.row.classList.contains('casora-binrow'));
  const ctl = (r) => { const c = r.row.children[0].children; return { name: c[0], words: c[1], color: c[2], icon: c[3], del: c[4] }; };
  return { p, rows, ctl: (i) => ctl(rows[i]), add: () => p.rows.find((r) => r.o.title === 'Add bin type').o.onTap() };
}
const type = (input, v) => { input.value = v; input.oninput(); };
const ids = (S) => S.bin_types.list.map((e) => e.key || e.name);

// Nothing stored: the ready-made list, as the finder has it; nothing is stored by looking.
const READY = window.casoraBinReady();
assert.deepEqual(READY.map((e) => e.key), ['bio', 'paper', 'yellow', 'glass', 'bulky', 'hazard', 'rest']);
let S = normalize({});
let d = draw(S);
assert.equal(d.rows.length, 7, 'ready-made entries are listed');
assert.equal(d.ctl(0).name.value, ''); assert.equal(d.ctl(0).name.placeholder, 'Biomüll');
assert.equal(d.ctl(0).words.value, 'bio, organ, kompost, green waste, gft, groente, tuinafval, groenafval');
assert.equal(d.ctl(0).words.attributes['data-no-i18n'], '');
assert.equal(d.p.rows.find((r) => r.o.title === 'Add bin type').o.icon, 'plus');
assert.equal(prune(S).bin_types, undefined, 'nothing stored before an edit');
window.casoraTr = (s) => 'tr:' + s;
assert.equal(draw(normalize({})).ctl(1).name.placeholder, 'tr:Papier', 'placeholder is the translated ready-made name');
delete window.casoraTr;

// Edit a ready-made entry: the first edit stores the whole list.
type(d.ctl(0).words, ' Bio ,, GFT ,Groenbak');
assert.deepEqual(S.bin_types.list.length, 7);
assert.deepEqual(S.bin_types.list[0].words, ['Bio', 'GFT', 'Groenbak'], 'trimmed, no empties');
assert.equal(S.bin_types.list[0].key, 'bio');
type(d.ctl(0).name, 'Groene bak');
assert.equal(S.bin_types.list[0].name, 'Groene bak');
d.ctl(0).color.onclick(); d.p.menus[0].cb('var(--casora-color-red, #FF453A)');
assert.equal(S.bin_types.list[0].color, 'var(--casora-color-red, #FF453A)');
assert.equal(S.bin_types.list[1].color, '#0A84FF', 'the others keep their ready-made values');

// The icon: a button that opens the picker with the Bin icon title; no text field.
assert.equal(d.ctl(0).icon.tagName, 'BUTTON');
let sheet = null;
d.p._mdiList = async () => [{ n: 'leaf', k: '' }];
d.p._iconSheet = (dd, names, o) => { sheet = { dd, names, o }; };
d.ctl(0).icon.onclick(); await flush();
assert.equal(sheet.o.title, 'Bin icon'); assert.equal(sheet.o.current, 'mdi:trash-can-outline');
sheet.o.onPick('mdi:leaf');
assert.equal(S.bin_types.list[0].icon, 'mdi:leaf');
assert.equal(d.ctl(0).icon.children.length > 0, true);
assert.ok(!d.rows[0].row.children[0].children.some((c) => c.tagName === 'INPUT' && /icon/i.test(c.placeholder || '')), 'no icon text field');

// Window unchanged: the dashboard reads window.CASORA_SETTINGS, only a save replaces it.
window.CASORA_SETTINGS = {};
assert.equal(window.casoraSettings('bin_types').list, undefined, 'dashboard still on the ready-made list');

// Add: a new row with nothing in it; delete a ready-made entry; delete everything.
d = draw(S); d.add();
assert.equal(S.bin_types.list.length, 8);
assert.deepEqual(S.bin_types.list[7], { words: [], name: '', color: 'var(--casora-color-orange, #FF9F0A)', icon: '' });
assert.ok(binTypesBad(S), 'a bin type without words blocks saving');
d = draw(S);
type(d.ctl(7).words, 'Kerst'); type(d.ctl(7).name, 'Kerstbomen');
assert.ok(!binTypesBad(S));
d.ctl(1).del.onclick();
assert.equal(S.bin_types.list.length, 7); assert.ok(!ids(S).includes('paper'), 'ready-made entry deleted');
S.bin_types.list = [];
assert.deepEqual(prune(S).bin_types, { list: [] }, 'deleting all stays an explicit empty list');
assert.equal(draw(S).rows.length, 0, 'no rows, but "Add bin type" is there');
draw(S).add(); assert.equal(S.bin_types.list.length, 1);

// An emptied words field of a ready-made entry also blocks saving.
const S2 = normalize({}); d = draw(S2); type(d.ctl(2).words, ''); assert.ok(binTypesBad(S2));

// Discard: a fresh draft from the saved settings has the saved list again.
const saved = { bin_types: { list: [{ words: ['groenbak'], name: 'Groene bak', icon: 'mdi:leaf' }] } };
const draft = normalize(saved); draw(draft).ctl(0).name; type(draw(draft).ctl(0).name, 'x');
assert.equal(draft.bin_types.list[0].name, 'x');
assert.equal(normalize(saved).bin_types.list[0].name, 'Groene bak', 'discard re-reads the saved list');
assert.equal(draw(normalize(saved)).ctl(0).name.value, 'Groene bak');
assert.equal(draw(normalize(saved)).rows.length, 1, 'a stored list is shown as it is');

// Saving is checked in _csSave.
assert.match(read('custom_components/casora/panel/casora-panel-settings.js'), /binTypesBad[\s\S]{0,200}Each bin type needs at least one word\./);

// _iconSheet: with a callback the title and the pick are the caller's; without, the dashboard icon as before.
function sheetOf(d0, names, o) {
  const p = panelWith();
  p._flowLockScroll = noop; p._blockDrag = noop; let pane = null;
  p.shadowRoot = { appendChild: (x) => { pane = x; } };
  P._iconSheet.call(p, d0, names, o);
  const box = pane.children[1].children[1];
  const grid = box.children.find((c) => c.className === 'icongrid');
  return { p, title: box.children[0].textContent, cells: grid.children, grid };
}
const names = [{ n: 'leaf', k: '' }];
let picked = null;
const own = sheetOf(null, names, { title: 'Bin icon', current: 'mdi:leaf', onPick: (n) => { picked = n; } });
assert.equal(own.title, 'Bin icon');
const leaf = own.cells.find((c) => c.title === 'leaf');
assert.match(leaf.className, /\bon\b/, 'current icon is marked');
leaf.onclick(); assert.equal(picked, 'mdi:leaf');
own.cells[0].onclick(); assert.equal(picked, '', 'None gives an empty icon');
let set = null;
const dash = sheetOf({ id: 'd1', icon: 'mdi:leaf' }, names);
assert.equal(dash.title, 'Dashboard icon');
dash.p._setDashIcon = (dd, n) => { set = [dd.id, n]; };
dash.cells.find((c) => c.title === 'leaf').onclick();
assert.deepEqual(set, ['d1', 'mdi:leaf'], 'dashboard icons still go to _setDashIcon');
console.log('studio_bin_types ok');
