// The Flights saver's globe files load late: only when Globe is on and the saver shows a flight, only from the integration's
// own assets/globe/, never from the internet. Until they have arrived, or when they cannot be read, the saver shows the flat
// map with no error text, and a new try comes with the next screensaver start.
//   node dev/unit/screensaver_globe_load.mjs
// @deckt: custom_components/casora/scripts/local/46-screensaver.js#mount,globeLoad,loadScript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const FLIGHTS_SRC = read('custom_components/casora/scripts/local/49-flights.js');
const SAVER_SRC = read('custom_components/casora/scripts/local/46-screensaver.js');
const ASSETS = 'custom_components/casora/assets/globe/';
const TURN = 300000;
const SLOT0 = Math.floor(Date.UTC(2026, 10, 18, 12, 0, 0) / (2 * TURN)) * 2 * TURN;
const SRC = 'sensor.fr24';
const doc = { nodeType: 1, getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} } };
const flight = { id: '1', flight_number: 'XY1', callsign: 'XYZ1', tracked_type: 'live', on_ground: 0, latitude: 50.2, longitude: 10.1, altitude: 35000,
  ground_speed: 450, heading: 90, vertical_speed: -500, airline: 'Example Air', aircraft_model: 'Type 100', aircraft_registration: 'AB-CDE',
  airport_origin_name: 'Airport A', airport_origin_latitude: 50, airport_origin_longitude: 4,
  airport_destination_name: 'Airport B', airport_destination_latitude: 52, airport_destination_longitude: 20,
  time_scheduled_arrival: SLOT0 / 1000 + 5400, time_estimated_arrival: SLOT0 / 1000 + 5000, coordinates: [[50, 4], [50.1, 5]] };

// One page. `files` decides what the late requests find: a file name from assets/globe/ → its text; absent → 404.
const page = (files) => {
  const box = {
    console, Intl, Date, Math, parseFloat, isFinite, isNaN, parseInt, String, Number, JSON, Array, Object, Promise, Set, Map, Error, RegExp,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, location: { search: '', pathname: '/' }, addEventListener() {},
    localStorage: { getItem: () => null, setItem() {} }, HTMLElement: class {}, customElements: { get: () => undefined, define() {} },
    casoraLocale: () => 'en-US',
  };
  box.window = box; box.document = doc;
  box.requests = [];
  box.fetch = async (url) => {
    box.requests.push(url);
    const name = String(url).replace('/casora_assets/globe/', '');
    return files[name] == null ? { ok: false, status: 404, json: async () => { throw new Error('404'); } } : { ok: true, status: 200, json: async () => JSON.parse(files[name]) };
  };
  vm.createContext(box);
  vm.runInContext(FLIGHTS_SRC, box);
  vm.runInContext(SAVER_SRC, box);
  const S = box._casoraSaver;
  // What import(url) does in the browser: run the file as a script. Here the same real file runs in the page's context.
  S.loadScript = async (url) => {
    box.requests.push(url);
    const name = String(url).replace('/casora_assets/globe/', '');
    if (files[name] == null) throw new Error('404 ' + url);
    vm.runInContext(files[name], box);
  };
  const R = { box, S, clock: SLOT0 + 1000, vars: {}, hass: {
    config: { time_zone: 'Europe/Amsterdam' }, locale: { time_format: '24' }, themes: { darkMode: true }, connection: { addEventListener() {} },
    entities: { [SRC]: { platform: 'flightradar24', translation_key: 'additional_tracked', device_id: 'd1' } }, devices: { d1: { name: 'Tracker' } },
    states: { [SRC]: { state: '1', attributes: { flights: [flight] } } } } };
  R.host = { isConnected: true, firstElementChild: null, getRootNode: () => doc, innerHTML: '' };
  R.start = () => { R.api = S.mount(R.host, null, { every: 3600000, kind: () => 'flights', context: () => ({ hass: R.hass, vars: R.vars, now: new Date(R.clock) }) }); R.api.update(); // the first sight of a flight is a baseline; it shows once it has moved
    R.clock += 1000; R.hass.states[SRC] = { state: '1', attributes: { flights: [{ ...flight, latitude: 50.21, longitude: 10.12 }] } }; R.api.update(); return R; };
  return R;
};
const all = Object.fromEntries(['d3-array.min.js', 'd3-geo.min.js', 'topojson-client.min.js', 'land-110m.json'].map((n) => [n, read(ASSETS + n)]));
const settle = () => new Promise((r) => setImmediate(r));
const ERROR_TEXT = /error|fehler|failed|could not|konnte/i;

// Flat (the default): nothing is requested, ever.
{
  const R = page(all).start();
  await settle(); R.api.update(); await settle();
  assert.deepEqual(R.box.requests, [], 'Flat: no file is loaded');
  assert.match(R.host.innerHTML, /cs-fl-svg/, 'the flat map is drawn');
}

// Globe: the files come one after the other from assets/globe/ (d3-array before d3-geo, which needs it), then the land.
{
  const R = page(all); R.vars = { casora_flights_map: 'globe' }; R.start();
  const flat = R.host.innerHTML;
  assert.match(flat, /cs-fl-svg/, 'until the files are there: the flat map');
  await settle();
  assert.deepEqual(R.box.requests, ['d3-array.min.js', 'd3-geo.min.js', 'topojson-client.min.js', 'land-110m.json'].map((n) => '/casora_assets/globe/' + n));
  assert.ok(R.box.requests.every((u) => u.startsWith('/casora_assets/globe/')), 'nothing comes from the internet');
  assert.equal(R.S.globeReady(), true, 'the files are ready');
  R.api.update(); await settle();
  assert.equal(R.box.requests.length, 4, 'ready once: no second load');
}

// Not loaded while Globe is on but the saver shows no flight (the kind is another).
{
  const R = page(all); R.vars = { casora_flights_map: 'globe' };
  R.api = R.S.mount(R.host, null, { every: 3600000, kind: () => 'himmel', context: () => ({ hass: R.hass, vars: R.vars, now: new Date(R.clock) }) });
  R.api.update(); await settle();
  assert.deepEqual(R.box.requests, [], 'Globe on, another kind on show: nothing loaded');
}

// A file that fails to load, or is missing: flat map, no error text, no retry until the next start; the next start tries again.
for (const [what, files] of [['a script fails', { ...all, 'd3-geo.min.js': undefined }], ['the land is missing', { ...all, 'land-110m.json': undefined }]]) {
  const R = page(files); R.vars = { casora_flights_map: 'globe' }; R.start();
  const flat = R.host.innerHTML;
  await settle();
  const first = R.box.requests.length;
  assert.ok(first > 0, what + ': it tried');
  assert.equal(R.S.globeReady(), false, what + ': not ready');
  R.api.update(); await settle();
  assert.equal(R.host.innerHTML, flat, what + ': still the flat map');
  assert.ok(!ERROR_TEXT.test(R.host.innerHTML.replace(/<[^>]+>/g, ' ').replace(/Unreported|Remaining/g, '')), what + ': no error text');
  assert.equal(R.box.requests.length, first, what + ': no new try while this screensaver runs');
  R.api.destroy();
  R.start(); await settle(); // the next screensaver start
  assert.ok(R.box.requests.length > first, what + ': a new start tries again');
}
console.log('screensaver_globe_load: ok');
