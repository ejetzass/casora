// Tracked flights: the timestamps (49-flights.js F.times): the airport time leads, the home time follows when its UTC
// offset differs (cities only with two times), the estimated arrival on the tile and list, the popup's departure and arrival plates, dates at a date boundary, airport offsets (seconds,
// either sign), HA daylight saving, the optional timezone suffix, and that the browser's timezone never changes the text.
// Controlled clock; synthetic flights; no real timezone mapping is needed beyond what Intl gives for a zone name.
//   node dev/unit/flights_times.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#times,moment,tz,flightSec,timePlates,pairs,listRows,rowHtml,sec,flightPopup,setting,pinned
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
const popupTimes = (hass, flight) => F.sec('ftimes', { src: 'sensor.a', flight: flight.id }, hass.states, hass);
const texts = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// ── Airport time leads: one time is bare, two times carry their city (rules of the flight times) ─────────────────────────
// NB = the protected space between clock, date, city and zone name; the separator is NB + "· ".
LOC = 'de-DE';
runtime();
{
  const est = (h, f, tz = false) => F.times(h, f, tz).arr.find((x) => x.kind === 'estimated');
  const cityFl = (id, extra) => fl(id, { airport_destination_city: 'Paramaribo', airport_origin_city: 'Testville', ...extra });
  // Different offset: airport time first with its city, then home time with its city.
  let h = house('Europe/Amsterdam');
  let e = est(h, cityFl('c1', { airport_destination_timezone_offset: -10800, time_estimated_arrival: sec(utc(2026, 11, 18, 16, 35)) }));
  assert.equal(e.text, '13:35\u00a0Paramaribo\u00a0\u00b7 17:35\u00a0Amsterdam', 'different offset: airport time with its city, then home time with its city');
  assert.equal(e.air, '13:35\u00a0Paramaribo', 'entry.air: the airport time with its city');
  assert.equal(e.home, '17:35\u00a0Amsterdam', 'entry.home: the home time with its city');
  // Same offset: one bare time, no city, no zone word.
  e = est(h, cityFl('c2', { airport_destination_timezone_offset: 3600, time_estimated_arrival: sec(utc(2026, 11, 18, 16, 35)) }));
  assert.equal(e.text, '17:35', 'same offset: one bare time');
  assert.equal(e.home, '', 'same offset: no home part');
  // Missing airport city: the IATA code stands in; with neither, two times carry only the home city.
  e = est(h, fl('c3', { airport_destination_timezone_offset: -10800, time_estimated_arrival: sec(utc(2026, 11, 18, 16, 35)) }));
  assert.equal(e.text, '13:35\u00a0BBB\u00a0\u00b7 17:35\u00a0Amsterdam', 'no airport city: the IATA code is the city');
  e = est(h, fl('c4', { airport_destination_code_iata: undefined, airport_destination_timezone_offset: -10800, time_estimated_arrival: sec(utc(2026, 11, 18, 16, 35)) }));
  assert.equal(e.text, '13:35\u00a0\u00b7 17:35\u00a0Amsterdam', 'no city and no code: the airport time has no city');
  // A multi-word city keeps its words together; a zone ID with a path takes its last part.
  h = house('America/Argentina/Buenos_Aires');
  e = est(h, cityFl('c5', { airport_destination_timezone_offset: 3600, time_estimated_arrival: sec(utc(2026, 11, 18, 16, 35)) }));
  assert.equal(e.text, '17:35\u00a0Paramaribo\u00a0\u00b7 13:35\u00a0Buenos\u00a0Aires', 'home city: last path part, underscore is a space, words kept together');
  // A zone ID without a city part shows the ID itself.
  h = house('UTC');
  e = est(h, cityFl('c6', { airport_destination_timezone_offset: 3600, time_estimated_arrival: sec(utc(2026, 11, 18, 16, 35)) }));
  assert.equal(e.text, '17:35\u00a0Paramaribo\u00a0\u00b7 16:35\u00a0UTC', 'zone ID without a city: the ID itself');
  h = house('Etc/GMT+3');
  e = est(h, cityFl('c7', { airport_destination_timezone_offset: 3600, time_estimated_arrival: sec(utc(2026, 11, 18, 16, 35)) }));
  assert.equal(e.text, '17:35\u00a0Paramaribo\u00a0\u00b7 13:35\u00a0Etc/GMT+3', 'Etc zone: the ID itself');
  // Only the airport time (no HA zone) and only the home time (no airport offset): bare.
  e = est(house(null), cityFl('c8', { airport_destination_timezone_offset: -10800, time_estimated_arrival: sec(utc(2026, 11, 18, 16, 35)) }));
  assert.equal(e.text, '13:35', 'no HA zone: the bare airport time');
  e = est(house('Europe/Amsterdam'), cityFl('c9', { airport_destination_timezone_offset: undefined, time_estimated_arrival: sec(utc(2026, 11, 18, 16, 35)) }));
  assert.equal(e.text, '17:35', 'no airport offset: the bare home time');
  // The departure leads with the departure airport's city.
  h = house('Europe/Amsterdam');
  e = F.times(h, cityFl('c10', { airport_origin_timezone_offset: -10800, time_scheduled_departure: sec(utc(2026, 11, 18, 9, 0)) }), false).dep[0];
  assert.equal(e.text, '06:00\u00a0Testville\u00a0\u00b7 10:00\u00a0Amsterdam', 'departure: the departure airport city, then home time');
  // Zone names (Show timezones on) follow the city, or the bare time.
  e = est(h, cityFl('c11', { airport_destination_timezone_offset: -10800, time_estimated_arrival: sec(utc(2026, 11, 18, 16, 35)) }), true);
  assert.equal(e.text, '13:35\u00a0Paramaribo\u00a0EST\u00a0\u00b7 17:35\u00a0Amsterdam\u00a0MEZ', 'zone name after the city');
  e = est(h, cityFl('c12', { airport_destination_timezone_offset: 3600, time_estimated_arrival: sec(utc(2026, 11, 18, 16, 35)) }), true);
  assert.equal(e.text, '17:35\u00a0MEZ', 'zone name right after a bare clock');
  // A day change: the date follows the clock, before the city.
  e = est(h, cityFl('c13', { airport_destination_timezone_offset: -10800, time_estimated_arrival: sec(utc(2026, 11, 19, 1, 30)) }));
  assert.equal(e.text, '22:30\u00a018.11.\u00a0Paramaribo\u00a0\u00b7 02:30\u00a019.11.\u00a0Amsterdam', 'day change: dates after the clocks, before the cities');
}

