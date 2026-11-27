// The globe for people who cannot see or touch it: a screen reader gets a short description in the active language, and no touch or
// drag moves the globe (pointer input passes through it, nothing listens).
//   node dev/unit/screensaver_globe_access.mjs
// @deckt: custom_components/casora/scripts/local/46-screensaver.js#globeSvg,CSS
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page, globeFiles, settle } from './lib/globe_page.mjs';

const LABEL = { de: 'Globus mit dem Flug', en: 'Globe showing the flight', nl: 'Globe met de vlucht', es: 'Globo terráqueo con el vuelo', fr: 'Globe avec le vol',
  it: 'Globo con il volo', nb: 'Globus med flyvningen', pl: 'Globus z lotem', pt: 'Globo com o voo' };
const phrases = (lang) => JSON.parse(fs.readFileSync(new URL('../../custom_components/casora/translations/dashboard/phrases/' + lang + '.json', import.meta.url), 'utf8')).exact;

const show = async (lang) => {
  const R = page(globeFiles());
  // The page's translator: German source text in, the active language out (what casora-i18n.js does with the phrase files).
  const table = lang === 'de' ? {} : phrases(lang);
  R.box.casoraTr = (t) => (table[t] != null ? table[t] : t);
  R.start(); await settle(); R.api.update();
  return R;
};

for (const lang of Object.keys(LABEL)) {
  const html = (await show(lang)).host.innerHTML;
  const svg = html.match(/<svg class="cs-gl-svg"[^>]*>/);
  assert.ok(svg, lang + ': the globe is drawn');
  assert.match(svg[0], /role="img"/, lang + ': the globe is one image for a screen reader');
  assert.ok(svg[0].includes('aria-label="' + LABEL[lang] + '"'), lang + ': the label is "' + LABEL[lang] + '", got ' + svg[0]);
  assert.ok(!/aria-hidden/.test(svg[0]), lang + ': the globe is not hidden from a screen reader');
}

// No touch, no drag: the disc and its box let pointer input through, and the markup has no handler.
{
  const R = await show('en');
  const css = R.S.CSS, html = R.host.innerHTML;
  const rule = (sel) => (new RegExp(sel.replace(/\./g, '\\.') + '\\{([^}]*)\\}').exec(css) || [])[1] || '';
  assert.match(rule('.cs-sv .cs-fl-globe'), /pointer-events:none/, 'the globe box ignores pointer input');
  assert.match(rule('.cs-sv .cs-gl-svg'), /pointer-events:none/, 'the globe picture ignores pointer input');
  assert.match(rule('.cs-sv .cs-gl-svg'), /touch-action:none/, 'a touch on the globe does not scroll or pan');
  const globe = html.slice(html.indexOf('cs-fl-globe'), html.indexOf('</svg>'));
  assert.ok(!/\son[a-z]+\s*=/i.test(globe), 'no inline handler on the globe');
  assert.ok(!/tabindex/i.test(globe), 'not a Tab stop');
}
console.log('screensaver_globe_access: ok');
