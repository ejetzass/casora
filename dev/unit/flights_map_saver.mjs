// @deckt: custom_components/casora/scripts/local/49-flights.js#defineMap,connectedCallback,disconnectedCallback,_build,_poll,_unstop,_css,_fail
// The map element as the Flights screensaver uses it (attribute data-saver): always the dark look, no pointer input at
// all (not even its attribution link: a tap must reach the saver), no Tab stop, the drawn picture when the map is not
// ready in the ready time (the element hides itself, no text), and no element, timer or ha-map left when it goes. The
// popup's own element (no data-saver) keeps its look rule and its attribution link.
//   node dev/unit/flights_map_saver.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SRC = fs.readFileSync(new URL('../../custom_components/casora/scripts/local/49-flights.js', import.meta.url), 'utf8');
const STOP = 'a[href],button,input,select,textarea,[tabindex]';
const el = (tag, attrs = {}, kids = []) => {
  const n = { tag, attrs: { ...attrs }, children: kids, shadowRoot: null, style: {}, removed: false,
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    matches(sel) { assert.equal(sel, STOP); return (this.tag === 'a' && 'href' in this.attrs) || 'tabindex' in this.attrs; },
    get tabIndex() { return 'tabindex' in this.attrs ? Number(this.attrs.tabindex) : (this.matches(STOP) ? 0 : -1); },
    appendChild() {}, remove() { this.removed = true; },
    closest(sel) { for (let x = this; x; x = x.parent) if (x.attrs.class && x.attrs.class.split(' ').includes(sel.slice(1))) return x; return null; },
  };
  kids.forEach((k) => { k.parent = n; });
  n.querySelectorAll = () => { const out = []; (function walk(x) { x.children.forEach((c) => { out.push(c); walk(c); }); })(n); return out; };
  return n;
};

// A fresh runtime per case. The map library is ready only when the test says so; the clock is the test's.
const runtime = () => {
  const link = el('a', { href: 'https://example.invalid/' }, []);
  const canvas = el('div', { tabindex: '0' });
  const attrib = el('div', { class: 'maplibregl-ctrl-attrib' }, [link]);
  const root = el('div', {}, [canvas, attrib]);
  const styles = [];
  root.appendChild = (s) => { styles.push(s.textContent); };
  const haMap = el('ha-map');
  haMap.shadowRoot = root;
  const R = { link, canvas, haMap, styles, ready: false, clock: 1000000, timers: [], appended: [] };
  haMap.appendChild = undefined;
  const ml = { isStyleLoaded: () => true, loaded: () => R.ready, on: (_e, fn) => { R.onData = fn; }, getSource: () => null, addSource() {}, addLayer() {}, addImage() {}, fitBounds() {} };
  ['dragPan', 'scrollZoom', 'boxZoom', 'doubleClickZoom', 'touchZoomRotate', 'keyboard', 'dragRotate', 'touchPitch'].forEach((x) => { ml[x] = { disable() {} }; });
  class ClockDate extends Date { constructor(...a) { if (a.length) super(...a); else super(R.clock); } static now() { return R.clock; } }
  const ctx = {
    console, Date: ClockDate, Math, Intl, JSON, Promise,
    localStorage: { getItem: () => null, setItem() {} },
    document: { querySelector: (s) => (s === 'home-assistant' ? { hass: { connection: {} } } : null), querySelectorAll: () => [],
      createElement: (t) => (t === 'ha-map' ? haMap : { textContent: '' }) },
    setTimeout: () => 0, clearTimeout() {},
    setInterval: (fn, ms) => { R.timers.push({ fn, ms, live: true }); return R.timers.length; },
    clearInterval: (id) => { if (R.timers[id - 1]) R.timers[id - 1].live = false; },
    addEventListener() {}, _casoraNotifyOpenViaCard() {}, _casoraUI: { stage: () => '', empty: () => '' }, casoraLocale: () => 'en-US',
  };
  ctx.window = ctx;
  ctx._casoraHaMap = { ok: () => true, defined: () => Promise.resolve(true), ml: () => ml };
  ctx.HTMLElement = class {
    constructor() { this._attrs = {}; this.style = {}; this.connected = true; this.kids = []; }
    get isConnected() { return this.connected; }
    setAttribute(n, v) { this._attrs[n] = String(v); }
    getAttribute(n) { return n in this._attrs ? this._attrs[n] : null; }
    hasAttribute(n) { return n in this._attrs; }
    appendChild(c) { this.kids.push(c); }
  };
  ctx.customElements = { defined: {}, get(n) { return this.defined[n]; }, define(n, c) { this.defined[n] = c; } };
  ctx.MutationObserver = class { observe() {} disconnect() {} };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const Cls = ctx.customElements.get('casora-flight-map');
  assert.ok(Cls, 'casora-flight-map is defined');
  R.make = (saver) => {
    const m = new Cls();
    if (saver) m.setAttribute('data-saver', '');
    m.connectedCallback();
    return m;
  };
  R.tick = () => R.timers.filter((t) => t.live).forEach((t) => t.fn());
  R.live = () => R.timers.filter((t) => t.live).length;
  return R;
};
const settle = () => new Promise((r) => setImmediate(r));

