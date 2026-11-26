// A tiny page around the Flights saver for the globe tests: the real 49-flights.js and 46-screensaver.js run in one context with a
// controlled clock, one live flight, a host that is plain text, and a loadScript that runs the real files of assets/globe/ there.
import fs from 'node:fs';
import vm from 'node:vm';

export const read = (p) => fs.readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const FLIGHTS_SRC = read('custom_components/casora/scripts/local/49-flights.js');
const SAVER_SRC = read('custom_components/casora/scripts/local/46-screensaver.js');
export const ASSETS = 'custom_components/casora/assets/globe/';
const TURN = 300000;
export const SLOT0 = Math.floor(Date.UTC(2026, 10, 18, 12, 0, 0) / (2 * TURN)) * 2 * TURN;
export const SRC = 'sensor.fr24';
const doc = { nodeType: 1, getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} } };
export const flight = { id: '1', flight_number: 'XY1', callsign: 'XYZ1', tracked_type: 'live', on_ground: 0, latitude: 50.2, longitude: 10.1, altitude: 35000,
  ground_speed: 450, heading: 90, vertical_speed: -500, airline: 'Example Air', aircraft_model: 'Type 100', aircraft_registration: 'AB-CDE',
  airport_origin_name: 'Airport A', airport_origin_latitude: 50, airport_origin_longitude: 4,
  airport_destination_name: 'Airport B', airport_destination_latitude: 52, airport_destination_longitude: 20,
  time_scheduled_arrival: SLOT0 / 1000 + 5400, time_estimated_arrival: SLOT0 / 1000 + 5000, coordinates: [[50, 4], [50.1, 5]] };

// One page. `files` decides what the late requests find: a file name from assets/globe/ → its text; absent → 404.
export const page = (files) => {
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
export const globeFiles = () => Object.fromEntries(['d3-array.min.js', 'd3-geo.min.js', 'topojson-client.min.js', 'land-110m.json'].map((n) => [n, read(ASSETS + n)]));
export const settle = () => new Promise((r) => setImmediate(r));
