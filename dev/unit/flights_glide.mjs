// The flight popup's arrow glides between reported positions (49-flights.js): a pure glide function (F.glide), the view
// at a drawn position (F.mapViewAt: trail end and Remaining route start follow the arrow), and the map element's
// animation-frame loop (runs only during a glide; stops after it and when the element leaves the page).
// Controlled clock and a fake frame queue; synthetic flights; no browser.
//   node dev/unit/flights_glide.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#glide,track,jumps,MAX_SPEED_KMH,mapViewAt,mapView,mapGeo,defineMap
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');
const MIN = 60000, T0 = Date.now();
const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, (m || '') + ' ' + a + ' not within ' + tol + ' of ' + b);
const deq = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);

let F, ctx, clock, frames, reduce;
const fakeEl = () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {}, shadowRoot: null });
const svgEl = (tag) => ({ tag, attrs: {}, style: {}, innerHTML: '', setAttribute(k, v) { this.attrs[k] = String(v); },
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, appendChild() {}, remove() {} });
const runtime = () => {
  clock = { timers: [] }; frames = { next: 1, queue: new Map() }; reduce = false;
  ctx = {
    console, Date, Math, Intl, JSON,
    localStorage: { getItem: () => null, setItem() {} },
    document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => fakeEl() },
    setTimeout: () => ({ live: false }), clearTimeout() {},
    setInterval: (fn) => { const t = { fn, live: true }; clock.timers.push(t); return t; },
    clearInterval: (t) => { if (t) t.live = false; },
    requestAnimationFrame: (fn) => { const id = frames.next++; frames.queue.set(id, fn); return id; },
    cancelAnimationFrame: (id) => { frames.queue.delete(id); },
    matchMedia: (q) => ({ matches: /reduce/.test(q) ? reduce : false }),
    addEventListener() {}, _casoraNotifyOpenViaCard() {},
    _casoraUI: { stage: () => '', empty: () => '' }, _casoraLovelaceCfg: () => null, casoraLocale: () => 'en-US',
  };
  ctx.window = ctx;
  ctx.HTMLElement = class { constructor() { this.style = {}; this._attrs = {}; this._kids = []; this._conn = false; }
    get isConnected() { return this._conn; } setAttribute(n, v) { this._attrs[n] = String(v); }
    getAttribute(n) { return n in this._attrs ? this._attrs[n] : null; } appendChild(c) { this._kids.push(c); return c; }
    remove() { this._conn = false; } };
  ctx.customElements = { defined: {}, get(n) { return this.defined[n]; }, define(n, c) { this.defined[n] = c; } };
  vm.createContext(ctx); vm.runInContext(SRC, ctx);
  F = ctx._casoraFlights;
};
runtime();

