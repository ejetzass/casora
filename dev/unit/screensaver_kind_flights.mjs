// The Dashboard setting „Screensaver“ offers the kind Flights exactly when the Studio chips offer it (46-screensaver.js
// S.offered: only with FlightRadar24), and it is labelled like the chips.
//   node dev/unit/screensaver_kind_flights.mjs
// @deckt: custom_components/casora/panel/casora-panel.js#SECTIONS,casora_screensaver_kind
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { loadPanel } from './lib/testhaus.mjs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const { I } = await loadPanel();
const field = I.SECTIONS.flatMap((s) => s.fields || []).find((f) => f.key === 'casora_screensaver_kind');
assert.ok(field, 'the Screensaver setting is a field of the dashboard settings');
assert.equal(field.scope, 'dashboard', 'Screensaver: Dashboard scope');
assert.equal(typeof field.live, 'function', 'the choices depend on the house: the field has a live list');

// A house with FlightRadar24 (one source) or without it.
const hass = (sources) => {
  const entities = {}, states = {};
  sources.forEach(([id, dev, flights]) => {
    entities[id] = { entity_id: id, platform: 'flightradar24', device_id: dev, translation_key: 'additional_tracked' };
    states[id] = { entity_id: id, state: String(flights.length), attributes: { flights } };
  });
  return { entities, states, devices: {} };
};
const withFr = hass([['sensor.a', 'd1', []]]);
const withoutFr = hass([]);

// Before the saver module is loaded nothing offers Flights.
assert.equal(field.live(withFr, '').options.includes('flights'), false, 'no saver module yet: no Flights');

// The saver and the flights module, as the Studio loads them.
new Function(read('custom_components/casora/scripts/local/49-flights.js'))();
new Function(read('custom_components/casora/scripts/local/46-screensaver.js'))();
const SV = window._casoraSaver;
assert.ok(SV && typeof SV.offered === 'function', 'the saver module exposes its offer rule');

// The option list is the Studio chips' list: the empty value, then every kind the chips offer, in their order.
const chipsOffer = (h) => ['', ...SV.offered(h).map((k) => k.id)];

assert.ok(chipsOffer(withFr).includes('flights'), 'the chips offer Flights with FlightRadar24');
assert.deepEqual(field.live(withFr, '').options, chipsOffer(withFr), 'with FlightRadar24: the list is the chips list');
assert.equal(field.live(withFr, '').options.includes('flights'), true, 'with FlightRadar24: Flights is listed');

assert.equal(chipsOffer(withoutFr).includes('flights'), false, 'the chips do not offer Flights without FlightRadar24');
assert.deepEqual(field.live(withoutFr, '').options, chipsOffer(withoutFr), 'without FlightRadar24: the list is the chips list');
assert.equal(field.live(withoutFr, '').options.includes('flights'), false, 'without FlightRadar24: no Flights');

// A saved Flights kind stays selectable without FlightRadar24, so the chooser does not show a bare word.
assert.equal(field.live(withoutFr, 'flights').options.includes('flights'), true, 'a saved Flights stays selectable');

// The label is the existing Flights text, the same as on the chips.
assert.equal(field.optionLabels.flights, 'Flights', 'the label is the chips label');
assert.equal(SV.KINDS.find((k) => k.id === 'flights').label, 'Flights');

console.log('ok screensaver kind flights');
