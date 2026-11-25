// Tracked flights: the timestamps (49-flights.js F.times): destination/origin time and HA-local time, the estimated
// arrival on the tile, scheduled/actual/estimated rows in the popup, dates at a date boundary, airport offsets (seconds,
// either sign), HA daylight saving, the optional timezone suffix, and that the browser's timezone never changes the text.
// Controlled clock; synthetic flights; no real timezone mapping is needed beyond what Intl gives for a zone name.
//   node dev/unit/flights_times.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#times,tz,flightSec,liveHtml,sec,flightPopup,setting,pinned
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SRC = read('custom_components/casora/scripts/local/49-flights.js');
const MIN = 60000;
const T0 = 1800000000000;
const sec = (ms) => Math.round(ms / 1000); // FlightRadar24 timestamps are Unix seconds
const utc = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi);

let F, ctx, handlers, cfg, LOC;
const runtime = () => {
  handlers = {}; cfg = null;
  ctx = {
    console,
    localStorage: { getItem: () => null, setItem() {} },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    setTimeout: () => ({ live: false }), clearTimeout() {},
    addEventListener: (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); },
    _casoraNotifyOpenViaCard: () => undefined,
    _casoraUI: { stage: (type, o) => 'STAGE[' + o.text + ']', empty: () => 'EMPTY' },
    _casoraLovelaceCfg: () => cfg,
    casoraLocale: () => LOC,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  F = ctx._casoraFlights;
  return F;
};
// A house with one FlightRadar24 source and a Home Assistant timezone (empty = not configured).
const house = (zone = 'Europe/Amsterdam') => {
  const hass = { entities: {}, states: {}, config: zone === null ? {} : { time_zone: zone }, calls: [], callService() { return Promise.resolve(); } };
  hass.source = (id, flights) => {
    hass.entities = { ...hass.entities, [id]: { entity_id: id, platform: 'flightradar24', device_id: 'd' + id, translation_key: 'additional_tracked' } };
    hass.states = { ...hass.states, [id]: { entity_id: id, state: String(flights.length), attributes: { flights } } };
  };
  return hass;
};
// A live, airborne synthetic flight with timestamps and airport metadata (offsets in seconds).
const fl = (id, extra = {}) => ({
  id, flight_number: 'XY123', callsign: 'TST123', aircraft_registration: 'T-AAAA', tracked_type: 'live', on_ground: 0,
  latitude: 10, longitude: 20, altitude: 35000, ground_speed: 450, heading: 270, vertical_speed: -2000,
  airline_short: 'Testair', airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB',
  airport_origin_timezone_offset: 3600, airport_origin_timezone_abbr: 'CET',
  airport_destination_timezone_offset: -18000, airport_destination_timezone_abbr: 'EST',
  time_scheduled_departure: sec(utc(2026, 11, 18, 9, 0)), time_scheduled_arrival: sec(utc(2026, 11, 18, 23, 40)),
  time_estimated_arrival: sec(utc(2026, 11, 18, 23, 40)), ...extra,
});
// The rule needs an observed movement: the baseline, then a step. Returns the qualifying flights after the step.
const moving = (hass, flight, src = 'sensor.a', at = T0) => {
  hass.source(src, [flight]); F.airborne(hass, '', at);
  hass.source(src, [{ ...flight, latitude: flight.latitude + 0.05 }]);
  return F.airborne(hass, '', at + MIN);
};
const setTz = (on) => {
  cfg = { views: [{ cards: [{ variables: { casora_flights_source: 'sensor.a', casora_flights_timezones: on } }] }] };
};
const tile = (hass, pin = '', now = T0 + MIN) => F.liveHtml(hass, pin, now);
const popupTimes = (hass, flight) => F.sec('ftimes', { src: 'sensor.a', flight: flight.id }, hass.states, hass);
const texts = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// ── The times: destination or origin, and HA-local ─────────────────────────────────────────────────────────────────
LOC = 'de-DE';
runtime();
let hass = house();
setTz(undefined); // Saved setting absent: off by default.
assert.equal(F.tz(), false, 'timezone suffixes are off by default');

