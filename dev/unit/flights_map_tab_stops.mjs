// The flight popup's map (49-flights.js): the map's own elements (its canvas, zoom controls, attribution link) are inert,
// but they keep tabindex 0. The popup's Tab handling counts them as stops (casora-core.js _focusables), so Tab from the
// Close button would leave the popup. After a poll tick none of them may stay in the tab order.
//   node dev/unit/flights_map_tab_stops.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#defineMap,_poll,_unstop
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');

// Minimal DOM: elements with attributes, a tabIndex that follows the HTML defaults, and shadow roots.
const STOP = 'a[href],button,input,select,textarea,[tabindex]';
const el = (tag, attrs = {}, kids = []) => {
  const n = { tag, attrs: { ...attrs }, children: kids, shadowRoot: null, inert: false,
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    matches(sel) {
      if (sel !== STOP) throw new Error('unexpected selector ' + sel);
      return (this.tag === 'a' && 'href' in this.attrs) || this.tag === 'button' || ['input', 'select', 'textarea'].includes(this.tag) || 'tabindex' in this.attrs;
    },
    get tabIndex() {
      if ('tabindex' in this.attrs) return Number(this.attrs.tabindex);
      return this.matches(STOP) ? 0 : -1;
    },
    appendChild() {}, remove() {}, closest() { return null; },
  };
  n.querySelectorAll = (sel) => { if (sel !== '*') throw new Error('unexpected selector ' + sel); const out = []; (function walk(x) { x.children.forEach((c) => { out.push(c); walk(c); }); })(n); return out; };
  return n;
};
// Stops the map draws: a canvas holder with tabindex 0, two zoom links, an attribution link, and a nested shadow root.
const mapShadow = () => {
  const nested = el('div', {}, [el('button', { 'aria-label': 'Nested control' })]);
  const root = { children: [el('div', { id: 'map', tabindex: '0' }), el('a', { href: 'https://example.invalid/', 'aria-label': 'Zoom in' }),
    el('a', { href: 'https://example.invalid/', 'aria-label': 'Zoom out' }), el('a', { href: 'https://example.invalid/' }), nested] };
  root.appendChild = () => {};
  root.querySelectorAll = (sel) => { if (sel !== '*') throw new Error('unexpected selector ' + sel); const out = []; (function walk(x) { x.children.forEach((c) => { out.push(c); walk(c); }); })(root); return out; };
  nested.shadowRoot = { children: [el('button', { 'aria-label': 'Inside shadow' })], appendChild() {} };
  nested.shadowRoot.querySelectorAll = (sel) => nested.shadowRoot.children.filter(() => sel === '*');
  return root;
};
// Every stop of the tree (through the shadow roots), as _focusables() would see it.
const stopsOf = (root) => {
  const out = [];
  root.querySelectorAll('*').forEach((x) => {
    if (x.matches(STOP) && x.tabIndex >= 0) out.push(x);
    if (x.shadowRoot) out.push(...stopsOf(x.shadowRoot));
  });
  return out;
};

// The map element class, loaded the way the other flight unit tests load it.
const ctx = {
  console, Date, Math, Intl, JSON,
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => el('style') },
  setTimeout: () => ({ live: false }), clearTimeout() {},
  setInterval: () => ({ live: false }), clearInterval() {},
  addEventListener() {},
  _casoraNotifyOpenViaCard() {},
  _casoraUI: { stage: () => '', empty: () => '' },
  casoraLocale: () => 'en-US',
};
// A map module that reports ready, with a map that has no layers yet (so the poll only does its own bookkeeping).
const fakeMl = new Proxy({}, { get: (t, k) => (k === 'isStyleLoaded' ? () => false : () => {}) });
ctx._casoraHaMap = { ok: () => true, defined: () => Promise.resolve(true), ml: () => fakeMl };
ctx.window = ctx;
ctx.HTMLElement = class { constructor() { this._attrs = {}; this._conn = true; } get isConnected() { return this._conn; } setAttribute(n, v) { this._attrs[n] = String(v); } };
ctx.customElements = { defined: {}, get(n) { return this.defined[n]; }, define(n, c) { this.defined[n] = c; } };
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const Cls = ctx.customElements.get('casora-flight-map');
assert.ok(Cls, 'casora-flight-map is defined');

// A map element as connectedCallback leaves it, with its ha-map host already built.
const host = el('ha-map');
host.shadowRoot = mapShadow();
const map = new Cls();
Object.assign(map, { _since: Date.now(), _tiles: 0, _ml: null, _el: host, _timer: null, _layers: false, _ok: false, _sent: null, _ident: null });
map._conn = true;

// The map's own stops are listed before the fix: the test is red here.
assert.ok(stopsOf(host.shadowRoot).length > 0, 'precondition: the map has stops before the poll');

map._poll();

const left = stopsOf(host.shadowRoot).map((x) => x.tag + (x.getAttribute('aria-label') ? '[' + x.getAttribute('aria-label') + ']' : '') + '#' + x.getAttribute('id'));
assert.deepEqual(left, [], 'no map element stays in the tab order after a poll: ' + left.join(', '));

// The attribution link is still there: the stops leave the tab order, the content stays.
assert.ok(host.shadowRoot.children.some((x) => x.tag === 'a' && x.getAttribute('href')), 'attribution link still present');

console.log('ok: flights map tab stops');
