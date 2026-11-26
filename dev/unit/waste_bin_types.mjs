// Bin types: a stored list replaces the fixed bin table in 00-finder.js. Fake hass, no HA.
//   LC_ALL=en_US.UTF-8 TZ=UTC node dev/unit/waste_bin_types.mjs
// @deckt: 00-finder.js#waste, 00-finder.js#binTypes, 00-finder.js#binTypeOf, custom_components/casora/panel/casora-panel-personal.js#normalize, custom_components/casora/panel/casora-panel-personal.js#prune
import fs from 'node:fs';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.document = { querySelector: () => null };
globalThis.addEventListener = () => {};
globalThis.customElements = { get: () => null, define() {}, whenDefined: () => new Promise(() => {}) };
const read = (f) => fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
new Function(read('custom_components/casora/scripts/local/00-finder.js'))();
new Function(read('custom_components/casora/panel/casora-panel-personal.js'))();
const { normalize, prune } = window.casoraPersonal;

const iso = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const CAL = 'calendar.afval';
const hass = { states: { [CAL]: { state: 'off', attributes: { friendly_name: 'Afval' } } }, entities: {}, devices: {} };
const cal = (...titles) => { window._casoraTrashCal = { id: CAL, ts: Date.now(),
  ev: titles.map((t, i) => ({ summary: t, start: { date: iso(i + 1) }, end: { date: iso(i + 2) } })) }; };
const bins = (...titles) => { cal(...titles); return window.casoraDevice.waste(hass, { trash_calendar: CAL }).bins; };
const setBins = (v) => { window.CASORA_SETTINGS = v === undefined ? {} : { bin_types: v }; };

// Old fixed table (copied as a literal: the independent truth for the differential test).
const OLD = [
  ['bio', /bio|organ|kompost|green waste|gft|groente|tuinafval|groenafval/i], ['paper', /papier|paper|pappe|(?:^|[^a-z])karton|altkarton|cardboard/i],
  ['yellow', /wertstoff|gelb|plastik|plastic|verpack|verpakking|recycl|pmd|pbd|drankenkarton|drankkarton/i], ['glass', /glas|glass/i],
  ['bulky', /sperr|bulky|grofvuil|grof afval/i], ['hazard', /problem|schadstoff|sonderm|gift|hazard|chemisch/i],
  ['rest', /rest|residual|general|haus|black|huisvuil/i],
];
const CORPUS = ['Biotonne', 'Biomüll', 'GFT', 'Groente-, fruit- en tuinafval', 'Green waste', 'Kompost', 'Papier', 'Altpapier', 'Papier/Karton',
  'Oud papier en karton', 'Karton', 'Kartonagen', 'Altkarton', 'Cardboard', 'Paper', 'Pappe', 'Drankkarton', 'Plastic, metaal en drankenkartons', 'PMD', 'PBD',
  'Gelber Sack', 'Gelbe Tonne', 'Wertstoff', 'Wertstofftonne', 'Verpackung', 'Verpakkingen', 'Plastik', 'Recyclinghof', 'Glas', 'Altglas', 'Glass', 'Glasverpackung',
  'Sperrmüll', 'Sperrmuell', 'Grofvuil', 'Grof afval', 'Bulky waste', 'Schadstoffmobil', 'Problemstoffe', 'Sondermüll', 'Giftmüll', 'Chemisch afval', 'Hazard',
  'Restmüll', 'Restafval', 'Huisvuil', 'General waste', 'Hausmüll', 'Black bin', 'Residual waste', 'Restmüll 240 l', 'Bio- und Restmüll', 'Papier und Restmüll', 'Verpackungskarton'];
const SOFT = (k) => 'var(--casora-waste-' + k + ',';
window._casoraSoft = () => true;
setBins();
const diff = [];
CORPUS.forEach((t) => {
  const want = OLD.find(([, re]) => re.test(t))[0], b = bins(t);
  assert.equal(b.length, 1, t + ': one bin');
  if (b[0].color.indexOf(SOFT(want)) !== 0) diff.push(t + ' → ' + b[0].color + ' (old ' + want + ')');
});
assert.deepEqual(diff, [], 'ready-made list matches the old table');
window._casoraSoft = () => false;
assert.equal(bins('Pappkarton')[0].color, '#0A84FF', 'Pappkarton: paper now (it matched nothing before)');

// 1. Ready-made list: label, colour, icon as before.
let b = bins('Restmüll', 'Biotonne').find((x) => x.label === 'Restmüll');
assert.equal(b.label, 'Restmüll'); assert.equal(b.color, '#8E8E93'); assert.equal(b.icon, 'mdi:trash-can-outline');
assert.equal(window.casoraDevice.waste(hass, { trash_calendar: CAL }).next.icon, 'mdi:trash-can-outline');
assert.equal(bins('Papier/Karton')[0].color, '#0A84FF');
assert.equal(bins('Plastic, metaal en drankenkartons')[0].color, '#FFCC00', 'drankenkartons is no paper (a word inside a longer word of another entry is ignored)');
assert.equal(bins('Sperrmüll')[0].color, '#FF9F0A', 'bulky keeps the orange');

// 3. One rule for events with no Bin type, stored list or not: they stay bins (orange, colour word).
const unmatched = () => bins('Kerstbomen', 'Grüne Tonne', 'Biotonne', 'Restmüll').map((x) => [x.label, x.color]);
const without = unmatched();
assert.deepEqual(without.find((x) => x[0] === 'Kerstbomen'), ['Kerstbomen', '#FF9F0A']);
assert.deepEqual(without.find((x) => x[0] === 'Grüne Tonne'), ['Grüne Tonne', '#30D158']);
setBins({ list: window.casoraBinReady().map((e) => ({ key: e.key, words: e.words, color: e.color, icon: e.icon })) });
assert.deepEqual(unmatched(), without, 'a stored copy of the ready-made list gives the same bins');
setBins();