// Arrival: 23:40 UTC is 18:40 at the destination (UTC-5) and 00:40 on the next day in Amsterdam (UTC+1). The dates differ,
// so both values carry their date.
let t = F.times(hass, fl('s1'), false);
assert.equal(t.arr.map((x) => x.kind).join(), ['scheduled', 'estimated'].join(), 'arrival: scheduled and estimated, no actual yet');
assert.equal(t.arr.find((x) => x.kind === 'estimated').text, '18:40 18.11. Zeit am Zielort · 00:40 19.11. Ortszeit', 'arrival: destination time, local time, dates at the boundary');
assert.equal(t.dep.find((x) => x.kind === 'scheduled').text, '10:00 Ortszeit', 'departure, same clock as the local zone: one local time, no dates');

// Positive offset, same day: the dates agree, so none are shown.
hass = house();
const pos = fl('s2', { airport_destination_timezone_offset: 32400, airport_destination_timezone_abbr: 'JST', time_estimated_arrival: sec(utc(2026, 11, 18, 10, 0)) });
assert.equal(F.times(hass, pos, false).arr.find((x) => x.kind === 'estimated').text, '19:00 Zeit am Zielort · 11:00 Ortszeit', 'positive offset: destination ahead of local time, no dates');

// Negative offset with minutes and no abbreviation: the offset is shown as UTC (derived from the number), never a guess.
const neg = fl('s3', { airport_destination_timezone_offset: -12600, airport_destination_timezone_abbr: '', time_estimated_arrival: sec(utc(2026, 11, 18, 15, 0)) });
assert.equal(F.times(hass, neg, true).arr.find((x) => x.kind === 'estimated').text,
  '11:30 UTC-3:30 Zeit am Zielort · 16:00 MEZ Ortszeit', 'negative offset with minutes: UTC suffix from the number when no abbreviation');

// ── Scheduled versus actual versus estimated: each kind keeps its own meaning, missing ones disappear ──────────────
hass = house();
const real = fl('s4', { time_real_departure: sec(utc(2026, 11, 18, 9, 20)), time_real_arrival: undefined, time_estimated_arrival: undefined });
t = F.times(hass, real, false);
assert.equal(t.dep.map((x) => x.kind).join(), ['scheduled', 'real'].join(), 'departure: scheduled and actual, the estimate is absent');
assert.equal(t.arr.map((x) => x.kind).join(), ['scheduled'].join(), 'missing estimate: no estimated row, the scheduled arrival stays');
assert.equal(t.arr.find((x) => x.kind === 'estimated'), undefined, 'a schedule is never relabelled as an estimate');

// ── Missing airport metadata: the destination presentation is omitted; HA time is labelled as local only ─────────
const noMeta = fl('s5', { airport_destination_timezone_offset: undefined, airport_destination_timezone_abbr: undefined });
const alone = F.times(hass, noMeta, false).arr.find((x) => x.kind === 'estimated').text;
assert.equal(alone, '00:40 19.11. Ortszeit', 'no airport offset: the local time with its date (the departure is the day before), labelled as local');
assert.ok(!/Zielort/.test(alone), 'no airport offset: HA time is never labelled as destination time');

// No HA timezone configured: the airport time stands alone; the browser timezone is never used instead.
const noHa = house(null);
assert.equal(F.times(noHa, fl('s6'), false).arr.find((x) => x.kind === 'estimated').text, '18:40 Zeit am Zielort', 'no HA timezone: airport time only');

// ── A local-only time (no airport offset) shows its date when its local day differs from the other end's ──
LOC = 'de-DE';
hass = house('Europe/Amsterdam');
const local = (extra) => fl('s10', { airport_origin_timezone_offset: undefined, airport_origin_timezone_abbr: undefined,
  airport_destination_timezone_offset: undefined, airport_destination_timezone_abbr: undefined, ...extra });
