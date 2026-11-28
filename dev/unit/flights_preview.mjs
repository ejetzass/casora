// Tracked flights in the Studio preview (#423): the preview follows the Studio's draft for the units and the Show timezones
// switch (Save makes the live tile match, Discard brings back the saved values), shows qualifying flights with values, and
// no preview action writes to Home Assistant (no service call, no text.set_value to FlightRadar24).
// Controlled clock; synthetic flights; the Studio is simulated by its panel object (_state = draft, _raw = saved).
//   node dev/unit/flights_preview.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#setting,draftOf,listRows,tile,units,tz,airborne,times,moment
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');
const MIN = 60000;
const T0 = 1800000000000;
const sec = (ms) => Math.round(ms / 1000);
const utc = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi);

let F, ctx, cfg, panel;
const runtime = () => {
  cfg = null;
  panel = null;
  ctx = {
    console,
    localStorage: { getItem: () => null, setItem() {} },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    setTimeout: () => ({ live: false }), clearTimeout() {},
    addEventListener() {},
    _casoraNotifyOpenViaCard: () => undefined,
    _casoraUI: { section: (k, b) => b,  stage: (type, o) => 'STAGE[' + o.text + ']', empty: () => 'EMPTY' },
    _casoraLovelaceCfg: () => cfg,
    casoraLocale: () => 'de-DE',
    casoraInStudio: () => !!panel,
    get _casoraStudioPanel() { return panel; },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  F = ctx._casoraFlights;
};
// The Studio: its draft (_state.compact.rooms[].variables) is what the preview reads; _raw is the saved dashboard.
const studio = (draft, saved = {}) => {
  cfg = null; // the Studio has no open dashboard of its own
  panel = { _raw: { views: [{ cards: [{ variables: { casora_flights_source: 'sensor.a', ...saved } }] }] },
    _state: { compact: { rooms: [{ variables: { casora_flights_source: 'sensor.a', ...draft } }] } } };
};
const SAVED = { casora_flights_altitude_unit: '', casora_flights_speed_unit: '', casora_flights_vspeed_unit: '', casora_flights_timezones: false };
const DRAFT = { casora_flights_altitude_unit: 'm', casora_flights_speed_unit: 'kmh', casora_flights_vspeed_unit: 'ms', casora_flights_timezones: true };

// A house with one FlightRadar24 source, a Home Assistant timezone and calls that are recorded, not run.
const house = () => {
  const hass = { entities: {}, states: {}, config: { time_zone: 'Europe/Amsterdam' }, calls: [],
    callService(domain, service, data, target) { this.calls.push({ domain, service, data, target }); return Promise.resolve(); } };
  hass.source = (id, flights) => {
    hass.entities = { ...hass.entities, [id]: { entity_id: id, platform: 'flightradar24', device_id: 'd' + id, translation_key: 'additional_tracked' } };
    hass.states = { ...hass.states, [id]: { entity_id: id, state: String(flights.length), attributes: { flights } } };
  };
  return hass;
};
const fl = (extra = {}) => ({
  id: 'f1', flight_number: 'XY123', callsign: 'TST123', aircraft_registration: 'T-AAAA', tracked_type: 'live', on_ground: 0,
  latitude: 10, longitude: 20, altitude: 35000, ground_speed: 450, heading: 270, vertical_speed: -2000,
  airline_short: 'Testair', airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB',
  airport_origin_timezone_offset: 3600, airport_origin_timezone_abbr: 'CET',
  airport_destination_timezone_offset: -18000, airport_destination_timezone_abbr: 'EST',
  time_scheduled_departure: sec(utc(2026, 11, 18, 9, 0)), time_scheduled_arrival: sec(utc(2026, 11, 18, 23, 40)),
  time_estimated_arrival: sec(utc(2026, 11, 18, 23, 40)), ...extra,
});
// The rule needs an observed movement: a baseline, then a step. Returns the flights that qualify after the step.
const moving = (hass, flight) => {
  hass.source('sensor.a', [flight]); F.airborne(hass, '', T0);
  hass.source('sensor.a', [{ ...flight, latitude: flight.latitude + 0.05 }]);
  return F.airborne(hass, '', T0 + MIN);
};
// The live tile shows no flight rows: the list popup's rows carry the values the preview follows.
const listHtml = (hass) => F.listRows(hass, { pin: '', now: T0 + MIN });
const texts = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// ── Draft units: the preview uses the draft, the saved units stay for the live tile until Save ─────────────────────────
runtime();
let hass = house();
hass.source('sensor.a', [fl()]);
assert.equal(F.airborne(hass, '', T0).length, 0, 'baseline: a first position is no movement yet');
const movedOnce = moving(house(), fl());
assert.equal(movedOnce.length, 1, 'a moved flight qualifies');

// Saved units (the live tile): feet, knots, feet per minute.
studio({}, SAVED);
hass = house();
hass.source('sensor.a', [fl()]);
F.airborne(hass, '', T0);
hass.source('sensor.a', [fl({ latitude: 10.05 })]);
const savedHtml = listHtml(hass);
assert.ok(savedHtml.includes(F.fmt.altitude(35000, '')), 'saved units: the tile shows the source altitude unit');
assert.notEqual(F.fmt.altitude(35000, 'm'), F.fmt.altitude(35000, ''), 'the draft unit differs from the source unit');

// Draft changed, not saved: the preview follows the draft at once.
studio(DRAFT, SAVED);
const draftHtml = listHtml(hass);
assert.ok(draftHtml.includes(F.fmt.altitude(35000, 'm')), 'draft altitude: the preview shows metres');
assert.ok(draftHtml.includes(F.fmt.speed(450, 'kmh')), 'draft ground speed: the preview shows km/h');
// The tile text has altitude and speed only; the vertical speed is on the row the popup reads.
assert.equal(F.airborne(hass, '', T0 + MIN)[0].vspeed, F.fmt.vspeed(-2000, 'ms'), 'draft vertical speed: the row shows m/s');
assert.notEqual(draftHtml, savedHtml, 'the draft changes the preview text');
assert.equal(JSON.stringify(F.units()), JSON.stringify({ altitude: 'm', speed: 'kmh', vspeed: 'ms' }), 'the draft units are the ones read');

// Discard: the draft is the saved dashboard again, so the preview is back to the saved units.
studio(SAVED, SAVED);
assert.equal(listHtml(hass), savedHtml, 'discard: the preview is the saved tile again');

// Save: the saved dashboard now holds the draft, and the live tile shows the same text as the preview did.
studio(DRAFT, DRAFT);
assert.equal(listHtml(hass), draftHtml, 'save: the live tile matches the preview text');

// ── Show timezones draft: the zone names follow the switch in the preview, as on the tile ────────────────────────────
const estimate = (html) => texts(html).match(/Voraussichtliche Ankunft [^·]*·?[^<]*/)?.[0] || '';
studio({ casora_flights_timezones: false }, SAVED);
hass = house();
hass.source('sensor.a', [fl()]);
F.airborne(hass, '', T0);
hass.source('sensor.a', [fl({ latitude: 10.05 })]);
const tzOff = listHtml(hass);
assert.ok(!tzOff.includes('MEZ'), 'switch off in the draft: no zone name');
studio({ casora_flights_timezones: true }, SAVED);
const tzOn = listHtml(hass);
assert.ok(texts(tzOn).includes('00:40 Do., 19. Nov. Amsterdam MEZ'), 'switch on in the draft: the zone name (the list row shows the HA zone) is added in the preview');
assert.notEqual(estimate(tzOn), estimate(tzOff), 'the estimated arrival changes with the switch');
studio({ casora_flights_timezones: false }, SAVED);
assert.equal(listHtml(hass), tzOff, 'switch off again (Discard): the preview is the saved text');

// ── Qualifying flight in the preview: values, not an empty tile ───────────────────────────────────────────────────────
studio(DRAFT, DRAFT);
hass = house();
const rows = moving(hass, fl());
assert.equal(rows.length, 1, 'the preview sees the qualifying flight');
assert.ok(listHtml(hass).includes('data-flights-label="XY123"'), 'the tile shows the flight row XY123, with values');

// ── Two sources, draft pin on the second: the preview shows that source's flights (red on the parent, which read the saved one)
studio({ casora_flights_source: 'sensor.b' }, SAVED);
hass = house();
hass.source('sensor.a', [fl()]);
hass.source('sensor.b', [fl({ id: 'f2', flight_number: 'XY999' })]);
F.airborne(hass, 'sensor.a', T0); // each source keeps its own baseline
F.airborne(hass, 'sensor.b', T0);
hass.source('sensor.a', [fl({ latitude: 10.05 })]);
hass.source('sensor.b', [fl({ id: 'f2', flight_number: 'XY999', latitude: 10.05 })]);
F.airborne(hass, 'sensor.a', T0 + MIN);
F.airborne(hass, 'sensor.b', T0 + MIN);
const second = F.listRows(hass, { pin: F.setting(), now: T0 + MIN }); // the pin the preview reads: the draft source
assert.ok(second.includes('data-flights-label="XY999"'), 'draft pin on sensor.b: the preview shows its flight XY999');
assert.ok(!second.includes('XY123'), 'draft pin on sensor.b: the saved source sensor.a is not shown');

// ── Live tile outside the Studio: the saved units, even when a stale draft is around (no draft leak) ────────────────────
studio(SAVED, SAVED); // a Studio draft with source units, left over from an earlier visit
panel = null; // no Studio open now
cfg = { views: [{ cards: [{ variables: { casora_flights_source: 'sensor.a', casora_flights_altitude_unit: 'm', casora_flights_speed_unit: 'kmh' } }] }] };
hass = house();
hass.source('sensor.a', [fl()]);
F.airborne(hass, '', T0);
hass.source('sensor.a', [fl({ latitude: 10.05 })]);
const outside = listHtml(hass);
assert.ok(outside.includes(F.fmt.altitude(35000, 'm')), 'outside the Studio: the saved altitude unit (metres) is shown');
assert.ok(outside.includes(F.fmt.speed(450, 'kmh')), 'outside the Studio: the saved speed unit (km/h) is shown');
assert.ok(!outside.includes(F.fmt.altitude(35000, '')), 'outside the Studio: the stale draft unit is not used');

// ── A Studio page opened on its own has no casora-core.js, so no casoraInStudio: the preview still follows the draft ─────
studio(DRAFT, SAVED);
ctx.casoraInStudio = undefined;
assert.equal(JSON.stringify(F.units()), JSON.stringify({ altitude: 'm', speed: 'kmh', vspeed: 'ms' }), 'no casoraInStudio: the draft units are still read');
assert.equal(F.tz(), true, 'no casoraInStudio: the draft timezone switch is still read');
ctx.casoraInStudio = () => !!panel;

// ── No preview action writes: rendering with a draft makes no service call ────────────────────────────────────────────
studio(DRAFT, SAVED);
hass = house();
moving(hass, fl());
listHtml(hass);
F.timeRows(hass, fl(), true);
F.times(hass, fl(), true);
F.units();
F.tz();
F.liveHidden(hass, T0 + MIN);
assert.deepEqual(hass.calls, [], 'the preview sends no service call (no text.set_value, no tracking command)');

console.log('flights_preview: all checks passed');
