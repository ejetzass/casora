// The Manage flights tile's count line ("3 gevolgde vluchten") must not end in "…" on a narrow phone tile: the tile gives
// casoraStateFit a short form ("3 vluchten"), the statefit element shows the full text where it fits and the short form
// where it does not; same font size, one line, no change of the tile's height.
// Layout is modelled: text width = characters * 6.5 px (13 px text), the room is the tile's inner width (100 px on a
// 390 px phone, 200 px on desktop). The real tile is measured in the browser (see the ticket).
//   node dev/unit/flights_manage_subtitle.mjs
// @deckt: dashboards/casora/button_card_templates.json#casora_flights
// @deckt: custom_components/casora/scripts/local/49-flights.js#tileShort,tile
// @deckt: custom_components/casora/scripts/casora-core.js#casoraStateFit
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const T = JSON.parse(read('dashboards/casora/button_card_templates.json'));
const stateDisplay = T.casora_flights.state_display.replace(/^\s*\[\[\[/, '').replace(/\]\]\]\s*$/, '');
const LANGS = ['de', 'en', 'es', 'fr', 'it', 'nb', 'nl', 'pl', 'pt'];
const phr = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(read('custom_components/casora/translations/dashboard/phrases/' + l + '.json'))]));
const translate = (l, t) => {
  const P = phr[l];
  if (P.exact && typeof P.exact[t] === 'string') return P.exact[t];
  for (const [re, to] of P.patterns || []) { const m = new RegExp(re).exec(t); if (m) return to.replace(/\{(\d)\}/g, (_, n) => m[n]); }
  return t;
};

// The real casoraStateFit and casora-statefit element (casora-core.js), with a fake element that measures by characters.
const core = read('custom_components/casora/scripts/casora-core.js');
const a = core.indexOf('    window.casoraStateFit = function (text, weight, alt) {');
const b = core.indexOf('    // Nachmessen nach dem Zeichnen');
assert.ok(a > 0 && b > a, 'casoraStateFit and casora-statefit found');
const PX = 6.5;
let room = 0;
const defined = {};
class FakeEl { }
const win = { casoraTextEm: () => 5, casoraEsc: (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) };
new Function('window', 'customElements', 'HTMLElement', core.slice(a, b))(win, { get: (n) => defined[n], define: (n, c) => { defined[n] = c; } }, FakeEl);

// The page: translate the drawn HTML (both forms are in it), then let the element choose by the room it has.
const shown = (html, lang, width) => {
  const tr = translate.bind(null, lang);
  const f = tr(/<span class="sf-f">([^<]*)<\/span>/.exec(html)[1]);
  const sm = /<span class="sf-s"[^>]*><span[^>]*>([^<]*)<\/span>/.exec(html);
  const s = sm ? tr(sm[1]) : '';
  const el = new defined['casora-statefit']();
  const st = { f: { style: {} }, s: { style: {} } };
  el.querySelector = (q) => (q === '.sf-f' ? (s ? st.f : null) : q === '.sf-s' ? (s ? st.s : null) : null);
  Object.defineProperty(el, 'clientWidth', { get: () => room });
  Object.defineProperty(el, 'scrollWidth', { get: () => (st.f.style.display === 'none' ? s.length : f.length) * PX });
  room = width;
  el._fit();
  return st.f.style.display === 'none' ? { form: 'short', text: s } : { form: 'full', text: f };
};
const hassWith = (n) => ({ entities: { 'sensor.a': { entity_id: 'sensor.a', platform: 'flightradar24', device_id: 'd1', translation_key: 'additional_tracked' } },
  states: { 'sensor.a': { entity_id: 'sensor.a', state: String(n), attributes: { flights: Array.from({ length: n }, (_, i) => ({ id: 'h' + i, tracked_type: 'live', flight_number: 'XY' + i })) } } } });
const ctx = { console, Date, Math, Intl, JSON, localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => null, querySelectorAll: () => [], createElement: (tag) => ({ tag, setAttribute() {} }) },
  setTimeout: () => ({}), clearTimeout() {}, addEventListener() {}, HTMLElement: FakeEl, customElements: { get: () => undefined, define() {} } };
ctx.window = ctx;
Object.assign(ctx, win);
vm.createContext(ctx);
vm.runInContext(read('custom_components/casora/scripts/local/49-flights.js'), ctx);
const draw = (n) => new Function('window', 'hass', 'states', 'variables', stateDisplay)(ctx, hassWith(n), {}, {});

const PHONE = 100, DESKTOP = 200;
for (const l of LANGS) {
  for (const n of [1, 9, 12, 25]) {
    const html = draw(n);
    assert.match(html, /<span class="sf-s"/, l + ' ' + n + ': the tile gives a short form');
    const p = shown(html, l, PHONE);
    // The longest languages with a 1- or 2-digit count (full text 19 characters or more) cannot show the full text on the phone.
    if (n >= 9 && ['nb', 'nl', 'pl'].includes(l)) assert.equal(p.form, 'short', l + ' ' + n + ': phone shows the short form: ' + p.text);
    assert.ok(p.text.length * PX <= PHONE, l + ' ' + n + ': the short form fits on the phone: ' + p.text);
    assert.ok(p.text.includes(String(n)), l + ' ' + n + ': the count stays a number: ' + p.text);
    assert.doesNotMatch(p.text, /…/, l + ' ' + n + ': no ellipsis');
    const d = shown(html, l, DESKTOP);
    assert.equal(d.form, 'full', l + ' ' + n + ': desktop shows the full text: ' + d.text);
    const sh = shown(html, l, 1);
    assert.equal(sh.form, 'short', l + ' ' + n + ': the narrowest tile shows the short form');
    assert.ok(d.text.length > sh.text.length, l + ' ' + n + ': the short form is shorter: ' + d.text + ' / ' + sh.text);
  }
}
// Not a count (empty, choose a source): no short form, the text is as before.
const none = { entities: {}, states: {} };
assert.doesNotMatch(new Function('window', 'hass', 'states', 'variables', stateDisplay)(ctx, none, {}, {}), /sf-s/, 'no short form without a count');
console.log('flights_manage_subtitle: ok');