// ── the pure glide function ────────────────────────────────────────────────────────────────────────────────────────
// A glide: from a fix to a fix, starting at `start`, lasting `dur` ms.
const g = (o = {}) => ({ from: { cur: [50, 10], heading: 80 }, to: { cur: [51, 12], heading: 100 }, start: 1000, dur: 20000, ...o });
{
  const at = (t, o, r) => F.glide(g(o), t, r);
  deq(at(1000).cur, [50, 10], 'at the start: the old fix');
  assert.equal(at(1000).heading, 80, 'at the start: the old heading');
  assert.equal(at(1000).done, false, 'at the start the glide runs');
  const h = at(11000);
  near(h.cur[0], 50.5, 1e-9, 'halfway: latitude between the fixes'); near(h.cur[1], 11, 1e-9, 'halfway: longitude between the fixes');
  near(h.heading, 90, 1e-9, 'halfway: heading between');
  assert.equal(h.done, false);
  deq(at(21000).cur, [51, 12], 'at the end: exactly the new fix');
  assert.equal(at(21000).heading, 100); assert.equal(at(21000).done, true);
  deq(at(99999).cur, [51, 12], 'after the end: the new fix');
  deq(at(500).cur, [50, 10], 'before the start: not behind the old fix');
  // Never beyond the newest fix: no t, however large or odd, leaves the segment.
  for (const t of [-1e9, 0, 1000, 5000, 20999, 21000, 22000, 1e12]) {
    const p = at(t).cur;
    assert.ok(p[0] >= 50 && p[0] <= 51 && p[1] >= 10 && p[1] <= 12, 'time ' + t + ' stays between the fixes');
  }
  // Reduced motion: the new fix at once, even at the start.
  const r = at(1000, {}, true);
  deq(r.cur, [51, 12], 'reduced motion: the new fix at once'); assert.equal(r.heading, 100); assert.equal(r.done, true);
  // Heading turns the short way.
  const turn = F.glide(g({ from: { cur: [50, 10], heading: 350 }, to: { cur: [51, 12], heading: 10 } }), 11000);
  near(turn.heading, 0, 1e-9, '350 to 10 passes through 0, not 180');
  const q = F.glide(g({ from: { cur: [50, 10], heading: 350 }, to: { cur: [51, 12], heading: 10 } }), 6000).heading;
  near(q, 355, 1e-9, 'a quarter of the way: 355');
  near(F.glide(g({ from: { cur: [50, 10], heading: 10 }, to: { cur: [51, 12], heading: 350 } }), 6000).heading, 5, 1e-9, '10 to 350 turns back through 0');
  for (const t of [1000, 3000, 9000, 15000, 21000]) {
    const hd = F.glide(g({ from: { cur: [50, 10], heading: 350 }, to: { cur: [51, 12], heading: 10 } }), t).heading;
    assert.ok(hd >= 0 && hd < 360 || hd === 360, 'heading stays on the compass: ' + hd);
  }
  // A missing heading on either side takes the new fix's heading.
  assert.equal(F.glide(g({ from: { cur: [50, 10], heading: null } }), 11000).heading, 100, 'no old heading: the new one');
  assert.equal(F.glide(g({ to: { cur: [51, 12], heading: null } }), 11000).heading, null, 'no new heading: none');
  // Over the date line: the glide runs in continuous longitude, the short way.
  const dl = F.glide(g({ from: { cur: [50, 179], heading: 90 }, to: { cur: [50, -179], heading: 90 } }), 11000);
  near(dl.cur[1], -180, 1e-9, 'across the date line: halfway is at the date line (continuous with the new fix), not at 0');
  const dl2 = F.glide(g({ from: { cur: [50, 179], heading: 90 }, to: { cur: [50, 181], heading: 90 } }), 11000);
  near(dl2.cur[1], 180, 1e-9, 'across the date line, longitudes already continuous');
  near(F.glide(g({ from: { cur: [50, 181], heading: 90 }, to: { cur: [50, -177], heading: 90 } }), 11000).cur[1], -178, 1e-9, 'an old fix in the other turn: same place');
  deq(F.glide(g({ from: { cur: [50, 179], heading: 90 }, to: { cur: [50, -179], heading: 90 } }), 21000).cur, [50, -179], 'the end is the new fix as reported');
  // A missing new fix or old fix cannot crash it.
  assert.doesNotThrow(() => F.glide(g({ to: null }), 5000), 'no new fix: no crash');
  assert.equal(F.glide(g({ to: null }), 5000), null, 'no new fix: nothing to draw');
  // A zero or missing duration, or no old fix: the new fix at once.
  deq(F.glide(g({ dur: 0 }), 1000).cur, [51, 12], 'no duration: at once');
  deq(F.glide(g({ from: null }), 1000).cur, [51, 12], 'no old fix: at once');
  deq(F.glide(g({ dur: NaN }), 1000).cur, [51, 12], 'a bad duration: at once');
}