// ── The times: airport time first, home time when its offset differs ─────────────────────────────────────────────────────────────────
LOC = 'de-DE';
runtime();
let hass = house();
setTz(undefined); // Saved setting absent: off by default.
assert.equal(F.tz(), false, 'timezone suffixes are off by default');

// Arrival: 23:40 UTC is 18:40 at the destination (UTC-5) and 00:40 on the next day in Amsterdam (UTC+1). The dates differ,
// so both values carry their date.
let t = F.times(hass, fl('s1'), false);
assert.equal(t.arr.map((x) => x.kind).join(), ['scheduled', 'estimated'].join(), 'arrival: scheduled and estimated, no actual yet');
assert.equal(t.arr.find((x) => x.kind === 'estimated').text, '18:40\u00a018.11.\u00a0BBB\u00a0\u00b7 00:40\u00a019.11.\u00a0Amsterdam', 'arrival: destination time, local time, dates at the boundary');
assert.equal(t.dep.find((x) => x.kind === 'scheduled').text, '10:00', 'departure, same clock as the local zone: one bare time, no dates');

// Positive offset, same day: the dates agree, so none are shown.
hass = house();
const pos = fl('s2', { airport_destination_timezone_offset: 32400, airport_destination_timezone_abbr: 'JST', time_estimated_arrival: sec(utc(2026, 11, 18, 10, 0)) });
assert.equal(F.times(hass, pos, false).arr.find((x) => x.kind === 'estimated').text, '19:00\u00a0BBB\u00a0\u00b7 11:00\u00a0Amsterdam', 'positive offset: destination ahead of local time, no dates');

// Negative offset with minutes and no abbreviation: the offset is shown as UTC (derived from the number), never a guess.
const neg = fl('s3', { airport_destination_timezone_offset: -12600, airport_destination_timezone_abbr: '', time_estimated_arrival: sec(utc(2026, 11, 18, 15, 0)) });
assert.equal(F.times(hass, neg, true).arr.find((x) => x.kind === 'estimated').text,
  '11:30\u00a0BBB\u00a0UTC-3:30\u00a0\u00b7 16:00\u00a0Amsterdam\u00a0MEZ', 'negative offset with minutes: UTC suffix from the number when no abbreviation');

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
assert.equal(alone, '00:40\u00a019.11.', 'no airport offset: the home time with its date (the departure is the day before)');
assert.ok(!/BBB|Amsterdam/.test(alone), 'no airport offset: one bare time, no city');

