// The flight popup's map while it loads (49-flights.js): until MapLibre is ready the map element is at opacity 0, so it must
// not be a Tab stop either. Its links and canvas are hidden (visibility), so Tab from the popup does not land in an invisible
// box. Once ready the map is visible again, and its attribution link is a stop (readable, reachable by Tab).
//   node dev/unit/flights_map_loading.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#defineMap,_build,_poll,_unstop,_sync
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');

// Minimal DOM: a tree of elements, tabIndex as the HTML defaults give it, and the visibility of the box they sit in.
const STOP = 'a[href],button,input,select,textarea,[tabindex]';
const el = (tag, attrs = {}, kids = []) => {
  const n = { tag, attrs: { ...attrs }, children: kids, shadowRoot: null, style: {},
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    matches(sel) {
      if (sel !== STOP) throw new Error('unexpected selector ' + sel);
      return (this.tag === 'a' && 'href' in this.attrs) || this.tag === 'button' || ['input', 'select', 'textarea'].includes(this.tag) || 'tabindex' in this.attrs;
    },
    get tabIndex() { return 'tabindex' in this.attrs ? Number(this.attrs.tabindex) : (this.matches(STOP) ? 0 : -1); },
    appendChild() {}, remove() {},
    closest(sel) { for (let x = this; x; x = x.parent) if (x.attrs.class && x.attrs.class.split(' ').includes(sel.slice(1))) return x; return null; },
  };
  kids.forEach((k) => { k.parent = n; });
  n.querySelectorAll = (sel) => { if (sel !== '*') throw new Error('unexpected selector ' + sel); const out = []; (function walk(x) { x.children.forEach((c) => { out.push(c); walk(c); }); })(n); return out; };
  return n;
};
const ATTRIB = '.maplibregl-ctrl-attrib';
const link = el('a', { href: 'https://example.invalid/' });
const canvas = el('div', { id: 'map', tabindex: '0' });
const root = el('div', {}, [canvas, el('div', { class: 'maplibregl-ctrl-attrib' }, [link])]);
root.appendChild = () => {};
const host = el('ha-map');
host.shadowRoot = root;
// A tab stop is reachable when it is a stop and no box around it is hidden (the map host carries the visibility).
const reachable = (x) => x.tabIndex >= 0 && host.style.visibility !== 'hidden';

// The map library: not ready until the test says so.
let ready = false;
const ml = { isStyleLoaded: () => true, loaded: () => ready, on() {}, getSource: () => null, addSource() {}, addLayer() {}, addImage() {}, fitBounds() {} };
['dragPan', 'scrollZoom', 'boxZoom', 'doubleClickZoom', 'touchZoomRotate', 'keyboard', 'dragRotate', 'touchPitch'].forEach((x) => { ml[x] = { disable() {} }; });

const ctx = {
  console, Date, Math, Intl, JSON,
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => host },
  setTimeout: () => ({ live: false }), clearTimeout() {},
  setInterval: () => ({ live: false }), clearInterval() {},
  addEventListener() {}, _casoraNotifyOpenViaCard() {},
  _casoraUI: { stage: () => '', empty: () => '' },
  casoraLocale: () => 'en-US',
};
ctx.window = ctx;
ctx.matchMedia = undefined;
ctx._casoraHaMap = { ok: () => true, defined: () => Promise.resolve(true), ml: () => ml };
ctx.HTMLElement = class { constructor() { this._attrs = {}; } get isConnected() { return true; } setAttribute(n, v) { this._attrs[n] = String(v); } appendChild() {} };
ctx.customElements = { defined: {}, get(n) { return this.defined[n]; }, define(n, c) { this.defined[n] = c; } };
ctx.MutationObserver = class { constructor() {} observe() {} disconnect() {} };
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const Cls = ctx.customElements.get('casora-flight-map');
assert.ok(Cls, 'casora-flight-map is defined');

const map = new Cls();
Object.assign(map, { _since: Date.now(), _tiles: 1, _ml: null, _timer: null, _layers: false, _ok: false, _sent: null, _ident: null });
map._conn = true;
map._build({ connection: {}, hassUrl: (u) => u });

// Not ready: the map host is hidden, so its attribution link is not a Tab stop, and neither is anything else in it.
map._poll();
assert.equal(map._ok, false, 'precondition: the map is not ready');
assert.equal(host.style.visibility, 'hidden', 'before ready the map is hidden (visibility), so nothing inside is a Tab stop');
assert.equal(reachable(link), false, 'before ready the attribution link is not reachable by Tab');
assert.equal(reachable(canvas), false, 'before ready the canvas is not reachable by Tab');

// Ready: the map shows, its attribution link is a Tab stop again, and the canvas stays out of the tab order.
ready = true;
map._poll();
assert.equal(map._ok, true, 'precondition: the map is ready');
assert.notEqual(host.style.visibility, 'hidden', 'once ready the map is visible again');
assert.ok(reachable(link), 'once ready the attribution link can be reached by Tab');
assert.equal(canvas.tabIndex, -1, 'once ready the canvas stays out of the tab order');

console.log('ok: flights map loading');
