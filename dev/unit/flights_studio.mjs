// Studio side of the tracked flights source: the setting is a Dashboard-scope draft, offered and worded from what the
// house has, and the Manage flights tile is offered only where a source exists.
//   node dev/unit/flights_studio.mjs
// @deckt: custom_components/casora/panel/casora-panel.js#SECTIONS
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { loadPanel } from './lib/testhaus.mjs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const { I, P } = await loadPanel();
const field = I.SECTIONS.find((s) => s.label === 'General').fields.find((f) => f.key === 'casora_flights_source');
assert.ok(field, 'the setting is a field of the dashboard settings');
assert.equal(field.scope, 'dashboard', 'Dashboard settings scope: every room carries it, new rooms inherit it');
assert.equal(field.type, 'select');
const tile = I.TILE_TYPES.find((t) => t.id === 'casora_flights');
assert.ok(tile && tile.noEntity, 'Manage flights is a tile that needs no entity');

const hass = (sources, extra = {}) => {
  const entities = {}, states = {};
  sources.forEach(([id, dev, flights]) => {
    entities[id] = { entity_id: id, platform: 'flightradar24', device_id: dev, translation_key: 'additional_tracked' };
    states[id] = { entity_id: id, state: String(flights.length), attributes: { flights } };
  });
  return { entities, states, devices: {}, ...extra };
};
// Before the module is loaded nothing is offered and nothing breaks (the Studio fetches the module on its own).
assert.equal(!!field.when({}, hass([])), false);
assert.equal(field.dynOptions(hass([]), ''), null);
assert.equal(tile.onlyIf(hass([])), false);

new Function(read('custom_components/casora/scripts/local/49-flights.js'))();

assert.equal(field.when({}, hass([])), false, 'no FlightRadar24: no setting, no tile offer');
assert.equal(tile.onlyIf(hass([])), false);
assert.equal(field.when({ casora_flights_source: 'sensor.old' }, hass([])), true, 'a saved pick is still shown, as unavailable');

const one = hass([['sensor.a', 'd1', []]]);
assert.equal(field.when({}, one), true);
assert.equal(tile.onlyIf(one), true);
assert.equal(field.note(one, ''), null, 'one source: Automatic needs no comment');
assert.equal(field.dynOptions(one, '').labels[''], 'Automatic');

const two = hass([['sensor.a', 'd1', []], ['sensor.b', 'd2', []]]);
assert.equal(field.dynOptions(two, '').labels[''], 'Select a tracked-flights source', 'several: no Automatic');
assert.equal(field.note(two, '').text, 'Select a tracked-flights source');
assert.deepEqual(field.dynOptions(two, '').options, ['', 'sensor.a', 'sensor.b']);

const gone = field.dynOptions(two, 'sensor.old');
assert.ok(gone.options.includes('sensor.old'), 'a pick that is gone stays selectable');
assert.equal(gone.labels['sensor.old'], 'Source unavailable');
assert.equal(field.note(two, 'sensor.old').text, 'Source unavailable');

// The stub's omit_source variant leaves its controls in the entity registry.
const part = { entities: {
  'text.flight_tracker_one_add_to_track': { entity_id: 'text.flight_tracker_one_add_to_track', platform: 'flightradar24', device_id: 'stub-1', translation_key: 'add_track' },
  'text.flight_tracker_one_remove_from_track': { entity_id: 'text.flight_tracker_one_remove_from_track', platform: 'flightradar24', device_id: 'stub-1', translation_key: 'remove_track' },
  'switch.flight_tracker_one_api_data_fetching': { entity_id: 'switch.flight_tracker_one_api_data_fetching', platform: 'flightradar24', device_id: 'stub-1', translation_key: 'scanning' },
}, states: {}, devices: {} };
assert.equal(field.when({}, part), true, 'the integration is present, but its source sensor is missing');
assert.deepEqual({ ...field.note(part, '') }, { text: 'FlightRadar24 is missing a part Casora needs: {name}', name: 'source sensor' });
assert.equal(tile.onlyIf(part), false, 'no tile offer without a usable source');
const noList = { entities: {
  'sensor.flight_tracker_one_additional_tracked': { entity_id: 'sensor.flight_tracker_one_additional_tracked', platform: 'flightradar24', device_id: 'stub-1', translation_key: 'additional_tracked' },
}, states: { 'sensor.flight_tracker_one_additional_tracked': { state: '0', attributes: {} } }, devices: {} };
assert.equal(field.when({}, noList), true);
assert.deepEqual({ ...field.note(noList, '') }, { text: 'FlightRadar24 is missing a part Casora needs: {name}', name: 'source sensor' },
  'a source sensor without a flights list also shows the missing-part text');