// No HA timezone configured: the airport time stands alone; the browser timezone is never used instead.
const noHa = house(null);
assert.equal(F.times(noHa, fl('s6'), false).arr.find((x) => x.kind === 'estimated').text, '18:40', 'no HA timezone: airport time only');

// ── A local-only time (no airport offset) shows its date when its local day differs from the other end's ──
LOC = 'de-DE';
hass = house('Europe/Amsterdam');
const local = (extra) => fl('s10', { airport_origin_timezone_offset: undefined, airport_origin_timezone_abbr: undefined,
  airport_destination_timezone_offset: undefined, airport_destination_timezone_abbr: undefined, ...extra });
const twoDaysOn = F.times(hass, local({ time_estimated_arrival: sec(utc(2026, 11, 20, 10, 0)), time_scheduled_arrival: undefined }), false)
  .arr.find((x) => x.kind === 'estimated').text;
assert.equal(twoDaysOn, '11:00\u00a020.11.', 'arrival on another local day: the date is shown');
const sameDay = F.times(hass, local({ time_estimated_arrival: sec(utc(2026, 11, 18, 15, 0)), time_scheduled_arrival: undefined }), false)
  .arr.find((x) => x.kind === 'estimated').text;
assert.equal(sameDay, '16:00', 'arrival on the departure\'s local day: no date');

// ── Same zone: clocks and zone name agree, so the presentation collapses to one local time ──────────────────────
LOC = 'en-US';
hass = house('America/New_York');
const same = fl('s7', { airport_destination_timezone_offset: -18000, airport_destination_timezone_abbr: 'EST', time_estimated_arrival: sec(utc(2026, 11, 18, 15, 40)) });
assert.equal(F.times(hass, same, false).arr.find((x) => x.kind === 'estimated').text, '10:40\u00a0AM', 'same zone collapses to one bare time');
// Same instant and same clock: the same offset, so one time, whatever the zone name is spelled as (no GMT+1 vs CET duplicate).
const diffName = fl('s8', { airport_destination_timezone_offset: -18000, airport_destination_timezone_abbr: 'UTC-5', time_estimated_arrival: sec(utc(2026, 11, 18, 15, 40)) });
assert.equal(F.times(hass, diffName, false).arr.find((x) => x.kind === 'estimated').text, '10:40\u00a0AM', 'clocks agree, zone name spelled differently: one time');
// Clocks differ: both presentations stay.
const otherClock = fl('s9', { airport_destination_timezone_offset: 3600, airport_destination_timezone_abbr: 'CET', time_estimated_arrival: sec(utc(2026, 11, 18, 15, 40)) });
assert.equal(F.times(hass, otherClock, false).arr.find((x) => x.kind === 'estimated').text, '04:40\u00a0PM\u00a0BBB\u00a0\u00b7 10:40\u00a0AM\u00a0New\u00a0York', 'different clocks: both stay');
LOC = 'de-DE';

// ── Same offset, other zone name: one local time (the airport's abbreviation is not compared with HA's name) ────────────
LOC = 'de-DE';
hass = house('Europe/Paris');
const sameOffset = fl('s12', { airport_origin_timezone_offset: 3600, airport_origin_timezone_abbr: 'CET',
  airport_destination_timezone_offset: 3600, airport_destination_timezone_abbr: 'CET', time_estimated_arrival: sec(utc(2026, 11, 18, 10, 15)) });
assert.equal(F.times(hass, sameOffset, false).arr.find((x) => x.kind === 'estimated').text, '11:15',
  'same UTC offset, airport abbreviation CET and HA zone MEZ: one local time');
assert.equal(F.times(hass, sameOffset, true).arr.find((x) => x.kind === 'estimated').text, '11:15\u00a0MEZ',
  'same offset with the suffix on: one time, the HA zone name');
// Different offset (airport one hour behind HA): both presentations stay.
const behind = fl('s13', { airport_destination_timezone_offset: 0, airport_destination_timezone_abbr: 'UTC', time_estimated_arrival: sec(utc(2026, 11, 18, 10, 15)) });
assert.equal(F.times(hass, behind, false).arr.find((x) => x.kind === 'estimated').text, '10:15\u00a0BBB\u00a0\u00b7 11:15\u00a0Paris',
  'different offset: airport time and home time');
