// @deckt: custom_components/casora/scripts/local/46-screensaver.js#mount,liveMap,mountKeepingMap
// Screensaver mount (46-screensaver.js): a preview the Studio drew again leaves its old box behind. Its timer and its
// repaint listener must go with it (the Studio never calls destroy), and destroy twice must not take another mount's
// listener with it.
//   node dev/unit/screensaver_mount_leak.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const timers = new Map();
let nextId = 1;
const doc = { getElementById: () => ({}), querySelector: () => null, head: { appendChild() {} }, createElement: () => ({ style: {} }) };
const win = { matchMedia: () => ({ matches: false }), customElements: { get: (n) => (n === 'casora-flight-map' ? class {} : undefined) } };
const box = {
  window: win, document: doc, customElements: win.customElements, console, Intl, Date, Math, parseFloat, isFinite, isNaN, parseInt, String, Number, JSON, Object, Array,
  setInterval: (fn) => { const id = nextId++; timers.set(id, fn); return id; },
  clearInterval: (id) => { timers.delete(id); },
  location: { search: '?casora_saver=0', pathname: '/' },
};
vm.createContext(box);
vm.runInContext(read('custom_components/casora/scripts/local/46-screensaver.js'), box);
// A stand-in for the Flights rule (49-flights.js): one flight with a view, so the saver draws its map layout with the map element.
win._casoraFlights = {
  mapView: () => ({ key: 'k1', label: 'XY1', cur: [50.2, 10.1], heading: 90, origin: [50, 4], destination: [52, 20], trail: [[50, 4], [50.1, 5]], progress: 40 }),
  unreportedOf: () => [], ROUTE_STYLE: { width: 2, dash: 6 },
  details: () => ({}), times: () => ({ arr: [] }), timeRows: () => [], arrivalBlock: () => null,
};
const S = win._casoraSaver;
const host = () => ({ isConnected: true, innerHTML: '', firstElementChild: null, getRootNode() { return doc; } });
// Repaint listeners are seen through the data path: a forecast that arrives calls every listener once.
let calls = 0, fc = 0;
const ctx = () => { calls++; return { now: new Date('2026-11-14T10:00:00'), vars: {} }; };
const hass = { connection: { subscribeMessage: (cb) => { cb({ forecast: [] }); return Promise.resolve(() => {}); } } };
const listeners = () => { const c0 = calls; S._data.at = {}; S.forecast(hass, 'weather.x' + (fc++), 'daily'); return calls - c0; };

// A box that left the page stops at its next tick: no timer, no listener left.
const a = host();
const before = listeners();
const live = S.mount(a, 'wort', { context: ctx });
assert.equal(timers.size, 1, 'one timer while shown');
assert.equal(listeners(), before + 1, 'one repaint listener while shown');
a.isConnected = false;
for (const fn of [...timers.values()]) fn();
assert.equal(timers.size, 0, 'detached box: its timer is gone');
assert.equal(listeners(), before, 'detached box: its listener is gone');
live.destroy();
assert.equal(listeners(), before, 'destroy after that changes nothing');

// destroy twice keeps the other mounts' listeners.
const b = S.mount(host(), 'wort', { context: ctx });
const c = S.mount(host(), 'wort', { context: ctx });
b.destroy();
b.destroy();
assert.equal(listeners(), before + 1, 'the second destroy leaves the other mount alone');
c.destroy();
assert.equal(listeners(), before);
assert.equal(timers.size, 0);

// A box not yet in the page (mounted before it is inserted) keeps running until it has been shown.
const d = host();
d.isConnected = false;
const dl = S.mount(d, 'wort', { context: ctx });
for (const fn of [...timers.values()]) fn();
assert.equal(timers.size, 1, 'not inserted yet: keeps its timer');
d.isConnected = true;
for (const fn of [...timers.values()]) fn();
d.isConnected = false;
for (const fn of [...timers.values()]) fn();
assert.equal(timers.size, 0, 'shown, then removed: stops');
dl.destroy();

// The Flights map layout holds a map element (a timer and an ha-map of its own): it goes with the saver. Real redraws (the flight
// moves, the clock advances) keep that one element and leave no timer, listener or element behind; destroy empties the box
// (which takes the element out of the page) and stops the saver's own timer.
let step = 0;
win._casoraFlights.mapView = () => ({ key: 'k1', label: 'XY1', cur: [50.2 + 0.01 * step, 10.1 + 0.02 * step], heading: 90, origin: [50, 4], destination: [52, 20], trail: [[50, 4], [50.1, 5]], progress: 40 });
const MAP = /<casora-flight-map\b[^>]*><\/casora-flight-map>/;
class MapEl { constructor() { this.parentNode = null; this.kids = null; } get previousSibling() { const k = this.parentNode.kids; return k[k.indexOf(this) - 1] || null; }
  insertAdjacentHTML(_w, html) { const k = this.parentNode.kids, t = { raw: html, parentNode: this.parentNode }; k.splice(k.indexOf(this), 0, t); } }
const fh = host();
let made = 0;
Object.defineProperty(fh, 'innerHTML', { get() { return fh.scene ? fh.scene.html() : ''; }, set(html) {
  fh.scene = null;
  if (!html) return;
  const open = html.slice(0, html.indexOf('>') + 1), m = html.match(MAP);
  if (!m) { fh.scene = { html: () => html, kids: [] }; return; }
  const el = new MapEl(); made++;
  const sc = { kids: [{ raw: html.slice(open.length, html.indexOf(m[0])), parentNode: null }, el], removeChild(c) { this.kids.splice(this.kids.indexOf(c), 1); },
    html() { return open + this.kids.map((k) => (k === el ? m[0] : k.raw)).join('') + '</div>'; } };
  sc.kids.forEach((k) => { k.parentNode = sc; });
  fh.scene = sc; fh.el = el;
} });
fh.querySelector = () => (fh.scene && fh.el && fh.scene.kids.includes(fh.el) ? fh.el : null);
Object.defineProperty(fh, 'firstElementChild', { get() { return fh.scene; } });
let kept = 0;
const keeping = S.mountKeepingMap;
S.mountKeepingMap = (...a) => { const r = keeping(...a); if (r) kept++; return r; };
let at = 0;
const flightCtx = () => ({ now: new Date('2026-11-14T10:00:00'), vars: {}, hass: {}, flights: [{ src: 'sensor.x', key: 'k1', entry: {}, label: 'XY1', route: '' }] });
const fl = S.mount(fh, 'flights', { context: flightCtx });
assert.match(fh.innerHTML, MAP, 'the flights map layout has the map element');
assert.equal(timers.size, 1, 'the saver has one timer; the map element brings its own (not this saver\'s)');
const first = fh.el, html0 = fh.innerHTML, lis = listeners();
for (let i = 0; i < 3; i++) { step++; fl.update(); }
assert.equal(kept, 3, 'three real redraws took the keep path');
assert.notEqual(fh.innerHTML, html0, 'and the drawn parts did change');
assert.equal(made, 1, 'no new map element was made');
assert.equal(fh.el, first, 'the same element is in the page');
assert.equal(timers.size, 1, 'redraws add no timer');
assert.equal(listeners(), lis, 'nor a listener');
fl.destroy();
assert.equal(fh.innerHTML, '', 'destroy empties the box: the map element is out of the page');
assert.equal(timers.size, 0, 'and the timer is gone');
assert.equal(listeners(), before, 'and the listener');
S.mountKeepingMap = keeping;
console.log('screensaver_mount_leak: ok');
