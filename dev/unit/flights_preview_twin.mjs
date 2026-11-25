// Tracked flights in the Studio preview (#423): when the Studio draft holds no value for a setting, the preview falls back
// like the live tile: the saved value, then the desktop twin of a phone dashboard (<name>-mobile).
//   node dev/unit/flights_preview_twin.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#setting,draftOf,units,twinOf,fetchTwin
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SRC = fs.readFileSync(new URL('../../custom_components/casora/scripts/local/49-flights.js', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));
const UNIT = 'casora_flights_altitude_unit';

const page = ({ pathname, draft, saved = {} }) => {
  const P = { reads: [], waiting: [], hass: {} };
  const ctx = {
    console, Promise,
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 0, clearTimeout() {}, addEventListener() {},
    location: { pathname, search: '' },
    document: { querySelector: (s) => (s === 'home-assistant' ? { hass: P.hass } : null), querySelectorAll: () => [] },
    _casoraLovelaceCfg: () => ({ views: [{ cards: [{ variables: saved }] }] }),
    _casoraPartnerInfo: (hass, url) => { P.reads.push(url); return new Promise((resolve) => P.waiting.push(resolve)); },
    _casoraStudioPanel: { isConnected: true, _state: { compact: { rooms: [{ variables: draft }] } } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  P.F = ctx._casoraFlights;
  return P;
};

// A phone dashboard, the draft holds the source but no unit: the desktop twin's unit shows.
let P = page({ pathname: '/qa-mobile/0', draft: { casora_flights_source: 'sensor.a' } });
P.F.units(); // asks the twin
assert.deepEqual(P.reads, ['qa'], 'the preview asks the desktop twin');
P.waiting.shift()({ flights: { [UNIT]: 'm' } });
await tick();
assert.equal(P.F.units().altitude, 'm', 'the preview shows the twin unit (metres), as the live phone tile does');

// The draft's own value still wins over the twin.
P = page({ pathname: '/qa-mobile/0', draft: { casora_flights_source: 'sensor.a', [UNIT]: 'km' } });
P.F.units();
assert.equal(P.F.units().altitude, 'km', 'a draft value wins over the twin');

// A desktop dashboard: no twin, the saved value answers, nothing saved means the source unit.
P = page({ pathname: '/qa/0', draft: { casora_flights_source: 'sensor.a' }, saved: { [UNIT]: 'm' } });
assert.equal(P.F.units().altitude, 'm', 'the draft holds no unit: the saved value answers');
assert.deepEqual(P.reads, [], 'a desktop reads no twin');
P = page({ pathname: '/qa/0', draft: { casora_flights_source: 'sensor.a' } });
assert.equal(P.F.units().altitude, '', 'nothing saved, no twin: the source unit');

console.log('flights_preview_twin: all checks passed');