// Zones with a half-hour offset: the HA offset is read the same way for both signs, so the same offset still collapses.
hass = house('Asia/Kolkata');
const kolkata = fl('s14', { airport_origin_timezone_offset: 19800, airport_origin_timezone_abbr: 'IST',
  airport_destination_timezone_offset: 19800, airport_destination_timezone_abbr: 'IST', time_estimated_arrival: sec(utc(2026, 11, 18, 10, 15)) });
assert.equal(F.times(hass, kolkata, false).arr.find((x) => x.kind === 'estimated').text, '15:45', 'half-hour positive offset: one local time');
hass = house('America/St_Johns');
const stJohns = fl('s15', { airport_origin_timezone_offset: -12600, airport_origin_timezone_abbr: 'NST',
  airport_destination_timezone_offset: -12600, airport_destination_timezone_abbr: 'NST', time_estimated_arrival: sec(utc(2026, 11, 18, 10, 15)) });
assert.equal(F.times(hass, stJohns, false).arr.find((x) => x.kind === 'estimated').text, '06:45', 'half-hour negative offset: one local time');

// ── Overnight arrival: the arrival shows its date when its day differs from the departure's (HA-local) day ──────────
hass = house('Europe/Amsterdam');
// Departs 23:00 local (22:00 UTC), lands 00:40 next day. A UTC+0 airport: both arrival days (00:40 destination, 01:40
// local) are 19.11, so the old rule (the two days of one time) showed no date.
const night = fl('n1', { airport_destination_timezone_offset: 0, airport_destination_timezone_abbr: 'UTC',
  time_scheduled_departure: sec(utc(2026, 11, 18, 22, 0)), time_scheduled_arrival: sec(utc(2026, 11, 19, 0, 40)), time_estimated_arrival: undefined });
t = F.times(hass, night, false);
assert.equal(t.dep[0].text, '23:00', 'overnight: departure on its own day, no date');
assert.equal(t.arr[0].text, '00:40\u00a019.11.\u00a0BBB\u00a0\u00b7 01:40\u00a019.11.\u00a0Amsterdam', 'overnight: arrival shows its date, both presentations');
// The same flight with the airport on the local offset: one time, and it still carries the date.
const nightSame = fl('n2', { airport_destination_timezone_offset: 3600, airport_destination_timezone_abbr: 'CET',
  time_scheduled_departure: sec(utc(2026, 11, 18, 22, 0)), time_scheduled_arrival: sec(utc(2026, 11, 18, 23, 40)), time_estimated_arrival: undefined });
assert.equal(F.times(hass, nightSame, false).arr[0].text, '00:40\u00a019.11.', 'overnight, same zone: one local time with the arrival date');
// Same day: the arrival's day equals the departure's, so no date appears.
const day = fl('n3', { airport_destination_timezone_offset: 0, airport_destination_timezone_abbr: 'UTC',
  time_scheduled_departure: sec(utc(2026, 11, 18, 9, 0)), time_scheduled_arrival: sec(utc(2026, 11, 18, 10, 30)), time_estimated_arrival: undefined });
assert.equal(F.times(hass, day, false).arr[0].text, '10:30\u00a0BBB\u00a0\u00b7 11:30\u00a0Amsterdam', 'same day: no date on the arrival');
LOC = 'de-DE';

// ── Browser timezone independence: the same text under another TZ ──────────────────────────────────────────────
const TZ0 = process.env.TZ;
const render = (zone) => { process.env.TZ = zone; runtime(); return F.times(house(), fl('s9'), true).arr.find((x) => x.kind === 'estimated').text; };
const a = render('Pacific/Kiritimati');
const b = render('America/Los_Angeles');
process.env.TZ = TZ0 === undefined ? '' : TZ0;
assert.equal(a, b, 'browser timezone does not change the text');
assert.equal(a, '18:40\u00a018.11.\u00a0BBB\u00a0EST\u00a0\u00b7 00:40\u00a019.11.\u00a0Amsterdam\u00a0MEZ', 'airport and home time are the same under any browser timezone');

