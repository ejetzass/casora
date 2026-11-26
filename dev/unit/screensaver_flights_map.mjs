// @deckt: custom_components/casora/scripts/local/46-screensaver.js#mount,html,DRAW,liveMap,mountKeepingMap
// The Flights screensaver's map layout shows the HA map (the casora-flight-map element of 49-flights.js) and keeps that
// element across the saver's redraws: the same flight and layout keep the same element (no flicker, no tile reload, no
// jump back to the drawn picture); a new flight or another layout drops it; destroy removes it. The saver's own HTML has
// no <img>, <image>, <link> or URL; the map element is the only way a map comes in. Controlled clock; no browser.
//   node dev/unit/screensaver_flights_map.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const FLIGHTS_SRC = read('custom_components/casora/scripts/local/49-flights.js');
const SAVER_SRC = read('custom_components/casora/scripts/local/46-screensaver.js');
const TURN = 300000;
const SLOT0 = Math.floor(Date.UTC(2026, 10, 18, 12, 0, 0) / (2 * TURN)) * 2 * TURN;
const SRC = 'sensor.fr24';
const MAP_TAG = /<casora-flight-map\b[^>]*><\/casora-flight-map>/;

// A tiny page: the saver's host holds one scene; the scene is raw HTML text around at most one map element. This is as
// much DOM as the saver's keep rule needs (querySelector, parentNode, siblings, removeChild, insertAdjacentHTML).
class Node_ { constructor(raw) { this.raw = raw; this.parentNode = null; } }
class MapEl {
  constructor(tag) { this.tag = tag; this.parentNode = null; this.connected = true; this.attrs = {};
    tag.replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { this.attrs[k] = v; }); }
  get previousSibling() { const k = this.parentNode.children; return k[k.indexOf(this) - 1] || null; }
  get nextSibling() { const k = this.parentNode.children; return k[k.indexOf(this) + 1] || null; }
  insertAdjacentHTML(where, html) {
    assert.equal(where, 'beforebegin');
    const k = this.parentNode.children, n = new Node_(html); n.parentNode = this.parentNode; k.splice(k.indexOf(this), 0, n);
  }
  get outer() { return this.tag; }
}
class Scene {
  constructor(open, parts) { this.open = open; this.children = parts; parts.forEach((p) => { p.parentNode = this; }); this.style = { setProperty() {} }; }
  removeChild(c) { this.children.splice(this.children.indexOf(c), 1); c.parentNode = null; if (c instanceof MapEl) c.connected = false; }
  get outer() { return this.open + this.children.map((c) => c.outer || c.raw).join('') + '</div>'; }
}
const makeHost = () => {
  const host = {
    isConnected: true, scene: null, created: [],
    getRootNode: () => doc,
    get firstElementChild() { return host.scene; },
    querySelector: (sel) => (sel === 'casora-flight-map' && host.scene ? host.scene.children.find((c) => c instanceof MapEl) || null : null),
    get innerHTML() { return host.scene ? host.scene.outer : ''; },
    set innerHTML(html) {
      host.scene && host.scene.children.forEach((c) => { if (c instanceof MapEl) c.connected = false; });
      if (!html) { host.scene = null; return; }
      const open = html.slice(0, html.indexOf('>') + 1), m = html.match(MAP_TAG);
      const body = html.slice(open.length, html.length - '</div>'.length);
      let parts;
      if (m) { const el = new MapEl(m[0]); host.created.push(el); const i = body.indexOf(m[0]); parts = [new Node_(body.slice(0, i)), el]; assert.equal(body.slice(i + m[0].length), '', 'the map element is the last child'); }
      else parts = [new Node_(body)];
      host.scene = new Scene(open, parts);
    },
  };
  return host;
};
const doc = { nodeType: 1, getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} } };