// ── the pure state step: F.track(state, view, ident, now, reduce) → {state, view, gliding} ───────────────────────────────
{
  const mk = (lon, heading = 90) => ({ key: 'a', cur: [50, lon], heading, trail: [[50, lon - 0.01]], route: [], destination: null, origin: null });
  const T = 1000;
  let r = F.track(null, mk(10), 'src|a', T, false);
  assert.equal(r.gliding, false, 'the first fix after opening does not glide');
  deq(r.view.cur, [50, 10], 'and is drawn as reported');
  // A poll with the same position and heading is not an update: it must not start the clock of the interval.
  r = F.track(r.state, mk(10), 'src|a', T + 1000, false);
  assert.equal(r.gliding, false, 'the same position again: no glide');
  r = F.track(r.state, mk(10), 'src|a', T + 5000, false);
  // The first real update has no earlier update to measure against: it is drawn as reported.
  r = F.track(r.state, mk(10.01), 'src|a', T + 20000, false);
  assert.equal(r.gliding, false, 'the first update: no glide, there is no interval yet');
  deq(r.view.cur, [50, 10.01]);
  assert.equal(r.state.interval, null, 'no interval measured yet');
  // The second update glides over the time between the two updates.
  r = F.track(r.state, mk(10.02), 'src|a', T + 40000, false);
  assert.equal(r.gliding, true, 'the second update glides'); assert.equal(r.state.interval, 20000, 'over the measured interval, kept in the state');
  deq(r.view.cur, [50, 10.01], 'it starts at the old fix');
  const r2 = F.track(r.state, mk(10.02), 'src|a', T + 50000, false);
  near(r2.view.cur[1], 10.015, 1e-9, 'halfway: between the fixes'); assert.equal(r2.gliding, true);
  assert.equal(r2.state.interval, 20000, 'a poll without a new fix keeps the interval');
  { const line = F.mapGeo(r2.view).trail.features[0].geometry.coordinates; near(line[line.length - 1][0], 10.015, 1e-9, 'the trail ends at the arrow'); }
  const r3 = F.track(r2.state, mk(10.02), 'src|a', T + 60000, false);
  assert.equal(r3.gliding, false, 'at the end the glide is over'); deq(r3.view.cur, [50, 10.02], 'exactly on the fix');
  // A new fix mid-glide glides from where the arrow is, over the time since the last update.
  const r4 = F.track(r2.state, mk(10.04), 'src|a', T + 50000, false);
  assert.equal(r4.gliding, true); near(r4.view.cur[1], 10.015, 1e-9, 'starts at the drawn position, not at the old fix');
  assert.equal(r4.state.interval, 10000, 'the interval is the time since the last update');
  // Reduced motion: the second update is drawn as reported.
  const j = F.track(F.track(F.track(null, mk(10), 'x', T, true).state, mk(10.01), 'x', T + 20000, true).state, mk(10.02), 'x', T + 40000, true);
  assert.equal(j.gliding, false, 'reduced motion: no glide'); deq(j.view.cur, [50, 10.02]);
  // Another flight: nothing glides across, the count starts again.
  const c = F.track(r3.state, mk(30), 'src|b', T + 61000, false);
  assert.equal(c.gliding, false, 'a change of flight is drawn as reported'); assert.equal(c.state.interval, null, 'and starts a new count');
  const c2 = F.track(c.state, mk(30.01), 'src|b', T + 70000, false);
  assert.equal(c2.gliding, false, 'its first update does not glide either');
  // No view: no state.
  const n = F.track(r3.state, null, null, T + 62000, false);
  assert.equal(n.view, null); assert.equal(n.state, null); assert.equal(n.gliding, false);
}