// ── Daylight saving in the HA zone (native Intl): the switch on 29.03.2026 at 02:00 local ────────────────────────────
runtime(); LOC = 'de-DE';
hass = house();
// Departure on the same day (00:00 UTC), so the arrival shows no date: only the clock is under test.
const dstDep = sec(utc(2026, 3, 29, 0, 0));
const before = fl('d1', { airport_destination_timezone_offset: 0, airport_destination_timezone_abbr: 'UTC', time_scheduled_departure: dstDep, time_estimated_arrival: sec(utc(2026, 3, 29, 0, 30)) });
const after = fl('d2', { airport_destination_timezone_offset: 0, airport_destination_timezone_abbr: 'UTC', time_scheduled_departure: dstDep, time_estimated_arrival: sec(utc(2026, 3, 29, 1, 30)) });
assert.equal(F.times(hass, before, false).arr.find((x) => x.kind === 'estimated').text, '00:30\u00a0BBB\u00a0\u00b7 01:30\u00a0Amsterdam', 'before the switch: CET');
assert.equal(F.times(hass, after, false).arr.find((x) => x.kind === 'estimated').text, '01:30\u00a0BBB\u00a0\u00b7 03:30\u00a0Amsterdam', 'after the switch: local time jumps to 03:30');

// ── The optional suffix: off by default, on adds the zone name, the labels stay ─────────────────────────────────────
hass = house();
setTz(true);
assert.equal(F.tz(), true, 'the saved switch is read');
assert.equal(F.times(hass, fl('s1'), F.tz()).arr.find((x) => x.kind === 'estimated').text,
  '18:40\u00a018.11.\u00a0BBB\u00a0EST\u00a0\u00b7 00:40\u00a019.11.\u00a0Amsterdam\u00a0MEZ', 'suffix on: zone names added after the city');

// ── Surfaces: the popup shows both times; a Save/Discard draft changes it (the tile shows no times) ──────────────────────
hass = house();
assert.equal(moving(hass, fl('s1')).length, 1, 'the flight qualifies (observed movement)');
setTz(true);
const listOn = texts(F.listRows(hass, { pin: '', now: T0 + MIN }));
assert.ok(listOn.includes('Voraussichtliche Ankunft 18:40 18.11. BBB EST \u00b7 00:40 19.11. Amsterdam MEZ'), 'list row: both times with their cities, no colon');
const popHtml = popupTimes(hass, fl('s1'));
const popOn = texts(popHtml);
// Two plates, each with its heading outside above it: "Abflug" then "Ankunft" (13/600, uppercase, .04em, secondary colour).
assert.equal((popHtml.match(/--casora-popup-row-fill/g) || []).length, 2, 'popup: one plate for the departure, one for the arrival');
assert.match(popHtml, /<div[^>]*font-size:13px[^>]*font-weight:600[^>]*>Abflug<\/div>[\s\S]*<div[^>]*font-size:13px[^>]*font-weight:600[^>]*>Ankunft<\/div>/, 'popup: the two headings in order, 13/600');
assert.match(popHtml, /text-transform:uppercase;letter-spacing:\.04em/, 'popup: headings uppercase with .04em letter-spacing');
assert.ok(popOn.startsWith(' Abflug AAA Geplant 10:00 MEZ Ankunft BBB '), 'popup: departure heading, the airport row, then the scheduled row with one bare time (zone name on)');
assert.ok(popOn.includes('Voraussichtlich 00:40 19.11. Amsterdam MEZ 18:40 18.11. BBB EST'), 'popup: kind word, the home time as the small line, the airport time on the right');
assert.ok(popHtml.includes('18:40\u00a018.11.\u00a0BBB\u00a0EST</div>') && /white-space:nowrap[^>]*>18:40/.test(popHtml), 'popup: the airport time is one nowrap value');
assert.ok(!/Ortszeit|Zeit am/.test(popHtml), 'popup: no "Ortszeit" or "Zeit am ..." words');
setTz(false); // Discard: the saved dashboard has no switch on.
assert.ok(!texts(popupTimes(hass, fl('s1'))).includes('EST'), 'discard: popup without suffix');
assert.ok(texts(popupTimes(hass, fl('s1'))).includes('Voraussichtlich 00:40 19.11. Amsterdam 18:40 18.11. BBB'), 'discard: popup arrival without zone names');

