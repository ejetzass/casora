// The Studio setting „Flights map: Flat / Globe“ stays in the code, hidden until the flat map option comes back: a
// Dashboard-scope select in the Screensaver block right under the kind, stored empty by default, worded in all nine languages.
//   node dev/unit/flights_globe_setting.mjs
// @deckt: custom_components/casora/panel/casora-panel.js#SECTIONS,casora_flights_map
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { loadPanel } from './lib/testhaus.mjs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const { I } = await loadPanel();
const fields = I.SECTIONS.find((s) => s.label === 'General').fields;
const field = fields.find((f) => f.key === 'casora_flights_map');
assert.ok(field, 'the setting is a field of the dashboard settings');
assert.equal(field.scope, 'dashboard', 'Dashboard scope: every room carries it');
assert.equal(field.type, 'select');
assert.deepEqual(field.options, ['', 'globe'], 'Flat is the empty (stored empty) default, Globe the other choice');
assert.equal(field.label, 'Flights map');
assert.deepEqual({ ...field.optionLabels }, { '': 'Flat', globe: 'Globe' });

// Right under the kind in the Screensaver block.
const win = {};
const doc = { createElement: () => ({ style: {}, classList: { add() {}, toggle() {}, contains() { return false; } }, setAttribute() {}, appendChild() {} }), getElementById: () => null };
new Function('window', 'document', 'customElements', 'localStorage', read('custom_components/casora/panel/casora-panel-settings.js'))(win, doc, { whenDefined: () => ({ then() {} }), get: () => null }, { getItem: () => null });
const saver = win.casoraSettingsMap.tiles.flatMap((t) => t.blocks).find((b) => b.saver);
const at = saver.keys.indexOf('casora_screensaver_kind');
assert.equal(saver.keys[at + 1], 'casora_flights_map', 'the setting follows the kind in the Screensaver block');

// Hidden: the screensaver always draws the globe, so the setting never shows (its texts stay for the flat map option).
const fr = { entities: { 'sensor.a': { entity_id: 'sensor.a', platform: 'flightradar24', device_id: 'd1', translation_key: 'additional_tracked' } },
  states: { 'sensor.a': { entity_id: 'sensor.a', state: '0', attributes: { flights: [] } } }, devices: {} };
assert.equal(field.when({ casora_screensaver: '5' }, fr), false, 'screensaver on, FlightRadar24 there: still hidden');
assert.equal(field.when({ casora_screensaver: '5', casora_screensaver_kind: 'flights' }, fr), false, 'also for the kind Flights');

// The ticket's texts, word for word.
const T = {
  de: ['Flugkarte', 'Flach', 'Globus'], nl: ['Vluchtenkaart', 'Plat', 'Globe'],
  es: ['Mapa de vuelos', 'Plano', 'Globo'], fr: ['Carte des vols', 'Plate', 'Globe'], it: ['Mappa dei voli', 'Piatta', 'Globo'],
  nb: ['Flykart', 'Flatt', 'Globus'], pl: ['Mapa lotów', 'Płaska', 'Globus'], pt: ['Mapa de voos', 'Plano', 'Globo'],
};
for (const [lang, [label, flat, globe]] of Object.entries(T)) {
  const ex = JSON.parse(read(`custom_components/casora/translations/panel/${lang}.json`)).exact;
  assert.deepEqual([ex['Flights map'], ex['Flat'], ex['Globe']], [label, flat, globe], lang);
}
console.log('flights_globe_setting: ok');