// 2. Dutch words, colour and icon from a stored list.
setBins({ list: [{ words: ['groenbak', 'tuin'], name: 'Groene bak', color: '#123456', icon: 'mdi:leaf' },
  { words: ['a.c', 'x+'], name: 'Plain', color: 'var(--casora-color-red, #ff0000)', icon: 'mdi:star' }] });
cal('GROENBAK week 3', 'Biotonne', 'abc', 'a.c', 'xx', 'x+', 'Verjaardag', 'Grüne Tonne');
const W = window.casoraDevice.waste(hass, { trash_calendar: CAL });
assert.deepEqual(W.bins.map((x) => x.label).filter((l) => ['Groene bak', 'Plain'].includes(l)).sort(), ['Groene bak', 'Plain', 'Plain'], 'abc and xx match no entry (words are plain text); the unmatched events stay bins as before');
const g = W.bins.find((x) => x.label === 'Groene bak');
assert.equal(g.color, '#123456'); assert.equal(g.icon, 'mdi:leaf'); assert.equal(g.days, 1);
const p = W.bins.find((x) => x.label === 'Plain');
assert.equal(p.color, 'var(--casora-color-red, #ff0000)'); assert.equal(p.icon, 'mdi:star');
assert.match(p.tint, /^color-mix\(/, 'a var() colour gets a tint that is not parsed as hex');
assert.equal(W.next.icon, 'mdi:leaf', 'the tile icon follows the next pickup');
assert.equal(W.next.label, 'Groene bak');

// A ready-made entry renamed by the user shows that name; without a name it keeps the event title.
setBins({ list: [{ key: 'rest', name: 'Zwarte bak' }, { key: 'bio' }] });
b = bins('Restafval', 'GFT');
assert.deepEqual(b.map((x) => x.label).sort(), ['GFT', 'Zwarte bak']);
assert.equal(b.find((x) => x.label === 'Zwarte bak').color, '#8E8E93', 'key fills in colour and words');
assert.equal(bins('Papier')[0].color, '#FF9F0A', 'a deleted entry no longer matches: not paper blue');
// An explicit per-sensor name wins over the Bin type name.
setBins({ list: [{ words: ['restafval'], name: 'Zwarte bak', color: '#111111' }] });
const sens = { states: { 'sensor.r': { state: '40', attributes: { friendly_name: 'Afval' } }, [CAL]: hass.states[CAL] }, entities: {}, devices: {} };
const own = window.casoraDevice.waste(sens, { trash_sensors: { 'sensor.r': 'Restafval thuis' } }).bins[0];
assert.equal(own.label, 'Restafval thuis'); assert.equal(own.color, '#111111');
assert.equal(window.casoraDevice.waste(sens, { trash_sensors: ['sensor.r'] }).bins[0].color, '#FF9F0A', 'no word in the sensor name: no Bin type');
// A renamed ready-made entry without a colour (bulky): its sensor bin still finds its events by the words.
setBins({ list: [{ key: 'bulky', name: 'Mijn grofvuil' }] });
cal('Grofvuil');
const bk = { states: { 'sensor.g': { state: '40', attributes: { friendly_name: 'Grofvuil' } }, [CAL]: hass.states[CAL] }, entities: {}, devices: {} };
const bkBin = window.casoraDevice.waste(bk, { trash_sensors: ['sensor.g'], trash_calendar: CAL }).bins[0];
assert.equal(bkBin.label, 'Mijn grofvuil'); assert.equal(bkBin.days, 1, 'the calendar event is found');
// A sensor bin matching no Bin type keeps the colour word / orange fallback.
setBins();
const s2 = { states: { 'sensor.x': { state: '3', attributes: { friendly_name: 'Green thing' } } }, entities: {}, devices: {} };
assert.equal(window.casoraDevice.waste(s2, { trash_sensors: ['sensor.x'] }).bins[0].color, '#30D158');

// Storage: an empty list is an explicit list; it survives prune, an absent key stays absent.
assert.deepEqual(normalize({}).bin_types, {}); assert.equal(prune(normalize({})).bin_types, undefined);
const kept = prune(normalize({ bin_types: { list: [] } }));
assert.deepEqual(kept.bin_types, { list: [] }, 'empty user list survives prune');
setBins(kept.bin_types);
assert.deepEqual(bins('Restmüll', 'Biotonne').map((x) => x.color), ['#FF9F0A', '#FF9F0A'], 'an empty stored list: no Bin type, no kind colour');
const full = prune(normalize({ bin_types: { list: [{ words: ['a'], name: '', color: '', icon: 'mdi:star' }] } }));
assert.deepEqual(full.bin_types, { list: [{ words: ['a'], icon: 'mdi:star' }] });

// The tile, the popup rows and the put-out row take the icon from the Bin type.
const T = JSON.parse(read('dashboards/casora/button_card_templates.json')).casora_trash;
assert.match(T.icon, /W\.next\.icon/); assert.match(T.show_icon, /W\.next\.icon/);
assert.match(T.custom_fields ? '' : read('dashboards/casora/button_card_templates.json'), /icon: b\.icon \|\|/);
assert.match(read('custom_components/casora/scripts/local/50-waste-out.js'), /W\.next\.icon/);
console.log('waste_bin_types ok');