// ── jump instead of glide where a glide would show something untrue ────────────────────────────────────────────────────
{
  const mk = (lon, key = 'a') => ({ key, cur: [50, lon], heading: 90, trail: [[50, lon - 0.01]], route: [], destination: null, origin: null });
  const S = 10000, T = 5000;
  // A flight that has glided already: normal poll 10 s, the arrow at 10.02.
  const steady = () => {
    let r = F.track(null, mk(10), 'src|a', T, false);
    r = F.track(r.state, mk(10.01), 'src|a', T + S, false);
    r = F.track(r.state, mk(10.02), 'src|a', T + 2 * S, false);
    assert.equal(r.gliding, true, 'setup: the third fix glides'); assert.equal(r.state.interval, S);
    return F.track(r.state, mk(10.02), 'src|a', T + 3 * S, false);
  };
  // First fix after opening: drawn as reported.
  { const r = F.track(null, mk(10), 'src|a', T, false);
    assert.equal(r.gliding, false, 'first fix: no glide'); deq(r.view.cur, [50, 10]); }
  // Flight change: the new flight's fix is drawn at once, even with a long way between the two.
  { const r = steady(), c = F.track(r.state, mk(10.03, 'b'), 'src|b', T + 4 * S, false);
    assert.equal(c.gliding, false, 'flight change: no glide'); deq(c.view.cur, [50, 10.03]); }
  // A normal step glides; a gap of exactly 3 x the normal poll still does.
  { const r = steady(), g = F.track(r.state, mk(10.03), 'src|a', T + 5 * S, false);
    assert.equal(g.gliding, true, 'a gap of 3 x the normal poll still glides'); }
  // A gap over 3 x the normal poll: the new fix at once, and the normal poll is kept (not the gap).
  { const r = steady(), j = F.track(r.state, mk(10.03), 'src|a', T + 5 * S + 1, false);
    assert.equal(j.gliding, false, 'gap over 3 x the normal poll: jump'); deq(j.view.cur, [50, 10.03]);
    assert.equal(j.state.interval, S, 'the gap is not taken as the normal poll');
    const n = F.track(j.state, mk(10.04), 'src|a', T + 5 * S + 1 + S, false);
    assert.equal(n.gliding, true, 'the update after the jump glides again'); assert.equal(n.state.interval, S); }
  // A step longer than an aircraft could fly in that time (bad data): at once. 1 degree of longitude is 71 km in 10 s.
  { const r = steady(), j = F.track(r.state, mk(11.02), 'src|a', T + 4 * S, false);
    assert.equal(j.gliding, false, 'impossible step: jump'); deq(j.view.cur, [50, 11.02]);
    const n = F.track(j.state, mk(11.03), 'src|a', T + 5 * S, false);
    assert.equal(n.gliding, true, 'after the jump the next normal step glides'); }
  // Measured from where the arrow is drawn, not from the old fix: a mid-glide fix a short way on still glides.
  { const r = steady(), a = F.track(r.state, mk(10.03), 'src|a', T + 4 * S, false),
      b = F.track(a.state, mk(10.04), 'src|a', T + 4 * S + 5000, false);
    assert.equal(b.gliding, true, 'a normal step mid-glide glides'); }
  // Two updates close together are not an impossible step: a few km in 1 s (poll jitter) glides.
  { const r = steady(), a = F.track(r.state, mk(10.03), 'src|a', T + 4 * S, false),
      b = F.track(a.state, mk(10.06), 'src|a', T + 4 * S + 1000, false);
    assert.equal(b.gliding, true, '2 km in 1 s (jitter) glides'); }
}

// ── the view at a drawn position: the trail end and the Remaining route start follow the arrow ───────────────────────
const ALPHA = [50, 4], BETA = [50, 20];
const fl = (id, extra = {}) => ({
  id, flight_number: 'XY123', callsign: 'TST123', aircraft_registration: 'T-AAAA', tracked_type: 'live', on_ground: 0,
  latitude: 50, longitude: 12, altitude: 35000, ground_speed: 450, heading: 270, vertical_speed: 0,
  airline_short: 'Testair', airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB',
  airport_origin_name: 'Airport Alpha', airport_destination_name: 'Airport Beta',
  airport_origin_latitude: ALPHA[0], airport_origin_longitude: ALPHA[1],
  airport_destination_latitude: BETA[0], airport_destination_longitude: BETA[1],
  coordinates: [[49.8, 8], [49.9, 10]], ...extra,
});
const house = () => {
  const hass = { entities: {}, states: {}, calls: [], callService: (...a) => { hass.calls.push(a); return Promise.resolve(); } };
  hass.source = (id, flights) => {
    hass.entities = { ...hass.entities, [id]: { entity_id: id, platform: 'flightradar24', device_id: 'd' + id, translation_key: 'additional_tracked' } };
    hass.states = { ...hass.states, [id]: { entity_id: id, state: String(flights.length), attributes: { flights } } };
  };
  return hass;
};
// A flight that moved between two reads (the airborne rule needs an observed movement). Returns the time of the step.
const moving = (hass, flight, at = T0) => {
  hass.source('sensor.a', [flight]); F.airborne(hass, '', at);
  hass.source('sensor.a', [{ ...flight, latitude: flight.latitude + 0.05 }]); F.airborne(hass, '', at + MIN);
  return at + MIN;
};
{
  const hs = house(); const t = moving(hs, fl('w1'));
  const v = F.mapView(hs, 'sensor.a', 'w1', t);
  const drawn = [50.02, 11.5];
  const w = F.mapViewAt(v, drawn, 123);
  deq(w.cur, drawn, 'the arrow is at the drawn position'); assert.equal(w.heading, 123, 'and turned');
  deq(w.route[0], drawn, 'the Remaining route starts at the drawn position');
  deq(w.route[w.route.length - 1], v.route[v.route.length - 1], 'and still ends at the destination');
  const geo = F.mapGeo(w);
  const line = geo.trail.features[0].geometry.coordinates;
  deq(line[line.length - 1], [drawn[1], drawn[0]], 'the Flown trail ends at the drawn position');
  deq(geo.route.features[0].geometry.coordinates[0], [drawn[1], drawn[0]], 'the route layer starts there too');
  // When the newest trail point is the reported fix itself, the trail stops short of it while the arrow is behind it.
  const v2 = { ...v, trail: v.trail.concat([v.cur]) };
  const w2 = F.mapViewAt(v2, drawn, 123);
  const l2 = F.mapGeo(w2).trail.features[0].geometry.coordinates;
  deq(l2[l2.length - 1], [drawn[1], drawn[0]], 'the reported fix is not drawn ahead of the arrow');
  assert.ok(!l2.some((c) => c[0] === v.cur[1] && c[1] === v.cur[0]), 'the new fix is not in the trail yet');
  // At the fix itself the view is the reported one.
  deq(F.mapViewAt(v, v.cur, v.heading), v, 'at the reported fix nothing changes');
  assert.equal(F.mapViewAt(null, drawn, 1), null, 'no view, no view');
}

