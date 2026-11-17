// Studio side of the tracked flights source: the setting is a Dashboard-scope draft, offered and worded from what the
// house has, and the Manage flights tile is offered only where a source exists.
//   node dev/unit/flights_studio.mjs
// @deckt: custom_components/casora/panel/casora-panel.js#SECTIONS
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { loadPanel } from './lib/testhaus.mjs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const { I } = await loadPanel();
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
assert.equal(field.note(two, '').key, 'Select a tracked-flights source');
assert.deepEqual(field.dynOptions(two, '').options, ['', 'sensor.a', 'sensor.b']);

const gone = field.dynOptions(two, 'sensor.old');
assert.ok(gone.options.includes('sensor.old'), 'a pick that is gone stays selectable');
assert.equal(gone.labels['sensor.old'], 'Source unavailable');
assert.equal(field.note(two, 'sensor.old').key, 'Source unavailable');

const part = { entities: { 'sensor.a': { entity_id: 'sensor.a', platform: 'flightradar24', device_id: 'd1', translation_key: 'additional_tracked' } }, states: { 'sensor.a': { state: '0', attributes: {} } }, devices: {} };
assert.deepEqual({ ...field.note(part, '') }, { key: 'FlightRadar24 is missing a part Casora needs: {name}', name: 'source sensor' });
assert.equal(tile.onlyIf(part), false, 'no tile offer without a usable source');
console.log('ok flights_studio');
