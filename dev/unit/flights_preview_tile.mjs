// The Studio's tile preview of the two Flights tiles (#423): it runs the tile's state_display with the draft settings, as the
// Dashboard does with the saved ones, so the preview shows values (not an empty tile) and follows a draft unit or the Show
// timezones switch at once. No call is sent to Home Assistant. Controlled clock; synthetic flights; real templates and modules.
//   node dev/unit/flights_preview_tile.mjs
// @deckt: custom_components/casora/panel/casora-panel-types.js#casoraTileState,OWN_DATA
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const templates = JSON.parse(read('dashboards/casora/button_card_templates.json'));
const types = read('custom_components/casora/panel/casora-panel-types.js');
const t0 = types.indexOf('// Preview: icon and state text of Casora tiles'), t1 = types.indexOf('// Editor helpers for Casora tiles');
assert.ok(t0 > -1 && t1 > t0, 'the preview block in casora-panel-types.js');
const NOW = 1800000000000;
const MIN = 60000;

let ctx, panel, hass;
const boot = () => {
  panel = null;
  ctx = {
    console, Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW + MIN])); } static now() { return NOW + MIN; } },
    localStorage: { getItem: () => null, setItem() {} },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    setTimeout: () => 0, clearTimeout() {}, addEventListener() {},
    DOMParser: class { parseFromString(t) { return { body: { textContent: String(t).replace(/<[^>]+>/g, ' ').replace(/[ \t\n]+/g, ' '), querySelectorAll: () => [] } }; } },
    _casoraNotifyOpenViaCard: () => undefined,
    _casoraUI: { stage: () => '', empty: () => '' },
    _casoraLovelaceCfg: () => null,
    casoraLocale: () => 'de-DE',
    casoraInStudio: () => !!panel,
    get _casoraStudioPanel() { return panel; },
    CASORA_TILE_TYPES: [{ template: 'casora_flights' }, { template: 'casora_flights_airborne' }],
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('custom_components/casora/scripts/local/49-flights.js'), ctx);
  vm.runInContext('(function(){' + types.slice(t0, t1) + '\n})', ctx)();
};
const flight = (extra = {}) => ({
  id: 'f1', flight_number: 'XY123', callsign: 'TST123', tracked_type: 'live', on_ground: 0, latitude: 10, longitude: 20,
  altitude: 35000, ground_speed: 450, heading: 270, vertical_speed: -2000, airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB',
  airport_destination_timezone_offset: -18000, airport_destination_timezone_abbr: 'EST',
  time_scheduled_departure: Math.round(Date.UTC(2026, 10, 18, 9, 0) / 1000), time_estimated_arrival: Math.round(Date.UTC(2026, 10, 18, 23, 40) / 1000), ...extra,
});
const house = () => {
  const h = { entities: {}, states: {}, config: { time_zone: 'Europe/Amsterdam' }, calls: [], callService(d, s, data) { this.calls.push({ d, s, data }); return Promise.resolve(); } };
  h.source = (flights) => {
    h.entities = { 'sensor.a': { entity_id: 'sensor.a', platform: 'flightradar24', device_id: 'dsensor.a', translation_key: 'additional_tracked' } };
    h.states = { 'sensor.a': { entity_id: 'sensor.a', state: String(flights.length), attributes: { flights } } };
  };
  return h;
};
// The Studio: its draft (_state.compact.rooms[].variables) is what the preview reads.
const studio = (draft) => { panel = { _state: { compact: { rooms: [{ variables: { casora_flights_source: 'sensor.a', ...draft } }] } } }; };
const preview = (template) => ctx.casoraTileState({ type: 'custom:button-card', template, entity: '' }, null, hass, templates);

boot();
hass = house();
hass.source([flight()]);
const F = ctx._casoraFlights;
F.airborne(hass, '', NOW); // baseline, then one step: the flight qualifies
hass.source([flight({ latitude: 10.05 })]);
assert.equal(F.airborne(hass, '', NOW + MIN).length, 1, 'the flight qualifies');

studio({});
const saved = preview('casora_flights_airborne');
assert.ok(saved && saved.includes('XY123'), 'the Flights tile preview shows the flight, not an empty tile: ' + saved);
assert.ok(saved.includes(F.fmt.altitude(35000, '')), 'saved units: source altitude: ' + saved + ' / ' + F.fmt.altitude(35000, ''));
assert.ok(/\d/.test(preview('casora_flights') || ''), 'the Manage flights tile preview shows its text: ' + preview('casora_flights'));

studio({ casora_flights_altitude_unit: 'm', casora_flights_speed_unit: 'kmh' });
const draft = preview('casora_flights_airborne');
assert.ok(draft.includes(F.fmt.altitude(35000, 'm')) && draft.includes(F.fmt.speed(450, 'kmh')), 'draft units reach the preview at once: ' + draft);
assert.ok(!draft.includes(F.fmt.altitude(35000, '')), 'the saved unit is gone from the preview');

studio({ casora_flights_timezones: false });
const off = preview('casora_flights_airborne');
studio({ casora_flights_timezones: true });
const on = preview('casora_flights_airborne');
assert.ok(on.includes('MEZ') && !off.includes('MEZ'), 'the Show timezones draft adds the zone name: ' + off + ' / ' + on);

// Outside the Studio the tile keeps the saved units.
panel = null;
ctx._casoraLovelaceCfg = () => ({ views: [{ cards: [{ variables: { casora_flights_source: 'sensor.a', casora_flights_altitude_unit: 'ft' } }] }] });
assert.ok(preview('casora_flights_airborne').includes(F.fmt.altitude(35000, 'ft')), 'outside the Studio: the saved unit');

assert.deepEqual(hass.calls, [], 'the preview sends no service call (no tracking command)');
console.log('flights_preview_tile: all checks passed');