// Times here run 10 x slower than the polls of a real flight: one degree of longitude per 200 s stays below the speed limit.
// ── the element: the frame loop ─────────────────────────────────────────────────────────────────────────────────────
const fakeLf = () => {
  const lf = { size: { x: 480, y: 360 }, layers: [{ getTileUrl() {}, on(t, fn) { this.h = fn; }, load() { this.h && this.h(); } }],
    getSize() { return this.size; }, invalidateSize() {}, fitBounds() {},
    latLngToContainerPoint(ll) { return { x: 240 + ll[1] * 10, y: 180 + (50 - ll[0]) * 10 }; },
    eachLayer(fn) { this.layers.forEach((l) => fn(l)); } };
  ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard', 'tap'].forEach((x) => { lf[x] = { disable() {} }; });
  return lf;
};
const TANKEN = read('custom_components/casora/scripts/local/12-tanken.js');
const lfOf = vm.runInNewContext(TANKEN.match(/^\s*(var lfOf = function \(m\) \{.*\});\s*$/m)[1] + '; lfOf', {});
const mount = async (lf, hs, key = 'w1') => {
  ctx._casoraHaMap = { ok: () => true, defined: () => Promise.resolve(true), ml: () => null, lf: (el) => lfOf(el) };
  ctx.document.querySelector = () => ({ hass: hs });
  const host = fakeEl(); host._engine = { leafletMap: lf };
  ctx.document.createElement = () => host;
  ctx.document.createElementNS = (ns, tag) => svgEl(tag);
  const f = new (ctx.customElements.get('casora-flight-map'))();
  f.setAttribute('data-src', 'sensor.a'); f.setAttribute('data-key', key); f._conn = true;
  f.connectedCallback(); await Promise.resolve(); await Promise.resolve();
  return f;
};
const tick = () => clock.timers.filter((t) => t.live).forEach((t) => t.fn());
const runFrames = () => { const q = [...frames.queue.entries()]; frames.queue.clear(); q.forEach(([, fn]) => fn()); return q.length; };
const withClock = async (t0, fn) => {
  frames.queue.clear(); const real = Date.now; let now = t0; ctx.Date.now = () => now;
  try { return await fn((t) => { now = t; }); } finally { ctx.Date.now = real; }
};
const arrowAt = (f) => { const m = f._kids.find((k) => k.tag === 'svg').innerHTML.match(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="7"/); return m && [Number(m[1]), Number(m[2])]; };
const arrowTurn = (f) => Number(f._kids.find((k) => k.tag === 'svg').innerHTML.match(/rotate\(([\d.-]+)\)/)[1]);
const step = (hs, lon, extra = {}) => { hs.source('sensor.a', [fl('w1', { latitude: 50.05, longitude: lon, ...extra })]); F.airborne(hs, '', Date.now()); };

