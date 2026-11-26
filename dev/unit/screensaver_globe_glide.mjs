// The globe turns smoothly with the aircraft: its centre glides along the great circle from the old reported position to the new
// one (the popup arrow's rules from 49-flights.js F.track: one poll behind, ends on the reported position, jumps on a long gap, an
// impossible step and with reduced motion). Frames run only while a glide runs. A fake clock and a fake requestAnimationFrame.
//   node dev/unit/screensaver_globe_glide.mjs
// @deckt: custom_components/casora/scripts/local/46-screensaver.js#mount,globeStep,globeFrame,DRAW
import assert from 'node:assert/strict';
import { page, globeFiles, settle, SLOT0 } from './lib/globe_page.mjs';

const POLL = 60000;
// A page with a fake clock (Date.now and new Date()), a frame queue, and a host whose globe box can be written in place.
const start = async ({ reduce = false } = {}) => {
  const R = page(globeFiles());
  R.vars = { casora_flights_map: 'globe' };
  R.clock = SLOT0 + 1000;
  const RealDate = Date;
  R.box.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [R.clock])); } static now() { return R.clock; } };
  R.frames = []; R.cancelled = [];
  R.box.requestAnimationFrame = (cb) => { R.frames.push(cb); return R.frames.length; };
  R.box.cancelAnimationFrame = (id) => { R.cancelled.push(id); R.frames[id - 1] = null; };
  R.box.matchMedia = () => ({ matches: reduce });
  R.globe = { innerHTML: '' };
  // Writing the host's html replaces the globe box with a new one, as in a page.
  let whole = ''; Object.defineProperty(R.host, 'innerHTML', { get: () => whole, set: (h) => { whole = h; R.globe.innerHTML = ''; } });
  R.host.querySelector = (sel) => (sel === '.cs-fl-globe' ? R.globe : null);
  R.kind = 'flights';
  R.pending = () => R.frames.filter(Boolean).length;
  // One animation frame: the oldest waiting callback runs with the clock `ms` later.
  R.frame = (ms) => { R.clock += ms; const i = R.frames.findIndex(Boolean); const cb = R.frames[i]; R.frames[i] = null; cb(R.clock); };
  R.move = (lat, lon, after) => { R.clock += after; R.hass.states[R.SRC] = { state: '1', attributes: { flights: [{ ...R.flight, latitude: lat, longitude: lon }] } }; R.api.update(); };
  R.SRC = 'sensor.fr24';
  R.api = R.S.mount(R.host, null, { every: 3600000, kind: () => R.kind, context: () => ({ hass: R.hass, vars: R.vars, now: new Date(R.clock) }) });
  R.api.update(); // the first sight of a flight is a baseline; it shows once it has moved
  R.move(50.201, 10.101, 1000);
  await settle(); R.api.update(); // the files have loaded: the globe's first picture is the baseline of the glide
  R.move(50.21, 10.12, 1000); // the first real update: drawn as reported, no glide
  return R;
};
// Where the globe is centred: the arrival airport's dot sits where the projection puts it, so read the centre back from that dot.
const dotOf = (html) => { const m = /<circle class="cs-gl-ap" cx="([\d.]+)" cy="([\d.]+)"/g; let last; for (let x; (x = m.exec(html));) last = [+x[1], +x[2]]; return last; };
const shownHtml = (R) => R.globe.innerHTML || R.host.innerHTML;
const centred = (R, cur, what) => {
  const want = R.S.globeProjection({ cur })([20, 52]), got = dotOf(shownHtml(R));
  assert.ok(got && Math.hypot(got[0] - want[0], got[1] - want[1]) < 0.05, what + ': the globe is centred on ' + cur.map((x) => x.toFixed(4)) + ' (dot at ' + got + ', expected ' + want.map((x) => x.toFixed(2)) + ')');
};
const between = (R, a, b, t) => { const lerp = R.box.d3.geoInterpolate([a[1], a[0]], [b[1], b[0]])(t); return [lerp[1], lerp[0]]; };

const P1 = [50.21, 10.12], P2 = [50.35, 10.27], P3 = [50.49, 10.42]; // about 20 km apart: a minute of flight

