// The Flights saver's globe files load late: only when Globe is on and the saver shows a flight, only from the integration's
// own assets/globe/, never from the internet. Until they have arrived, or when they cannot be read, the saver shows the flat
// map with no error text, and a new try comes with the next screensaver start.
//   node dev/unit/screensaver_globe_load.mjs
// @deckt: custom_components/casora/scripts/local/46-screensaver.js#mount,globeLoad,loadScript
import assert from 'node:assert/strict';
import { page, globeFiles, settle } from './lib/globe_page.mjs';

const all = globeFiles();
const ERROR_TEXT = /error|fehler|failed|could not|konnte/i;

// Flat (the default): nothing is requested, ever.
{
  const R = page(all).start();
  await settle(); R.api.update(); await settle();
  assert.deepEqual(R.box.requests, [], 'Flat: no file is loaded');
  assert.match(R.host.innerHTML, /cs-fl-svg/, 'the flat map is drawn');
}

// Globe: the files come one after the other from assets/globe/ (d3-array before d3-geo, which needs it), then the land.
{
  const R = page(all); R.vars = { casora_flights_map: 'globe' }; R.start();
  const flat = R.host.innerHTML;
  assert.match(flat, /cs-fl-svg/, 'until the files are there: the flat map');
  await settle();
  assert.deepEqual(R.box.requests, ['d3-array.min.js', 'd3-geo.min.js', 'topojson-client.min.js', 'land-110m.json'].map((n) => '/casora_assets/globe/' + n));
  assert.ok(R.box.requests.every((u) => u.startsWith('/casora_assets/globe/')), 'nothing comes from the internet');
  assert.equal(R.S.globeReady(), true, 'the files are ready');
  R.api.update(); await settle();
  assert.equal(R.box.requests.length, 4, 'ready once: no second load');
}

// Not loaded while Globe is on but the saver shows no flight (the kind is another).
{
  const R = page(all); R.vars = { casora_flights_map: 'globe' };
  R.api = R.S.mount(R.host, null, { every: 3600000, kind: () => 'himmel', context: () => ({ hass: R.hass, vars: R.vars, now: new Date(R.clock) }) });
  R.api.update(); await settle();
  assert.deepEqual(R.box.requests, [], 'Globe on, another kind on show: nothing loaded');
}

// A file that fails to load, or is missing: flat map, no error text, no retry until the next start; the next start tries again.
for (const [what, files] of [['a script fails', { ...all, 'd3-geo.min.js': undefined }], ['the land is missing', { ...all, 'land-110m.json': undefined }]]) {
  const R = page(files); R.vars = { casora_flights_map: 'globe' }; R.start();
  const flat = R.host.innerHTML;
  await settle();
  const first = R.box.requests.length;
  assert.ok(first > 0, what + ': it tried');
  assert.equal(R.S.globeReady(), false, what + ': not ready');
  R.api.update(); await settle();
  assert.equal(R.host.innerHTML, flat, what + ': still the flat map');
  assert.ok(!ERROR_TEXT.test(R.host.innerHTML.replace(/<[^>]+>/g, ' ').replace(/Unreported|Remaining/g, '')), what + ': no error text');
  assert.equal(R.box.requests.length, first, what + ': no new try while this screensaver runs');
  R.api.destroy();
  R.start(); await settle(); // the next screensaver start
  assert.ok(R.box.requests.length > first, what + ': a new start tries again');
}
console.log('screensaver_globe_load: ok');