// ── The saver's map: dark look, no pointer input, no Tab stop ────────────────────────────────────────────────────────
{
  const R = runtime(), m = R.make(true);
  await settle();
  assert.equal(R.haMap.themeMode, 'dark', 'the saver is always a dark scene: the map takes the dark look');
  assert.equal(m.style.pointerEvents, 'none', 'the map host takes no pointer input');
  assert.equal(R.haMap.style.pointerEvents, 'none', 'nor does the ha-map inside');
  assert.ok(/maplibregl-ctrl-attrib[^}]*pointer-events:none!important/.test(R.styles.join('')), 'nor does its attribution link');
  assert.ok(!/pointer-events:auto/.test(R.styles.join('').split('pointer-events:none!important')[1] || ''), 'the link rule that makes it clickable is overridden last');
  R.tick();
  assert.equal(R.link.tabIndex, -1, 'the attribution link is no Tab stop in the saver');
  assert.equal(R.canvas.tabIndex, -1, 'nor is the canvas');
  assert.ok(!m.style.position, 'the saver\'s stylesheet gives the box: no inline position or width');
}
// The popup's map keeps its rule and its link.
{
  const R = runtime(), m = R.make(false);
  await settle();
  assert.equal(R.haMap.themeMode, 'auto', 'the popup follows the theme');
  assert.equal(m.style.position, 'relative', 'the popup box is as before');
  assert.ok(!m.style.pointerEvents, 'the popup host is as before');
  assert.ok(!/ctrl-attrib[^}]*pointer-events:none/.test(R.styles.join('')), 'the popup keeps its clickable attribution link');
  R.tick();
  assert.equal(R.link.tabIndex, 0, 'and its Tab stop');
}

// ── Fallback: not ready in the ready time -> the element hides itself (the drawn picture shows), no text ─────────────
{
  const R = runtime(), m = R.make(true);
  await settle();
  R.tick();
  assert.equal(m.style.display, 'block', 'waiting: still in place, the map itself is hidden');
  assert.equal(R.haMap.style.visibility, 'hidden', 'not ready: the map shows nothing');
  R.clock += 12001; // F.MAP.READY_MS
  R.tick();
  assert.equal(m.style.display, 'none', 'not ready in the ready time: the element is gone from the picture');
  assert.equal(R.live(), 0, 'and its timer stopped');
  assert.deepEqual(m.kids.filter((k) => k !== R.haMap), [], 'it added nothing (no error text)');
}
// Ready in time: it stays, also long after, and never falls back.
{
  const R = runtime(), m = R.make(true);
  await settle();
  R.ready = true;
  R.clock += 2000;
  R.tick();
  R.onData({ tile: { state: 'loaded' } }); // the first tile
  R.tick();
  R.clock += 60000;
  R.tick(); R.tick();
  assert.equal(m.style.display, 'block', 'a ready map stays');
  assert.notEqual(R.haMap.style.visibility, 'hidden', 'and shows');
}
// ── Cleanup: the element leaving the page takes its ha-map and its timer ─────────────────────────────────────────────
{
  const R = runtime(), m = R.make(true);
  await settle();
  assert.equal(R.live(), 1, 'one timer while the map is there');
  m.connected = false;
  m.disconnectedCallback();
  assert.equal(R.live(), 0, 'no timer left');
  assert.equal(R.haMap.removed, true, 'the ha-map is removed with it');
}
console.log('ok flights_map_saver');