await withClock(T0, async (setNow) => {
  const hs = house(); const t = moving(hs, fl('w1'));
  setNow(t);
  const lf = fakeLf(); const f = await mount(lf, hs);
  tick(); lf.layers[0].load(); tick();
  assert.equal(frames.queue.size, 0, 'no glide yet (first position): no frame loop');
  deq(arrowAt(f), [360, 179.5], 'the first position is drawn as reported');

  // 200 s later a new fix arrives: the glide runs for the measured time between the updates (here 200 s after the first).
  setNow(t + 200000); step(hs, 13); tick();   // the first real update: there is no interval to glide over yet
  assert.equal(frames.queue.size, 0, 'the first update after opening does not glide');
  deq(arrowAt(f), [370, 179.5], 'the first update is drawn as reported');
  // Update two: measured interval 200 s. Now the third one, 200 s later; sample the glide.
  runFrames();
  setNow(t + 400000); step(hs, 14); tick();
  const x0 = arrowAt(f)[0];
  assert.equal(frames.queue.size, 1, 'one frame request at a time');
  setNow(t + 500000); runFrames();
  const xh = arrowAt(f)[0];
  assert.ok(xh > x0 && xh < 380, 'halfway through the glide the arrow is between the fixes (' + x0 + ' < ' + xh + ' < 380)');
  assert.equal(frames.queue.size, 1, 'still gliding: the loop goes on');
  setNow(t + 550000); runFrames();
  assert.ok(arrowAt(f)[0] > xh && arrowAt(f)[0] < 380, 'near the end it has not passed the fix');
  setNow(t + 600000); runFrames();
  assert.equal(arrowAt(f)[0], 380, 'at the end of the glide: exactly on the reported fix (14 E)');
  assert.equal(frames.queue.size, 0, 'the glide is over: the loop stops');
  // The ticks after it request nothing.
  setNow(t + 610000); tick();
  assert.equal(frames.queue.size, 0, 'no frames between glides');
});

// The Flown trail end and the Remaining route start follow the arrow during a glide.
await withClock(T0, async (setNow) => {
  const hs = house(); const t = moving(hs, fl('w1'));
  setNow(t);
  const lf = fakeLf(); const f = await mount(lf, hs);
  tick(); lf.layers[0].load(); tick();
  setNow(t + 200000); step(hs, 13); tick(); runFrames();
  setNow(t + 400000); step(hs, 14); tick();
  setNow(t + 500000); runFrames();
  const [ax, ay] = arrowAt(f);
  const html = f._kids.find((k) => k.tag === 'svg').innerHTML;
  assert.ok(ax > 370 && ax < 380, 'mid-glide x ' + ax);
  assert.ok(new RegExp(' L' + ax + ' ' + ay + '"[^>]*stroke-width="5"').test(html), 'the trail ends at the arrow, not at the fix');
  assert.ok(new RegExp('<path d="M' + ax + ' ' + ay + ' ').test(html), 'the Remaining route starts at the arrow');
});

// The element leaves the page mid-glide: the loop stops, and a pending frame draws nothing.
await withClock(T0, async (setNow) => {
  const hs = house(); const t = moving(hs, fl('w1'));
  setNow(t);
  const lf = fakeLf(); const f = await mount(lf, hs);
  tick(); lf.layers[0].load(); tick();
  setNow(t + 200000); step(hs, 13); tick(); runFrames();
  setNow(t + 400000); step(hs, 14); tick();
  assert.equal(frames.queue.size, 1, 'gliding');
  f._conn = false; f.disconnectedCallback();
  assert.equal(frames.queue.size, 0, 'removed: the pending frame is cancelled');
  setNow(t + 500000); assert.equal(runFrames(), 0, 'and nothing runs');
});

// Reduced motion: the arrow jumps, no loop at all.
await withClock(T0, async (setNow) => {
  reduce = true;
  const hs = house(); const t = moving(hs, fl('w1'));
  setNow(t);
  const lf = fakeLf(); const f = await mount(lf, hs);
  tick(); lf.layers[0].load(); tick();
  setNow(t + 200000); step(hs, 13); tick();
  setNow(t + 400000); step(hs, 14); tick();
  assert.equal(frames.queue.size, 0, 'reduced motion: no frame loop');
  deq(arrowAt(f), [380, 179.5], 'reduced motion: the arrow is on the new fix at once');
  reduce = false;
});