const entry = (id, step, o = {}) => ({
  id, flight_number: 'XY' + id, callsign: 'XYZ' + id, tracked_type: 'live', on_ground: 0,
  latitude: 50.2 + 0.01 * step, longitude: 10.1 + 0.02 * step, altitude: 35000, ground_speed: 450, heading: 90, vertical_speed: -500,
  airline: 'Example Air', aircraft_model: 'Type 100', aircraft_registration: 'AB-CDE',
  airport_origin_name: 'Airport A', airport_origin_latitude: 50, airport_origin_longitude: 4,
  airport_destination_name: 'Airport B', airport_destination_latitude: 52, airport_destination_longitude: 20,
  time_scheduled_arrival: SLOT0 / 1000 + 5400, time_estimated_arrival: SLOT0 / 1000 + 5000, coordinates: [[50, 4], [50.1, 5]], ...o,
});
const runtime = ({ withMap }) => {
  const conn = { addEventListener() {} };
  const box = {
    console, Intl, Date, Math, parseFloat, isFinite, isNaN, parseInt, String, Number, JSON, Array, Object, Promise, Set, Map, Error, RegExp,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, location: { search: '', pathname: '/' }, addEventListener() {},
    localStorage: { getItem: () => null, setItem() {} }, HTMLElement: class {},
    // The map element's class is not needed here (its own test is flights_map_saver.mjs): only whether it is defined.
    customElements: { get: (n) => (withMap && n === 'casora-flight-map' ? class {} : undefined), define() {} },
    casoraLocale: () => 'en-US',
  };
  box.window = box; box.document = doc;
  vm.createContext(box);
  vm.runInContext(FLIGHTS_SRC, box);
  vm.runInContext(SAVER_SRC, box);
  const R = { S: box._casoraSaver, clock: { t: SLOT0 + 1000 }, step: 0, flights: (s) => [entry('1', s)], host: makeHost() };
  R.hass = { config: { time_zone: 'Europe/Amsterdam' }, locale: { time_format: '24' }, themes: { darkMode: true }, connection: conn,
    entities: { [SRC]: { platform: 'flightradar24', translation_key: 'additional_tracked', device_id: 'd1' } }, devices: { d1: { name: 'Tracker' } },
    states: {} };
  const put = (s, flights) => { R.hass.states[SRC] = { state: '1', attributes: { flights: flights || R.flights(s) } }; };
  R.put = put;
  R.api = R.S.mount(R.host, null, { every: 3600000, kind: () => 'flights',
    context: () => ({ hass: R.hass, vars: {}, now: new Date(R.clock.t) }) });
  R.draw = (ms, s, flights) => { R.clock.t = ms; put(s, flights); R.api.update(); return R.host.innerHTML; };
  put(0); R.api.update(); // the first sight is a baseline
  return R;
};

// ── The map layout carries the map element; the drawn picture and the text stay ──────────────────────────────────────
{
  const R = runtime({ withMap: true });
  const h = R.draw(SLOT0 + 1000, 1);
  assert.match(h, MAP_TAG, 'the map layout has the map element');
  const tag = h.match(MAP_TAG)[0];
  assert.match(tag, /data-src="sensor\.fr24"/, 'it reads its flight from the source');
  assert.match(tag, /data-key="1"/, 'and the flight ID');
  assert.match(tag, /data-saver/, 'it knows it is the saver map (dark look, no pointer input)');
  assert.match(h, /cs-fl-pic/, 'the drawn picture is still there: it is the fallback under the map');
  assert.match(h, /cs-fl-stat/, 'the figures stay');
  assert.ok(h.indexOf('<casora-flight-map') > h.indexOf('cs-fl-pic'), 'the map element comes after the picture, so it covers it');
  assert.ok(h.endsWith(tag + '</div>'), 'it is the last child of the scene (the keep rule relies on that)');
}
{
  const R = runtime({ withMap: false });
  const h = R.draw(SLOT0 + 1000, 1);
  assert.ok(!/casora-flight-map/.test(h), 'no map element defined (no 49-flights map): today\'s drawn picture only');
  assert.match(h, /cs-fl-pic/);
}