const twoDaysOn = F.times(hass, local({ time_estimated_arrival: sec(utc(2026, 11, 20, 10, 0)), time_scheduled_arrival: undefined }), false)
  .arr.find((x) => x.kind === 'estimated').text;
assert.equal(twoDaysOn, '11:00 20.11. Ortszeit', 'arrival on another local day: the date is shown');
const sameDay = F.times(hass, local({ time_estimated_arrival: sec(utc(2026, 11, 18, 15, 0)), time_scheduled_arrival: undefined }), false)
  .arr.find((x) => x.kind === 'estimated').text;
assert.equal(sameDay, '16:00 Ortszeit', 'arrival on the departure\'s local day: no date');

// ── Same zone: clocks and zone name agree, so the presentation collapses to one local time ──────────────────────
LOC = 'en-US';
hass = house('America/New_York');
const same = fl('s7', { airport_destination_timezone_offset: -18000, airport_destination_timezone_abbr: 'EST', time_estimated_arrival: sec(utc(2026, 11, 18, 15, 40)) });
assert.equal(F.times(hass, same, false).arr.find((x) => x.kind === 'estimated').text, '10:40 AM Ortszeit', 'same zone collapses to one local time');
// Same instant and same clock: the same offset, so one time, whatever the zone name is spelled as (no GMT+1 vs CET duplicate).
const diffName = fl('s8', { airport_destination_timezone_offset: -18000, airport_destination_timezone_abbr: 'UTC-5', time_estimated_arrival: sec(utc(2026, 11, 18, 15, 40)) });
assert.equal(F.times(hass, diffName, false).arr.find((x) => x.kind === 'estimated').text, '10:40 AM Ortszeit', 'clocks agree, zone name spelled differently: one time');
// Clocks differ: both presentations stay.
const otherClock = fl('s9', { airport_destination_timezone_offset: 3600, airport_destination_timezone_abbr: 'CET', time_estimated_arrival: sec(utc(2026, 11, 18, 15, 40)) });
assert.equal(F.times(hass, otherClock, false).arr.find((x) => x.kind === 'estimated').text, '04:40 PM Zeit am Zielort · 10:40 AM Ortszeit', 'different clocks: both stay');
LOC = 'de-DE';

// ── Same offset, other zone name: one local time (the airport's abbreviation is not compared with HA's name) ────────────
LOC = 'de-DE';
hass = house('Europe/Paris');
const sameOffset = fl('s12', { airport_origin_timezone_offset: 3600, airport_origin_timezone_abbr: 'CET',
  airport_destination_timezone_offset: 3600, airport_destination_timezone_abbr: 'CET', time_estimated_arrival: sec(utc(2026, 11, 18, 10, 15)) });
assert.equal(F.times(hass, sameOffset, false).arr.find((x) => x.kind === 'estimated').text, '11:15 Ortszeit',
  'same UTC offset, airport abbreviation CET and HA zone MEZ: one local time');
assert.equal(F.times(hass, sameOffset, true).arr.find((x) => x.kind === 'estimated').text, '11:15 MEZ Ortszeit',
  'same offset with the suffix on: one time, the HA zone name');
// Different offset (airport one hour behind HA): both presentations stay.
const behind = fl('s13', { airport_destination_timezone_offset: 0, airport_destination_timezone_abbr: 'UTC', time_estimated_arrival: sec(utc(2026, 11, 18, 10, 15)) });
assert.equal(F.times(hass, behind, false).arr.find((x) => x.kind === 'estimated').text, '10:15 Zeit am Zielort · 11:15 Ortszeit',
  'different offset: destination time and local time');
// Zones with a half-hour offset: the HA offset is read the same way for both signs, so the same offset still collapses.
hass = house('Asia/Kolkata');
const kolkata = fl('s14', { airport_origin_timezone_offset: 19800, airport_origin_timezone_abbr: 'IST',
  airport_destination_timezone_offset: 19800, airport_destination_timezone_abbr: 'IST', time_estimated_arrival: sec(utc(2026, 11, 18, 10, 15)) });
