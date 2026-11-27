// The Flights saver's globe files load late: only when the saver shows a flight, only from the integration's own assets/globe/,
// never from the internet. Until they have arrived, or when they cannot be read, the saver shows the text column alone with no
// error text, and a new try comes with the next screensaver start.
//   node dev/unit/screensaver_globe_load.mjs
// @deckt: custom_components/casora/scripts/local/46-screensaver.js#mount,globeLoad,loadScript
import assert from 'node:assert/strict';
import { page, globeFiles, settle } from './lib/globe_page.mjs';

const all = globeFiles();
const ERROR_TEXT = /error|fehler|failed|could not|konnte/i;

// The files come one after the other from assets/globe/ (d3-array before d3-geo, which needs it), then the land and the countries.
{
  const R = page(all); R.start();
  assert.ok(!/cs-gl-svg/.test(R.host.innerHTML) && /cs-meta/.test(R.host.innerHTML), 'until the files are there: the text column, no globe');
  await settle();
  assert.deepEqual(R.box.requests, ['d3-array.min.js', 'd3-geo.min.js', 'topojson-client.min.js', 'land-110m.json', 'countries-110m.json'].map((n) => '/casora_assets/globe/' + n));
  assert.ok(R.box.requests.every((u) => u.startsWith('/casora_assets/globe/')), 'nothing comes from the internet');
  assert.equal(R.S.globeReady(), true, 'the files are ready');
  R.api.update(); await settle();
  assert.equal(R.box.requests.length, 5, 'ready once: no second load');
}

// Not loaded while the saver shows no flight (the kind is another).
{
  const R = page(all);
  R.api = R.S.mount(R.host, null, { every: 3600000, kind: () => 'himmel', context: () => ({ hass: R.hass, vars: R.vars, now: new Date(R.clock) }) });
  R.api.update(); await settle();
  assert.deepEqual(R.box.requests, [], 'another kind on show: nothing loaded');
}

// A file that fails to load, or is missing: no globe, no error text, no retry until the next start; the next start tries again.
for (const [what, files] of [['a script fails', { ...all, 'd3-geo.min.js': undefined }], ['the land is missing', { ...all, 'land-110m.json': undefined }],
  ['the countries are missing', { ...all, 'countries-110m.json': undefined }]]) {
  const R = page(files); R.start();
  const flat = R.host.innerHTML;
  await settle();
  const first = R.box.requests.length;
  assert.ok(first > 0, what + ': it tried');
  assert.equal(R.S.globeReady(), false, what + ': not ready');
  R.api.update(); await settle();
  assert.equal(R.host.innerHTML, flat, what + ': still no globe');
  assert.ok(!ERROR_TEXT.test(R.host.innerHTML.replace(/<[^>]+>/g, ' ').replace(/Unreported|Remaining/g, '')), what + ': no error text');
  assert.equal(R.box.requests.length, first, what + ': no new try while this screensaver runs');
  R.api.destroy();
  R.start(); await settle(); // the next screensaver start
  assert.ok(R.box.requests.length > first, what + ': a new start tries again');
}
console.log('screensaver_globe_load: ok');