// ── No external content: the saver's own HTML has no image, link or URL; the map element is the only map door ────────
{
  const R = runtime({ withMap: true });
  const h = R.draw(SLOT0 + 1000, 1);
  const rest = h.replace(MAP_TAG, '');
  assert.ok(!/https?:|url\(|<img|<image|ha-map|maplibre|<link|<iframe|<script/i.test(rest), 'without the map element: no external content');
  assert.ok(!/\s(src|href|srcset|style)=/i.test(h.match(MAP_TAG)[0]), 'the map element itself carries no src, href or style');
  assert.ok(!/https?:/i.test(h), 'no URL anywhere');
}

// ── Updates keep the same element for the same flight and layout ─────────────────────────────────────────────────────
{
  const R = runtime({ withMap: true });
  R.draw(SLOT0 + 1000, 1);
  const el = R.host.querySelector('casora-flight-map');
  assert.ok(el, 'the map element is in the page');
  const first = R.host.created.length;
  let prev = R.host.innerHTML;
  for (let i = 2; i <= 6; i++) {
    const h = R.draw(SLOT0 + 1000 * i, i);
    assert.equal(R.host.querySelector('casora-flight-map'), el, 'update ' + i + ': the same element object stays');
    assert.equal(el.connected, true, 'and it was never taken out of the page');
    assert.notEqual(h, prev, 'update ' + i + ': the drawn parts changed (the flight moved)');
    prev = h;
  }
  assert.equal(R.host.created.length, first, 'no new map element was made across five updates');
  // The text and the drawn picture did follow the moving flight (the text is part of the redraw).
  const a = R.host.innerHTML;
  R.draw(SLOT0 + 7000, 9);
  assert.notEqual(R.host.innerHTML, a, 'the scene itself did change');
  assert.equal(R.host.querySelector('casora-flight-map'), el, 'still the same element');
  assert.equal(R.host.firstElementChild.children.filter((c) => c instanceof MapEl).length, 1, 'exactly one map element');
  assert.equal(R.host.firstElementChild.children[R.host.firstElementChild.children.length - 1], el, 'and it is still last');
}

// ── A new flight rebuilds it; so does leaving the layout; destroy removes it ─────────────────────────────────────────
{
  const R = runtime({ withMap: true });
  R.draw(SLOT0 + 1000, 1);
  const el = R.host.querySelector('casora-flight-map');
  R.draw(SLOT0 + 2000, 2, [entry('1', 2), entry('777', 2)]); // the new flight is only a baseline at first
  R.draw(SLOT0 + 3000, 3, [entry('777', 3)]);
  const el2 = R.host.querySelector('casora-flight-map');
  assert.ok(el2 && el2 !== el, 'a new flight: a new map element');
  assert.equal(el.connected, false, 'the old one left the page');
  R.api.destroy();
  assert.equal(R.host.querySelector('casora-flight-map'), null, 'destroy: no map element left');
  assert.equal(el2.connected, false, 'destroy: it left the page');
}
{
  // Another layout (the details turn) drops the map element: „mix“ with Flights and one more kind turns over the layout.
  const R = runtime({ withMap: true });
  R.draw(SLOT0 + 1000, 1);
  const el = R.host.querySelector('casora-flight-map');
  const html = R.S.html('flights', { now: new Date(SLOT0), turn: 1, hass: R.hass, vars: {}, flights: [R.S.flightRows(R.hass, {}, SLOT0 + 1000)[0]] });
  assert.ok(!MAP_TAG.test(html), 'the details layout has no map element');
  R.host.innerHTML = html; // what the saver does for a changed layout
  assert.equal(el.connected, false, 'the map element is gone with the layout');
}

// ── Only the scene's opening tag changes (dark to light): the element is rebuilt, as documented ──────────────────────
{
  const R = runtime({ withMap: true });
  R.draw(SLOT0 + 1000, 1);
  const el = R.host.querySelector('casora-flight-map');
  R.hass.themes.darkMode = false;
  const h = R.draw(SLOT0 + 2000, 2);
  assert.ok(!/cs-dark/.test(h), 'precondition: the scene tag changed');
  const el2 = R.host.querySelector('casora-flight-map');
  assert.ok(el2 && el2 !== el, 'another scene tag: a new map element');
  assert.equal(el.connected, false, 'the old one left the page');
}

// ── A kept element that already failed stays hidden for the same flight; the drawn picture stays ─────────────────────
{
  const R = runtime({ withMap: true });
  R.draw(SLOT0 + 1000, 1);
  const el = R.host.querySelector('casora-flight-map');
  el.style = { display: 'none' }; // what the element does when its map failed
  for (let i = 2; i <= 4; i++) {
    const h = R.draw(SLOT0 + 1000 * i, i);
    assert.equal(R.host.querySelector('casora-flight-map'), el, 'the failed element is kept, not retried');
    assert.equal(el.style.display, 'none', 'and stays hidden');
    assert.match(h, /cs-fl-pic/, 'the drawn picture is still there');
    assert.match(h, /cs-fl-stat/, 'and the figures');
  }
}

// ── The live map's box sits between the header text and the figures at every width ───────────────────────────────────
// The header can be tall: on a narrow box the clock stands over the flight (column), and the flight number may take two lines.
// Worst case in saver units: top 58, clock 92 + 12 + date 30, gap 34 (narrow only), flight number 2 x 84 + 12, route line 38.
// The figures: bottom 120, two lines of 30 x 1.2 when the line wraps (it does on a phone).
{
  const R = runtime({ withMap: true });
  const css = R.S.CSS; // sizes are in cqmin: u(n) = n / 8.2
  const toU = (txt) => Number(/([\d.]+)cqmin/.exec(txt)[1]) * 8.2;
  const rule = (txt, atNarrow) => {
    const block = atNarrow ? css.slice(css.indexOf('@container (aspect-ratio < 1)')) : css.slice(0, css.indexOf('@container (aspect-ratio < 1.45)'));
    const m = /\.cs-sv \.cs-fl-live\{([^}]*)\}/g; let last = null, x;
    while ((x = m.exec(block))) if (new RegExp(txt).test(x[1])) last = x[1];
    return last || (atNarrow ? rule(txt, false) : null); // a narrow box keeps the wide rule's value unless it sets its own
  };
  const top = (n) => toU(/top:([\d.]+cqmin)/.exec(rule('top:', n))[1]), bottom = (n) => toU(/bottom:([\d.]+cqmin)/.exec(rule('bottom:', n))[1]);
  const headBottomWide = 58 + 2 * 84 + 12 + 38, headBottomNarrow = 58 + (92 + 12 + 30) + 34 + 2 * 84 + 12 + 38, figures = 120 + 2 * 36;
  assert.ok(top(false) >= headBottomWide + 10, 'wide: the map starts below the header (' + top(false) + ' >= ' + (headBottomWide + 10) + ')');
  assert.ok(top(true) >= headBottomNarrow + 10, 'narrow: the map starts below the header, which is taller (' + top(true) + ' >= ' + (headBottomNarrow + 10) + ')');
  assert.ok(bottom(false) >= figures + 10 && bottom(true) >= figures + 10, 'the map ends above the figures, also when they wrap');
}

console.log('ok screensaver_flights_map');