assert.equal(F.times(hass, kolkata, false).arr.find((x) => x.kind === 'estimated').text, '15:45 Ortszeit', 'half-hour positive offset: one local time');
hass = house('America/St_Johns');
const stJohns = fl('s15', { airport_origin_timezone_offset: -12600, airport_origin_timezone_abbr: 'NST',
  airport_destination_timezone_offset: -12600, airport_destination_timezone_abbr: 'NST', time_estimated_arrival: sec(utc(2026, 11, 18, 10, 15)) });
assert.equal(F.times(hass, stJohns, false).arr.find((x) => x.kind === 'estimated').text, '06:45 Ortszeit', 'half-hour negative offset: one local time');

// ── Overnight arrival: the arrival shows its date when its day differs from the departure's (HA-local) day ──────────
hass = house('Europe/Amsterdam');
// Departs 23:00 local (22:00 UTC), lands 00:40 next day. A UTC+0 airport: both arrival days (00:40 destination, 01:40
// local) are 19.11, so the old rule (the two days of one time) showed no date.
const night = fl('n1', { airport_destination_timezone_offset: 0, airport_destination_timezone_abbr: 'UTC',
  time_scheduled_departure: sec(utc(2026, 11, 18, 22, 0)), time_scheduled_arrival: sec(utc(2026, 11, 19, 0, 40)), time_estimated_arrival: undefined });
t = F.times(hass, night, false);
assert.equal(t.dep[0].text, '23:00 Ortszeit', 'overnight: departure on its own day, no date');
assert.equal(t.arr[0].text, '00:40 19.11. Zeit am Zielort · 01:40 19.11. Ortszeit', 'overnight: arrival shows its date, both presentations');
// The same flight with the airport on the local offset: one time, and it still carries the date.
const nightSame = fl('n2', { airport_destination_timezone_offset: 3600, airport_destination_timezone_abbr: 'CET',
  time_scheduled_departure: sec(utc(2026, 11, 18, 22, 0)), time_scheduled_arrival: sec(utc(2026, 11, 18, 23, 40)), time_estimated_arrival: undefined });
assert.equal(F.times(hass, nightSame, false).arr[0].text, '00:40 19.11. Ortszeit', 'overnight, same zone: one local time with the arrival date');
// Same day: the arrival's day equals the departure's, so no date appears.
const day = fl('n3', { airport_destination_timezone_offset: 0, airport_destination_timezone_abbr: 'UTC',
  time_scheduled_departure: sec(utc(2026, 11, 18, 9, 0)), time_scheduled_arrival: sec(utc(2026, 11, 18, 10, 30)), time_estimated_arrival: undefined });
assert.equal(F.times(hass, day, false).arr[0].text, '10:30 Zeit am Zielort · 11:30 Ortszeit', 'same day: no date on the arrival');
LOC = 'de-DE';

// ── Browser timezone independence: the same text under another TZ ──────────────────────────────────────────────
const TZ0 = process.env.TZ;
const render = (zone) => { process.env.TZ = zone; runtime(); return F.times(house(), fl('s9'), true).arr.find((x) => x.kind === 'estimated').text; };
const a = render('Pacific/Kiritimati');
const b = render('America/Los_Angeles');
process.env.TZ = TZ0 === undefined ? '' : TZ0;
assert.equal(a, b, 'browser timezone does not change the text');
assert.equal(a, '18:40 18.11. EST Zeit am Zielort · 00:40 19.11. MEZ Ortszeit', 'destination and local time are the same under any browser timezone');