new Function(read('custom_components/casora/panel/casora-panel-settings.js'))();
await new Promise((resolve) => setImmediate(resolve));
const saved = (pin, sources = two) => {
  const writes = [];
  const self = {
    _cs: { S: { test_flag: true }, S0: '{}' },
    _csDirty: () => true,
    _csRepaint() {},
    _status() {},
    _hass: { ...sources, callWS: async (message) => {
      writes.push(message);
      return message.type === 'casora/settings/get' ? { settings: {} }
        : message.type === 'casora/settings/set' ? { settings: message.settings } : {};
    } },
    _state: { compact: { rooms: [{ variables: pin ? { casora_flights_source: pin } : {} }] } },
    _isDirty: () => true,
    _saveBlocked: false,
    _save: async () => { writes.push({ type: 'dashboard/save' }); return true; },
    shadowRoot: { querySelectorAll: () => [] },
  };
  return { self, writes };
};
const selectionError = 'Select a tracked-flights source · Settings → Tapping & tablet → Tracked flights';
{
  const { self, writes } = saved('');
  assert.equal(await P._csSave.call(self), false, 'global Save requires a source when several are available');
  assert.deepEqual(writes, [], 'an unresolved source blocks settings and dashboard writes');
  assert.equal(self._cs.err, selectionError);
}
{
  const { self, writes } = saved('sensor.b');
  assert.equal(await P._csSave.call(self), true, 'an explicit source permits global Save');
  assert.deepEqual(writes, [
    { type: 'casora/settings/get' },
    { type: 'casora/settings/set', settings: { test_flag: true } },
    { type: 'dashboard/save' },
  ]);
}
{
  const { self, writes } = saved('');
  const flights = window._casoraFlights;
  const importScript = window.casoraImportScript;
  delete window._casoraFlights;
  let requested;
  window.casoraImportScript = async (path) => {
    requested = path;
    await Promise.resolve();
    window._casoraFlights = flights;
    return flights;
  };
  const result = await P._csSave.call(self);
  window.casoraImportScript = importScript;
  window._casoraFlights = flights;
  assert.equal(requested, 'local/49-flights.js', 'Save awaits the source module if it is still loading');
  assert.equal(result, false, 'the async load does not let an unresolved source through');
  assert.deepEqual(writes, []);
}
{
  const { self, writes } = saved('');
  self._state = {};
  assert.equal(await P._csSave.call(self), false, 'Save waits for a current dashboard state before checking the source');
  assert.deepEqual(writes, []);
  assert.equal(self._cs.err, 'The settings could not be read. Reload the page, then try again.');
}
{
  const { self, writes } = saved('');
  const flights = window._casoraFlights;
  const importScript = window.casoraImportScript;
  delete window._casoraFlights;
  window.casoraImportScript = async () => { throw new Error('offline'); };
  const result = await P._csSave.call(self);
  window.casoraImportScript = importScript;
  window._casoraFlights = flights;
  assert.equal(result, false, 'a failed source-module load blocks Save');
  assert.deepEqual(writes, []);
  assert.equal(self._cs.err, 'The settings could not be read. Reload the page, then try again.');
}
{
  const { self, writes } = saved('', one);
  assert.equal(await P._csSave.call(self), true, 'one source permits Automatic');
  assert.deepEqual(writes, [
    { type: 'casora/settings/get' },
    { type: 'casora/settings/set', settings: { test_flag: true } },
    { type: 'dashboard/save' },
  ]);
}
if (process.env.CASORA_FLIGHT_STUB_REGISTRY) {
  const stubRegistry = JSON.parse(process.env.CASORA_FLIGHT_STUB_REGISTRY);
  assert.equal(field.when({}, stubRegistry), true, 'the real stub registry keeps the source setting visible');
  assert.deepEqual({ ...field.note(stubRegistry, '') },
    { text: 'FlightRadar24 is missing a part Casora needs: {name}', name: 'source sensor' });
  console.log('ok flights_studio stub registry');
}
console.log('ok flights_studio');