// List row: one bare clock when the destination has the home offset, and the bare airport clock without an HA zone.
{
  const rowOf = (h, f) => { moving(h, f); return texts(F.listRows(h, { pin: '', now: T0 + MIN })); };
  setTz(false);
  assert.ok(rowOf(house(), fl('t1', { airport_destination_timezone_offset: 3600 })).includes('Voraussichtliche Ankunft 00:40 19.11.'), 'list row: same offset, one bare clock with its date');
  assert.ok(!rowOf(house(), fl('t2', { airport_destination_timezone_offset: 3600 })).includes('Amsterdam'), 'list row: same offset, no city');
  assert.ok(rowOf(house(null), fl('t3')).includes('Voraussichtliche Ankunft 18:40'), 'list row: no HA zone, the bare airport clock');
  const lh = house(); moving(lh, fl('t4', { airport_destination_city: 'Paramaribo', airport_destination_timezone_offset: -10800, time_estimated_arrival: sec(utc(2026, 11, 18, 16, 35)) }));
  assert.ok(texts(F.listRows(lh, { pin: '', now: T0 + MIN })).includes('Voraussichtliche Ankunft 13:35 Paramaribo \u00b7 17:35 Amsterdam'), 'list row: airport city, then home city');
  setTz(true);
}

// The popup shows only the timestamps that exist.
hass = house();
moving(hass, fl('s10', { time_estimated_arrival: undefined }));
const noEta = texts(F.listRows(hass, { pin: '', now: T0 + MIN }));
assert.ok(noEta.includes('→') || noEta.includes('XY'), 'precondition: the list shows the flight');
assert.ok(!noEta.includes('Voraussichtliche Ankunft'), 'list row: no estimate, no estimate line');
hass = house();
moving(hass, fl('s11', { time_scheduled_departure: undefined, time_real_departure: sec(utc(2026, 11, 18, 9, 20)) }));
const realPop = texts(popupTimes(hass, fl('s11', { time_scheduled_departure: undefined, time_real_departure: sec(utc(2026, 11, 18, 9, 20)) })));
assert.ok(realPop.includes('Tatsächlich 10:20'), 'popup: actual departure shown as actual, one bare time (same clock)');
assert.ok(!realPop.includes('Geplant 10:00'), 'popup: no scheduled departure row when the source has none');

// The estimate is "Estimated" in English (the Studio, the tile and the popup read the same key).
for (const f of ['custom_components/casora/translations/dashboard/phrases/en.json', 'custom_components/casora/scripts/i18n/en.json']) {
  assert.equal(JSON.parse(read(f)).exact['Voraussichtlich'], 'Estimated', `${f}: estimated, not expected`);
}
// Popup sides: an airport without times keeps its plate with only the airport row; no airport and no times: no section.
{
  const h = house(); setTz(false);
  const bare = fl('p1', { time_scheduled_departure: undefined, time_scheduled_arrival: undefined, time_estimated_arrival: undefined,
    airport_origin_name: 'Testville Intl', airport_origin_terminal: '2' });
  moving(h, bare);
  const html2 = popupTimes(h, bare);
  assert.equal((html2.match(/--casora-popup-row-fill/g) || []).length, 2, 'airport but no times: both plates stay');
  assert.ok(texts(html2).includes('Abflug AAA \u00b7 Testville Intl \u00b7 Terminal 2 Ankunft BBB'), 'airport but no times: only the airport row, the place text as its title');
  assert.ok(!/Geplant|Voraussichtlich|Tatsächlich/.test(html2), 'airport but no times: no kind rows');
  const none = fl('p2', { time_scheduled_departure: undefined, airport_origin_code_iata: undefined });
  moving(h, none);
  const t3 = texts(popupTimes(h, none));
  assert.ok(!t3.includes('Abflug'), 'no airport and no times on a side: no section');
  assert.ok(t3.includes('Ankunft BBB'), 'the other side stays');
  const empty = fl('p3', { time_scheduled_departure: undefined, time_scheduled_arrival: undefined, time_estimated_arrival: undefined,
    airport_origin_code_iata: undefined, airport_destination_code_iata: undefined });
  moving(h, empty);
  assert.equal(popupTimes(h, empty), '', 'nothing on either side: no part at all');
}
// Every plate value is 14/600 (the movement plate too), not 15/600.
{
  const h = house(); const f = fl('v1'); moving(h, f);
  const mv = F.sec('fmove', { src: 'sensor.a', flight: 'v1' }, h.states, h);
  assert.match(mv, /font-size:14px;font-weight:600/, 'plate values are 14/600');
  assert.doesNotMatch(mv, /font-size:15px;font-weight:600/, 'no 15/600 value left');
}
console.log('flights_times: all checks passed');
