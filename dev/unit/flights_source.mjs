// Tracked flights, shared source boundary (49-flights.js): which FlightRadar24 source sensor is found, how the choice
// resolves, what the Manage flights list shows, and that none of it writes to tracking.
//   node dev/unit/flights_source.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js#present,sources,resolve,entries,choices,controls,tile,popup,sec
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const calls = [];
const eq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);
const ctx = { console, setTimeout: () => 0, localStorage: { getItem: () => null, setItem() {} }, document: { querySelector: () => null } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(read('custom_components/casora/scripts/local/49-flights.js'), ctx);
const F = ctx._casoraFlights;
assert.ok(F, 'module registers itself');

// A hand-built hass: registry entries (what hass.entities carries) plus states.
const house = () => {
  const states = {};
  // Like HA: a registry change swaps hass.entities for a new object, it is never changed in place.
  const add = (id, o = {}) => {
    const entities = { ...hass.entities };
    hass.entities = entities;
    entities[id] = { entity_id: id, platform: o.platform || 'flightradar24', device_id: o.dev || null, translation_key: o.key || null, entity_category: o.cat || null };
    if (o.state !== null) states[id] = { entity_id: id, state: o.state ?? 'ok', attributes: o.attrs || {} };
  };
  const hass = { entities: {}, states, add, callService: (...a) => { calls.push(a); return Promise.resolve(); } };
  return hass;
};
const tracked = (id, dev, flights, extra = {}) => ({ id, dev, key: 'additional_tracked', state: String((flights || []).length), attrs: { flights, ...extra } });
const fl = (o) => ({ id: 'x1', flight_number: 'QQ100', tracked_type: 'live', on_ground: 0, ...o });

// ── No integration ──
let h = house();
h.add('sensor.other', { platform: 'pulse', key: 'additional_tracked' });
assert.equal(F.present(h), false, 'another integration with the same key is not FlightRadar24');
eq(F.sources(h), []);
assert.equal(F.resolve(h, '').state, 'none');
assert.equal(F.tile(h, ''), '', 'no word without the integration');
assert.equal(F.present(h), false, 'no FlightRadar24 entry: nothing to show');
assert.equal(F.hidden, undefined, 'the unused hidden() helper is gone: the tile uses present()');
// The Manage tile template evaluates without a missing helper: hidden without the integration, shown with it.
{
  const tpl = JSON.parse(read('dashboards/casora/button_card_templates.json')).casora_flights.hidden;
  const run = (hs) => vm.runInContext('(function(hass){' + tpl.replace(/^\[\[\[|\]\]\]\s*$/g, '') + '})', ctx)(hs);
  assert.equal(run(h), true, 'Manage tile is hidden without the integration');
  const h2 = house(); h2.add('sensor.x', { key: 'additional_tracked', state: '0', attrs: { flights: [] } });
  assert.equal(run(h2), false, 'Manage tile is shown with the integration');
}

// ── One source: found by platform + translation key, whatever it is called ──
h = house();
h.add('sensor.stand_nord_geleid', tracked(null, 'd1', []));
h.add('sensor.stand_nord_geleid', tracked(null, 'd1', [fl({})]));
let r = F.resolve(h, '');
assert.equal(r.state, 'auto');
assert.equal(r.id, 'sensor.stand_nord_geleid');
assert.equal(F.present(h), true);

// Entries with the wrong key, wrong domain or no flights list do not count.
h.add('sensor.no_key', { dev: 'd1', key: null, attrs: { flights: [] } });
h.add('sensor.most_tracked', { dev: 'd1', key: 'most_tracked', attrs: { flights: [] } });
h.add('text.additional_tracked', { dev: 'd1', key: 'additional_tracked', attrs: { flights: [] } });
eq(F.sources(h).map((s) => s.id), ['sensor.stand_nord_geleid']);

// ── Orphan next to a live source ──
h.add('sensor.orphan', { dev: 'dOld', key: 'additional_tracked', state: 'unavailable', attrs: { restored: true, flights: [fl({})] } });
eq(F.sources(h).map((s) => s.id), ['sensor.stand_nord_geleid'], 'orphan skipped');
assert.equal(F.resolve(h, '').state, 'auto', 'the orphan does not make a second source');

// ── Several sources need a choice; Automatic is not allowed ──
h.add('sensor.zweiter', tracked(null, 'd2', []));
assert.equal(F.resolve(h, '').state, 'choose');
assert.equal(F.resolve(h, '').id, null, 'nothing is picked for the user');
r = F.resolve(h, 'sensor.zweiter');
assert.equal(r.state, 'pinned');
assert.equal(r.id, 'sensor.zweiter');

// ── Pinned source disappears: kept, never replaced ──
h.entities = { ...h.entities }; delete h.entities['sensor.zweiter']; delete h.states['sensor.zweiter'];
r = F.resolve(h, 'sensor.zweiter');
assert.equal(r.state, 'missing');
assert.equal(r.id, 'sensor.zweiter', 'the pin is preserved');
assert.equal(r.source, null);
assert.equal(F.entries(h, r.id), null, 'no list from a missing source, and no fallback to the other');
assert.equal(F.tile(h, 'sensor.zweiter'), 'Quelle nicht verfügbar');
// A pinned source that is registered but unavailable stays the source.
h.states['sensor.stand_nord_geleid'] = { state: 'unavailable', attributes: {} };
r = F.resolve(h, 'sensor.stand_nord_geleid');
assert.equal(r.state, 'pinned');
assert.equal(F.entries(h, r.id), null, 'unavailable: list unknown, not empty');
assert.equal(F.tile(h, r.id), 'Quelle nicht verfügbar');

// ── Integration removed, pin kept ──
const gone = house();
r = F.resolve(gone, 'sensor.stand_nord_geleid');
assert.equal(r.state, 'missing');
assert.equal(F.present(gone), false);

// ── Missing part: present but no usable source ──
h = house();
h.add('sensor.stand_nord_geleid', { dev: 'd1', key: 'additional_tracked', attrs: {} });
assert.equal(F.present(h), true);
eq(F.sources(h), [], 'a source sensor without a flights list is not a source');
r = F.resolve(h, '');
assert.equal(r.state, 'none');
eq(r.missing, ['source']);
assert.equal(F.choices(h, '').note, 'parts');
h = house();
h.add('switch.nur_schalter', { dev: 'd1', key: 'scanning' });
eq(F.resolve(h, '').missing, ['source'], 'the integration is there, the source sensor is not');
eq(F.resolve(house(), '').missing, [], 'nothing to say when FlightRadar24 is simply absent');

// ── Studio choices ──
h = house();
h.add('sensor.a', tracked(null, 'd1', []));
let c = F.choices(h, '');
eq(c.options, ['', 'sensor.a']);
assert.equal(c.note, null);
h.add('sensor.b', tracked(null, 'd2', []));
c = F.choices(h, '');
eq(c.options, ['', 'sensor.a', 'sensor.b']);
assert.equal(c.note, 'choose');
assert.equal(c.empty, 'choose', 'the empty value reads as a prompt, not as Automatic');
c = F.choices(h, 'sensor.gone');
eq(c.options, ['', 'sensor.a', 'sensor.b', 'sensor.gone'], 'a stored pin stays selectable');
assert.equal(c.note, 'missing');
assert.equal(c.labels['sensor.gone'], null, 'the missing one is labelled by the Studio, not by data');
assert.equal(F.choices(h, 'sensor.a').note, null);

// ── The picker offers tracked-flights sensors only: a registered entry without a flights list (the integration-level
// "FlightRadar24" entry) is not an option and is not picked as the one source. A pinned one stays, as before.
{
  const g = house();
  g.add('sensor.flight_tracker_one', tracked(null, 'd1', []));
  g.add('sensor.flightradar24', { dev: 'dGhost', key: 'additional_tracked', state: 'unavailable', attrs: {} });
  eq(F.choices(g, '').options, ['', 'sensor.flight_tracker_one'], 'only the tracked-flights sensor is offered');
  assert.equal(F.resolve(g, '').state, 'auto', 'the entry without a list does not make a second source');
  assert.equal(F.resolve(g, '').id, 'sensor.flight_tracker_one');
  g.add('sensor.flight_tracker_two', tracked(null, 'd2', []));
  eq(F.choices(g, '').options, ['', 'sensor.flight_tracker_one', 'sensor.flight_tracker_two'], 'two tracked sensors: a choice, no ghost');
  eq(F.choices(g, 'sensor.flightradar24').options, ['', 'sensor.flight_tracker_one', 'sensor.flight_tracker_two', 'sensor.flightradar24'],
    'a pinned entry without a list stays selectable, as before');
}

// ── Controls resolve by device_id, not by name ──
h = house();
h.add('sensor.a', tracked(null, 'd1', []));
h.add('text.irgendwas', { dev: 'd1', key: 'add_track', cat: 'config', state: '' });
h.add('text.anderes', { dev: 'd1', key: 'remove_track', cat: 'config', state: '' });
h.add('switch.sw', { dev: 'd1', key: 'scanning', cat: 'config', state: 'on' });
h.add('text.fremd', { dev: 'd2', key: 'add_track', cat: 'config', state: '' });
eq({ ...F.controls(h, 'sensor.a') }, { source: 'sensor.a', add: 'text.irgendwas', remove: 'text.anderes', scanning: 'switch.sw', missing: [], ambiguous: [] });
h = house();
h.add('sensor.a', tracked(null, 'd1', []));
h.add('text.fremd', { dev: 'd2', key: 'add_track', cat: 'config', state: '' });
eq(Array.from(F.controls(h, 'sensor.a').missing), ['add', 'remove', 'scanning'], 'a control on another device is not ours');

// ── The list: every entry, no freshness claim ──
h = house();
h.add('sensor.a', tracked(null, 'd1', []));
eq(Array.from(F.entries(h, 'sensor.a')), [], 'empty list is an empty list');
h.states['sensor.a'].attributes.flights = [
  fl({ id: 'a', flight_number: 'QQ100', airline_short: 'Testair', airport_origin_code_iata: 'AAA', airport_destination_code_iata: 'BBB' }),
  fl({ id: 'b', flight_number: '', callsign: 'TST7', tracked_type: 'schedule', on_ground: 1 }),
  fl({ id: 'c', flight_number: null, callsign: null, aircraft_registration: 'N-TEST', tracked_type: 'aircraft', on_ground: 1 }),
  fl({ id: 'd', flight_number: 'QQ200', on_ground: 1 }),
  fl({ id: 'e', flight_number: 'QQ300', on_ground: undefined }),
  { id: 'f' },
];
// The states are translated like every other text: this list is read in English here, as an English user sees it.
ctx.casoraTr = (s) => ({ Geplant: 'Scheduled', 'Am Boden': 'On the ground' })[s] || s;
const list = Array.from(F.entries(h, 'sensor.a'));
delete ctx.casoraTr;
eq(list.map((e) => e.label), ['QQ100', 'TST7', 'N-TEST', 'QQ200', 'QQ300', 'f'], 'every entry, in source order, identity by flight number, callsign, registration, id');
assert.equal(list[0].detail, 'Testair · AAA → BBB');
assert.equal(list[1].detail, 'Scheduled', 'schedule wins over the ground flag');
assert.equal(list[3].detail, 'On the ground');
assert.equal(list[4].detail, '', 'an airborne flag left over is not shown as a state: no freshness proof');
assert.equal(list[5].detail, '', 'missing metadata is omitted');
assert.ok(!list.some((e) => /unterwegs|in der luft|airborne/i.test(e.detail)), 'nothing asserts airborne');

// ── Popup content: escaped, empty state, no calls ──
const noteCalls = [];
const UI = {
  line: (t, f) => `<line>${t}|${(f || []).join(',')}</line>`,
  group: (rows, title, act, opts) => `<group ${opts && opts.keepNames ? 'keep' : 'cut'} ${title || ''}>${rows.map((r) => `${r.label}~${r.sub || ''}`).join(';')}</group>`,
  empty: (o) => `<empty>${o.text}</empty>`,
  stage: (t, o) => `<stage ${o.text || (o.empty && o.empty.text) || ''}>`,
  note: (text) => { noteCalls.push(text); return `<note>${text}</note>`; },
};
ctx.window._casoraUI = UI;
const html = (hass, pin, part) => F.sec(part, { pin }, hass.states, hass);
assert.match(html(h, 'sensor.a', 'list'), />QQ100<\/div>/, 'the list shows the flight number');
assert.match(html(h, 'sensor.a', 'list'), /Testair · AAA → BBB/, 'and the route');
assert.match(html(h, 'sensor.a', 'list'), /data-flights-row="a"/, 'each row carries its FR24 ID for the Stop button');
// Entity text is escaped in the rows, and flight numbers sharing a prefix keep their full names.
h.states['sensor.a'].attributes.flights = [{ id: 'x', flight_number: '<i>XY</i>', tracked_type: 'live', on_ground: 0 }];
assert.ok(!/<i>XY/.test(html(h, 'sensor.a', 'list')), 'entity text is escaped');
assert.match(html(h, 'sensor.a', 'list'), /&lt;i&gt;XY/);
h.states['sensor.a'].attributes.flights = [];
assert.match(html(h, 'sensor.a', 'list'), /Keine verfolgten Flüge/, 'empty list: stated, popup still reachable');
assert.match(html(h, 'sensor.a', 'stage'), /Keine verfolgten Flüge/);
assert.match(html(h, 'sensor.gone', 'stage'), /Quelle nicht verfügbar/);
const two = house(); two.add('sensor.a', tracked(null, 'd1', [])); two.add('sensor.b', tracked(null, 'd2', []));
assert.match(html(two, '', 'stage'), /Quelle für verfolgte Flüge auswählen/);
assert.equal(F.tile(two, ''), 'Quelle für verfolgte Flüge auswählen');
assert.equal(F.tile(h, 'sensor.a'), 'Keine verfolgten Flüge');
h.states['sensor.a'].attributes.flights = [fl({ id: 'a' })];
assert.equal(F.tile(h, 'sensor.a'), '1 verfolgter Flug');
h.states['sensor.a'].attributes.flights = [fl({ id: 'a' }), fl({ id: 'b' })];
assert.equal(F.tile(h, 'sensor.a'), '2 verfolgte Flüge');

// ── Reading the setting from the dashboard config (hero card of a view) ──
const cfg = { views: [{ cards: [{ variables: {} }] }, { cards: [{ variables: { casora_flights_source: 'sensor.a' } }] }] };
assert.equal(F.pinned(cfg), 'sensor.a');
assert.equal(F.pinned({ views: [] }), '');
assert.equal(F.pinned(null), '');

// ── Nothing above wrote to tracking ──
assert.equal(calls.length, 0, 'discovery, resolution, lists and popup never call a service');
// Two write paths only: the Add button's submit and a row's Stop button (flights_add.mjs and flights_stop.mjs cover that
// rendering never reaches them).
const src49 = read('custom_components/casora/scripts/local/49-flights.js');
assert.equal((src49.match(/callService\(/g) || []).length, 2, 'exactly two service calls in the module: add and stop');
assert.equal((src49.match(/text', 'set_value'/g) || []).length, 2, 'both calls are the text set_value');
assert.ok(!/\.callWS/.test(src49), 'no websocket writes');

// ── Wiring ──
const tpl = JSON.parse(read('dashboards/casora/button_card_templates.json'));
eq(tpl.casora_flights.template, ['casora_entity', 'casora_popup_flights']);
assert.equal(tpl.casora_popup_flights.tap_action.casora_popup.variant, 'v3');
assert.ok(read('custom_components/casora/scripts/casora-local.js').includes("'49-flights'"), 'module in MODULES');
// ── Choose or missing: the list says where Casora's source is chosen, so the user has a way forward ──
h = house();
h.add('sensor.a', { dev: 'd1', key: 'additional_tracked', state: '0', attrs: { flights: [] } });
h.add('sensor.b', { dev: 'd2', key: 'additional_tracked', state: '0', attrs: { flights: [] } });
const sourceHint = 'Die Quelle wählst du im Studio unter Einstellungen → Bedienen → Verfolgte Flüge.';
assert.equal(html(h, '', 'list'), `<note>${sourceHint}</note>`, 'choose: the shared note renderer receives the Studio path');
assert.equal(html(h, 'sensor.a', 'list').includes('Studio'), false, 'a chosen source: no hint');
h = house();
h.add('sensor.a', { dev: 'd1', key: 'additional_tracked', state: '0', attrs: { flights: [] } });
assert.equal(html(h, 'sensor.gone', 'list'), `<note>${sourceHint}</note>`, 'missing pin: the shared note renderer receives the Studio path');
assert.deepEqual(noteCalls, [sourceHint, sourceHint], 'the note renderer receives plain text for its admin check and escaping');

console.log('ok flights_source');
