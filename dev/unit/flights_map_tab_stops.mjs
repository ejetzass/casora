// The flight popup's map (49-flights.js): the map's own elements (its canvas, zoom controls) keep tabindex 0 while the map
// is inert, and the popup's Tab handling counts them as stops (casora-core.js _focusables). Tab from Close would then leave
// the popup. After a poll tick none of them may stay in the tab order. The attribution link is the one exception: it is a
// real link, so it stays a stop, readable and clickable, while the map itself takes no pointer input.
// It checks tabindex attributes only; that the map is not reachable before it is ready is covered by flights_map_loading.mjs.
//   node dev/unit/flights_map_tab_stops.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#defineMap,_build,_poll,_unstop
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');

// Minimal DOM: elements with attributes, a tabIndex that follows the HTML defaults, parents, and shadow roots.
const STOP = 'a[href],button,input,select,textarea,[tabindex]';
const ATTRIB = '.maplibregl-ctrl-attrib';
const el = (tag, attrs = {}, kids = []) => {
  const n = { tag, attrs: { ...attrs }, children: kids, shadowRoot: null, style: {},
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
    appendChild() {}, remove() {},
    closest(sel) {
      if (sel !== ATTRIB) throw new Error('unexpected selector ' + sel);
      for (let x = this; x; x = x.parent) if (x.attrs.class && x.attrs.class.split(' ').includes(ATTRIB.slice(1))) return x;
      return null;
    },
  };
  kids.forEach((k) => { k.parent = n; });
  n.querySelectorAll = (sel) => { if (sel !== '*') throw new Error('unexpected selector ' + sel); const out = []; (function walk(x) { x.children.forEach((c) => { out.push(c); walk(c); }); })(n); return out; };
  return n;
};
// Stops the map draws: a canvas holder with tabindex 0, two zoom links, the attribution link (in its box), and a nested shadow root.
const mapShadow = () => {
  const nested = el('div', {}, [el('button', { 'aria-label': 'Nested control' })]);
  const root = { children: [el('div', { id: 'map', tabindex: '0' }), el('div', { class: 'maplibregl-ctrl-attrib' }, [el('a', { href: 'https://example.invalid/' })]),
    el('a', { href: 'https://example.invalid/', 'aria-label': 'Zoom in' }), el('a', { href: 'https://example.invalid/', 'aria-label': 'Zoom out' }), nested] };
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
ctx.HTMLElement = class { constructor() { this._attrs = {}; this._conn = true; } get isConnected() { return this._conn; } setAttribute(n, v) { this._attrs[n] = String(v); } appendChild() {} };
ctx.customElements = { defined: {}, get(n) { return this.defined[n]; }, define(n, c) { this.defined[n] = c; } };
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const Cls = ctx.customElements.get('casora-flight-map');
assert.ok(Cls, 'casora-flight-map is defined');

// The ha-map element the map builds: its shadow root is what the map's stops live in.
const host = el('ha-map');
host.shadowRoot = mapShadow();
ctx.document.createElement = () => host;
const map = new Cls();
Object.assign(map, { _since: Date.now(), _tiles: 0, _ml: null, _timer: null, _layers: false, _ok: false, _sent: null, _ident: null });
map._conn = true;
// A MutationObserver that keeps its callback, so the test can run it the way the browser does when the map adds content.
class FakeObserver {
  constructor(cb) { this.cb = cb; FakeObserver.last = this; }
  observe(target, opts) { this.target = target; this.opts = opts; }
  disconnect() { this.disconnected = true; }
}
ctx.MutationObserver = FakeObserver;
map._build({ connection: {}, hassUrl: (u) => u });

// The observer watches the map's shadow root, its content and its subtree, from the moment the map is built.
const mo = FakeObserver.last;
assert.ok(mo, 'a MutationObserver is set up with the map');
assert.equal(mo.target, host.shadowRoot, 'the observer watches the map\'s shadow root');
assert.ok(mo.opts.childList && mo.opts.subtree, 'the observer sees added content at any depth');

// The MutationObserver path, before any poll: the map adds a canvas and a zoom link, the observer runs, and neither is a stop.
host.shadowRoot.children.push(el('canvas', { tabindex: '0' }), el('a', { href: 'https://example.invalid/', 'aria-label': 'Zoom' }));
mo.cb([]);
const moLeft = stopsOf(host.shadowRoot).filter((x) => !x.closest(ATTRIB)).map((x) => x.tag + '#' + x.getAttribute('aria-label'));
assert.deepEqual(moLeft, [], 'the observer takes the map\'s stops out of the tab order: ' + moLeft.join(', '));

// The map is not inert: the attribution link must take a click and a Tab. The map itself takes no pointer input.
assert.notEqual(host.inert, true, 'the map is not inert, so its attribution link can be reached');
assert.equal(host.style.pointerEvents, 'none', 'the map takes no pointer input of its own');

// The map's own stops are listed before the poll: the precondition of the check below.
assert.ok(stopsOf(host.shadowRoot).length > 0, 'precondition: the map has stops before the poll');

map._poll();

// Every stop left is the attribution link: the canvas and the zoom links are out of the tab order.
const isAttrib = (x) => !!x.closest(ATTRIB);
const left = stopsOf(host.shadowRoot).filter((x) => !isAttrib(x)).map((x) => x.tag + (x.getAttribute('aria-label') ? '[' + x.getAttribute('aria-label') + ']' : '') + '#' + x.getAttribute('id'));
assert.deepEqual(left, [], 'no map element except the attribution stays in the tab order after a poll: ' + left.join(', '));

// The attribution link stays a real, focusable link (tabindex 0, not -1).
const link = host.shadowRoot.querySelectorAll('*').filter((x) => x.tag === 'a' && isAttrib(x));
assert.equal(link.length, 1, 'the attribution link is still there');
assert.ok(link[0].getAttribute('href'), 'the attribution is a real link');
assert.ok(link[0].tabIndex >= 0, 'the attribution link can be reached by Tab');

// Readable: the attribution sits on an opaque box, 12 px or more, with a pointer and a visible focus ring.
const css = SRC.match(/var MAP_CSS = ([\s\S]*?);\n/);
assert.ok(css, 'the map stylesheet is found');
const attribRule = css[1].match(/\.maplibregl-ctrl-attrib\{([^}]*)\}/);
assert.ok(attribRule, 'the attribution has its own rule');
const size = Number((attribRule[1].match(/font-size:(\d+)px/) || [])[1]);
assert.ok(size >= 12, 'attribution text is 12 px or more (was ' + size + ' px)');
assert.match(attribRule[1], /pointer-events:auto/, 'the attribution takes pointer input');
assert.doesNotMatch(attribRule[1], /background:transparent/, 'the attribution has an opaque background');
assert.match(css[1], /\.maplibregl-ctrl-attrib a:focus-visible\{[^}]*outline/, 'the attribution link shows a focus ring');

console.log('ok: flights map tab stops');