// The heading turns with the glide, the short way.
await withClock(T0, async (setNow) => {
  const hs = house(); const t = moving(hs, fl('w1', { heading: 350 }));
  setNow(t);
  const lf = fakeLf(); const f = await mount(lf, hs);
  tick(); lf.layers[0].load(); tick();
  setNow(t + 200000); step(hs, 13, { heading: 350 }); tick(); runFrames();
  setNow(t + 400000); step(hs, 14, { heading: 10 }); tick();
  setNow(t + 500000); runFrames();
  near(arrowTurn(f), 0, 0.2, 'halfway from 350 to 10 the arrow points north');
  setNow(t + 600000); runFrames();
  assert.equal(arrowTurn(f), 10, 'it ends on the reported heading');
});

// The MapLibre path glides too: the points source holds the arrow between the fixes, the trail and the route follow it.
await withClock(T0, async (setNow) => {
  const hs = house(); const t = moving(hs, fl('w1'));
  setNow(t);
  const ml = { sources: {}, layers: {}, handlers: {}, tiles: 0, isStyleLoaded: () => true, loaded: () => true,
    addSource(id, o) { this.sources[id] = { data: o.data, setData(d) { this.data = d; } }; }, getSource(id) { return this.sources[id]; },
    addLayer(o) { this.layers[o.id] = o; }, addImage() {}, fitBounds() {}, on(t, fn) { this.handlers[t] = fn; }, once() {}, resize() {}, jumpTo() {}, dragPan: { disable() {} } };
  ctx._casoraHaMap = { ok: () => true, defined: () => Promise.resolve(true), ml: () => ml };
  ctx.document.querySelector = () => ({ hass: hs });
  ctx.document.createElement = () => fakeEl();
  const f = new (ctx.customElements.get('casora-flight-map'))();
  f.setAttribute('data-src', 'sensor.a'); f.setAttribute('data-key', 'w1'); f._conn = true;
  f.connectedCallback(); await Promise.resolve(); await Promise.resolve();
  tick(); ml.handlers.data({ tile: { state: 'loaded' } }); tick();
  const arrow = () => ml.sources['casora-flight-points'].data.features.find((x) => x.properties.role === 'aircraft');
  deq(arrow().geometry.coordinates, [12, 50.05], 'MapLibre: the first position as reported');
  setNow(t + 200000); step(hs, 13); tick(); runFrames();
  setNow(t + 400000); step(hs, 14); tick();
  setNow(t + 500000); runFrames();
  near(arrow().geometry.coordinates[0], 13.5, 1e-9, 'MapLibre: halfway the arrow is between the fixes');
  const trail = ml.sources['casora-flight-trail'].data.features[0].geometry.coordinates;
  near(trail[trail.length - 1][0], 13.5, 1e-9, 'MapLibre: the trail ends at the arrow');
  near(ml.sources['casora-flight-route'].data.features[0].geometry.coordinates[0][0], 13.5, 1e-9, 'MapLibre: the route starts at the arrow');
  setNow(t + 600000); runFrames();
  deq(arrow().geometry.coordinates, [14, 50.05], 'MapLibre: ends on the fix');
  assert.equal(frames.queue.size, 0, 'MapLibre: the loop stops');
});

// A frame of a glide does not build the view again (F.mapView runs once per poll), and a failing matchMedia means no reduced motion.
await withClock(T0, async (setNow) => {
  const hs = house(); const t = moving(hs, fl('w1'));
  setNow(t);
  const lf = fakeLf(); const f = await mount(lf, hs);
  tick(); lf.layers[0].load(); tick();
  setNow(t + 200000); step(hs, 13); tick();
  setNow(t + 400000); step(hs, 14); tick();
  const real = F.mapView; let calls = 0; F.mapView = (...a) => { calls++; return real(...a); };
  setNow(t + 450000); runFrames(); setNow(t + 500000); runFrames(); setNow(t + 550000); runFrames();
  F.mapView = real;
  assert.equal(calls, 0, 'the frames reuse the poll\'s view');
  const mm = ctx.matchMedia; ctx.matchMedia = () => { throw new Error('no media'); };
  setNow(t + 560000); assert.doesNotThrow(() => runFrames(), 'a failing matchMedia does not break the frame');
  ctx.matchMedia = mm;
});
console.log('flights_glide: ok');
