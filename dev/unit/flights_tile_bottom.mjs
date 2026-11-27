// The Flights tile keeps its name and state where every other Casora tile has them: at the bottom of the tile, the icon at the
// top left. With one flight or more, the tile shows only the icon, the name and the state line (no flight rows), in
// casora_entity's own grid (icon / name / state, the free space above the name). The phone tile (icon left, text right) is not
// changed. Desktop: no rule of the tile CSS (F._tileCss) gives the card its own areas or rows. Phone: the one @media rule.
//   node dev/unit/flights_tile_bottom.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#TILE_CSS,liveHtml,airborne,liveHidden,defineTileList,setTileButton
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SRC = fs.readFileSync(new URL('../../custom_components/casora/scripts/local/49-flights.js', import.meta.url), 'utf8');
class FakeHTMLElement { setAttribute() {} getAttribute() { return null; } getRootNode() { return null; } }
const ctx = {
  console, Date, Math, Intl, JSON, HTMLElement: FakeHTMLElement,
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => null, querySelectorAll: () => [], createElement: (tag) => ({ tag }) },
  setTimeout: () => ({}), clearTimeout() {}, addEventListener() {},
  customElements: { get: () => undefined, define() {} },
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const css = ctx._casoraFlights._tileCss;

// The tile CSS as a list of rules: { media, sel, decl }. Only what the tile CSS uses: flat rules and one @media block.
const rules = (src) => {
  const out = [];
  const re = /(@media[^{]*)\{((?:[^{}]*\{[^{}]*\})*)\}|([^{}@]+)\{([^{}]*)\}/g;
  const decls = (body) => Object.fromEntries(body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).replace(/\s*!important$/, '').trim()]; }));
  for (let m; (m = re.exec(src));) {
    if (m[1]) {
      const inner = /([^{}]+)\{([^{}]*)\}/g;
      for (let n; (n = inner.exec(m[2]));) out.push({ media: m[1].trim(), sel: n[1].trim(), decl: decls(n[2]) });
    } else out.push({ media: null, sel: m[3].trim(), decl: decls(m[4]) });
  }
  return out;
};
const desktop = rules(css).filter((r) => !r.media);
const container = (set) => set.filter((r) => /^#container\b/.test(r.sel) && !/#state/.test(r.sel));

// ── Desktop and tablet: the entity's own grid, nothing moves the name or state to the top ──
const many = container(desktop);
assert.ok(many.length > 0, 'precondition: the tile CSS has a rule for the card grid');
for (const r of many) {
  assert.equal(r.decl['grid-template-rows'], undefined, 'the rows stay the entity rows (free space above, name and state at the bottom)');
  assert.equal(r.decl['grid-template-areas'], undefined, 'the areas stay icon / name / state');
}

// ── One flight is the same tile as two or more: only the state line, no flight rows ──────────────────
const F = ctx._casoraFlights;
const MIN = 60000, T0 = 1800000000000;
const hass = { entities: {}, states: {} };
const setSource = (flights) => {
  hass.entities = { 'sensor.a': { entity_id: 'sensor.a', platform: 'flightradar24', device_id: 'd1', translation_key: 'additional_tracked' } };
  hass.states = { 'sensor.a': { entity_id: 'sensor.a', state: String(flights.length), attributes: { flights } } };
};
const fl = (id) => ({
  id, flight_number: 'XY' + id, callsign: 'TST' + id, aircraft_registration: 'T-AAAA', tracked_type: 'live', on_ground: 0,
  latitude: 51, longitude: 4.5, altitude: 31000, ground_speed: 450, heading: 90, vertical_speed: 0, airline_short: 'Testair',
  airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB', details_updated_at: T0,
  airport_origin_latitude: 50, airport_origin_longitude: 4, airport_destination_latitude: 52, airport_destination_longitude: 5,
  time_estimated_arrival: T0 / 1000 + 3600,
});
let base = T0;
const tile = (ids) => {
  base += 10 * MIN;
  setSource(ids.map(fl));
  F.liveHidden(hass, base);
  setSource(ids.map((id) => ({ ...fl(id), latitude: 51.05 })));
  F.liveHidden(hass, base + 2 * MIN);
  return F.liveHtml(hass, '', base + 3 * MIN, 'Flüge');
};
for (const ids of [['1'], ['1', '2']]) {
  const html = tile(ids);
  const text = html.replace(/<[^>]*>/g, '');
  assert.equal(text, ids.length + ' in der Luft', ids.length + ' flight(s): the tile text is only the state line');
  assert.doesNotMatch(html, /data-flights-row|data-flights-bar|XY1|AAA|BBB|\d ft|\d kn/, ids.length + ' flight(s): no flight rows, route, numbers or bar in the tile');
}
assert.doesNotMatch(css, /:has\(|data-flights-row/, 'the tile CSS has no one-flight form and no row rule');
const phoneRules = rules(css).filter((r) => r.media);
assert.equal(phoneRules.length, 1, 'one phone rule');
assert.equal(phoneRules[0].decl['grid-template-rows'], 'min-content minmax(0,1fr)', 'phone: the heading row is as high as its text, the state takes the rest');

console.log('ok: flights tile bottom');
