// The globe's files ship inside the integration (assets/globe/): d3-geo with the d3-array it needs, topojson-client, the
// Natural Earth 110 m land and the countries. They run together as plain scripts without a bundler or the internet, keep their licence
// headers, and the licence file names every part.
//   node dev/unit/globe_assets.mjs
// @deckt: custom_components/casora/assets/globe
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const dir = new URL('../../custom_components/casora/assets/globe/', import.meta.url);
const read = (n) => fs.readFileSync(new URL(n, dir), 'utf8');

// The browser runs them as module scripts, where the UMD wrapper falls back to the global object. A bare context does the same.
const ctx = vm.createContext({});
for (const f of ['d3-array.min.js', 'd3-geo.min.js', 'topojson-client.min.js']) vm.runInContext(read(f), ctx, { filename: f });
assert.equal(vm.runInContext('typeof d3.geoOrthographic + typeof d3.geoPath + typeof topojson.feature', ctx), 'functionfunctionfunction');

// Headers: the ISC notice of each library stays at the top of its file.
assert.match(read('d3-geo.min.js'), /^\/\/ https:\/\/d3js\.org\/d3-geo\/ v3\.1\.1 Copyright 2010-2024 Mike Bostock/);
assert.match(read('d3-array.min.js'), /^\/\/ https:\/\/d3js\.org\/d3-array\/ v3\.2\.4 Copyright 2010-2023 Mike Bostock/);
assert.match(read('topojson-client.min.js'), /^\/\/ https:\/\/github\.com\/topojson\/topojson-client v3\.1\.0 Copyright 2019 Mike Bostock/);

// The land turns into a real shape: Natural Earth 110 m has the land of Africa and a sea off it.
ctx.topology = JSON.parse(read('land-110m.json'));
vm.runInContext('feature = topojson.feature(topology, topology.objects.land)', ctx);
const inLand = (lon, lat) => vm.runInContext('d3.geoContains(feature, [' + lon + ', ' + lat + '])', ctx);
assert.equal(inLand(20, 5), true, 'central Africa is land');
assert.equal(inLand(-30, 0), false, 'the middle of the Atlantic is sea');

// The countries (soft borders): the world-atlas countries topology, with the countries object the saver meshes.
const countries = JSON.parse(read('countries-110m.json'));
assert.equal(countries.type, 'Topology');
assert.ok(countries.objects && countries.objects.countries, 'countries-110m.json has objects.countries');
ctx.countries = countries;
assert.equal(vm.runInContext('topojson.mesh(countries, countries.objects.countries, (a, b) => a !== b).type', ctx), 'MultiLineString', 'the inner borders are a mesh');

const lic = read('LICENSE.md');
assert.match(lic, /`land-110m\.json` /); assert.match(lic, /`countries-110m\.json` .*world-atlas/, 'LICENSE.md lists countries-110m.json');
for (const name of ['d3-geo', 'd3-array', 'topojson-client', 'world-atlas', 'Natural Earth', 'ISC', 'public domain']) assert.ok(lic.includes(name), 'LICENSE.md names ' + name);
console.log('globe_assets: ok');