// A new position: the centre moves part way at the middle of the glide and lands exactly on the new position at the end.
{
  const R = await start();
  centred(R, P1, 'before the glide'); assert.equal(R.pending(), 0, 'no frames while nothing moves');
  R.move(P2[0], P2[1], POLL);
  centred(R, P1, 'at the start of the glide (one poll behind, no jump)');
  assert.equal(R.pending(), 1, 'a frame is asked for while the glide runs');
  R.frame(POLL / 2);
  const mid = between(R, P1, P2, 0.5);
  centred(R, mid, 'at mid-glide, on the great circle');
  assert.ok(Math.abs(mid[0] - P1[0]) > 0.05 && Math.abs(mid[0] - P2[0]) > 0.05, 'part way: neither at the old nor at the new position');
  assert.equal(R.pending(), 1, 'the next frame is asked for');
  R.frame(POLL / 2);
  centred(R, P2, 'at the end of the glide, exactly on the reported position');
  assert.equal(R.pending(), 0, 'the loop stops when the glide ends');
  R.move(P3[0], P3[1], 0); // a minute after the last update: the glide takes that minute
  R.frame(POLL / 4);
  centred(R, between(R, P2, P3, 0.25), 'the next glide runs from the last reported position');
  R.move(P3[0], P3[1], POLL / 4); // the same position again (an altitude change): not an update, the glide goes on
  assert.equal(R.pending(), 1, 'a poll without a new position does not stop or restart the glide');
}

// A step no aircraft could fly (bad data) and a long gap: the new position at once, no frames.
{
  const R = await start();
  R.move(P2[0], P2[1], POLL); R.frame(POLL);                  // a normal poll sets the interval
  R.move(55, 10.32, POLL);                                     // 500 km in a minute
  centred(R, [55, 10.32], 'an impossible step jumps'); assert.equal(R.pending(), 0, 'and starts no glide');
  const G = await start();
  G.move(P2[0], P2[1], POLL);
  G.move(P3[0], P3[1], 3.2 * POLL);                            // more than 3 x the normal poll (and still in the same Flights turn)
  centred(G, P3, 'a long gap jumps'); assert.equal(G.pending(), 0, 'and starts no glide');
}

// Reduced motion: the globe moves in steps, as the popup arrow does.
{
  const R = await start({ reduce: true });
  R.move(P2[0], P2[1], POLL);
  centred(R, P2, 'reduced motion jumps'); assert.equal(R.pending(), 0, 'and asks for no frames');
}

// Frames come at most 10 times a second: a glide that is asked for a frame every 16 ms redraws only about every 100 ms, and still
// ends exactly on the reported position.
{
  const R = await start();
  R.move(P2[0], P2[1], POLL);
  let draws = 0, tries = 0;
  const count = () => { Object.defineProperty(R.globe, 'innerHTML', { configurable: true, get: () => R.globe._h || '', set: (h) => { R.globe._h = h; draws++; } }); };
  count();
  const t0 = R.clock;
  while (R.pending() && R.clock - t0 < POLL + 2000 && tries < 20000) { R.frame(16); tries++; }
  assert.ok(tries > 3000, 'the loop kept asking for frames: ' + tries);
  assert.ok(draws < tries / 4, 'frames 16 ms apart do not all redraw (' + draws + ' draws in ' + tries + ' frames)');
  assert.ok(draws >= (POLL / 100) * 0.8 && draws <= POLL / 100 + 3, 'about 10 draws a second (' + draws + ' in a minute)');
  assert.equal(R.pending(), 0, 'the loop stops when the glide ends');
  centred(R, P2, 'after many small frames, exactly on the reported position');
}

// The loop ends with the saver and with the kind or the flight on show.
{
  const R = await start();
  R.move(P2[0], P2[1], POLL);
  assert.equal(R.pending(), 1);
  R.api.destroy();
  assert.equal(R.pending(), 0, 'unmount: the waiting frame is cancelled');
  const before = R.host.innerHTML + R.globe.innerHTML;
  R.clock += 1000;
  assert.equal(R.pending(), 0, 'and no new one is asked for');
  assert.equal(R.host.innerHTML + R.globe.innerHTML, before + '', 'nothing is drawn after the unmount');
  const K = await start();
  K.move(P2[0], P2[1], POLL);
  K.kind = 'wort'; K.api.update();
  assert.equal(K.pending(), 0, 'another kind on show: the frame is cancelled');
  const F = await start();
  F.move(P2[0], P2[1], POLL);
  F.hass.states[F.SRC] = { state: '1', attributes: { flights: [{ ...F.flight, id: '2', flight_number: 'XY2', callsign: 'XYZ2', latitude: 40, longitude: 0 }] } };
  F.api.update();
  assert.equal(F.pending(), 0, 'another flight on show: the frame is cancelled');
  // A frame that was already running when the host left the page does not draw and does not ask again.
  const H = await start();
  H.move(P2[0], P2[1], POLL);
  H.host.isConnected = false;
  const was = H.globe.innerHTML;
  H.frame(1000);
  assert.equal(H.globe.innerHTML, was, 'a box that left the page is not drawn');
  assert.equal(H.pending(), 0, 'and asks for no more frames');
}
console.log('screensaver_globe_glide: ok');