// ── Daylight saving in the HA zone (native Intl): the switch on 29.03.2026 at 02:00 local ────────────────────────────
runtime(); LOC = 'de-DE';
hass = house();
// Departure on the same day (00:00 UTC), so the arrival shows no date: only the clock is under test.
const dstDep = sec(utc(2026, 3, 29, 0, 0));
const before = fl('d1', { airport_destination_timezone_offset: 0, airport_destination_timezone_abbr: 'UTC', time_scheduled_departure: dstDep, time_estimated_arrival: sec(utc(2026, 3, 29, 0, 30)) });
const after = fl('d2', { airport_destination_timezone_offset: 0, airport_destination_timezone_abbr: 'UTC', time_scheduled_departure: dstDep, time_estimated_arrival: sec(utc(2026, 3, 29, 1, 30)) });
assert.equal(F.times(hass, before, false).arr.find((x) => x.kind === 'estimated').text, '00:30 Zeit am Zielort · 01:30 Ortszeit', 'before the switch: CET');
assert.equal(F.times(hass, after, false).arr.find((x) => x.kind === 'estimated').text, '01:30 Zeit am Zielort · 03:30 Ortszeit', 'after the switch: local time jumps to 03:30');

// ── The optional suffix: off by default, on adds the zone name, the labels stay ─────────────────────────────────────
hass = house();
setTz(true);
assert.equal(F.tz(), true, 'the saved switch is read');
assert.equal(F.times(hass, fl('s1'), F.tz()).arr.find((x) => x.kind === 'estimated').text,
  '18:40 18.11. EST Zeit am Zielort · 00:40 19.11. MEZ Ortszeit', 'suffix on: zone names added, labels unchanged');

// ── Surfaces: the tile shows the arrival as one short time, the popup both times; a Save/Discard draft changes both ──────────────────────
hass = house();
assert.equal(moving(hass, fl('s1')).length, 1, 'the flight qualifies (observed movement)');
setTz(true);
let html = texts(tile(hass));
assert.ok(html.includes('Voraussichtliche Ankunft: 00:40 19.11. MEZ'), 'tile: estimated arrival, one short time (local clock, date, zone name with the suffix on)');
const popOn = texts(popupTimes(hass, fl('s1')));
assert.ok(popOn.includes('Geplant: 10:00 MEZ Ortszeit'), 'popup: scheduled departure, same clock as the local zone: one local time, with the suffix on');
assert.ok(popOn.includes('Voraussichtlich: 18:40 18.11. EST Zeit am Zielort'), 'popup: estimated arrival with the same text as the tile');
setTz(false); // Discard: the saved dashboard has no switch on.
html = texts(tile(hass));
assert.ok(html.includes('Voraussichtliche Ankunft: 00:40 19.11.'), 'discard: tile back to the short time without the zone name');
assert.ok(!texts(popupTimes(hass, fl('s1'))).includes('EST'), 'discard: popup without suffix');

// The tile shows the estimate only when the source has one; the popup shows only the timestamps that exist.
hass = house();
moving(hass, fl('s10', { time_estimated_arrival: undefined }));
assert.ok(!texts(tile(hass)).includes('Voraussichtliche Ankunft'), 'tile: no estimate, no estimate line');
hass = house();
moving(hass, fl('s11', { time_scheduled_departure: undefined, time_real_departure: sec(utc(2026, 11, 18, 9, 20)) }));
const realPop = texts(popupTimes(hass, fl('s11', { time_scheduled_departure: undefined, time_real_departure: sec(utc(2026, 11, 18, 9, 20)) })));
assert.ok(realPop.includes('Tatsächlich: 10:20 Ortszeit'), 'popup: actual departure shown as actual, one local time (same clock)');
assert.ok(!realPop.includes('Geplant: 10:00'), 'popup: no scheduled departure row when the source has none');

// The estimate is "Estimated" in English (the Studio, the tile and the popup read the same key).
for (const f of ['custom_components/casora/translations/dashboard/phrases/en.json', 'custom_components/casora/scripts/i18n/en.json']) {
  assert.equal(JSON.parse(read(f)).exact['Voraussichtlich'], 'Estimated', `${f}: estimated, not expected`);
}
console.log('flights_times: all checks passed');
