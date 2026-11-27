// The fuel prices map finds the Leaflet map of a Leaflet ha-map (no WebGL2). HA 2026.11 keeps it on ha-map._engine.leafletMap,
// older HA directly on ha-map.leafletMap; lmOf never hands out a MapLibre map for it and keeps its MapLibre wrapper.
// lmOf, lfOf and mlOf are cut out of 12-tanken.js and run as they are; no browser.
//   node dev/unit/tanken_leaflet_map.mjs
// @deckt: custom_components/casora/scripts/local/12-tanken.js#lmOf,lfOf,mlOf
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';

const src = fs.readFileSync(new URL('../../custom_components/casora/scripts/local/12-tanken.js', import.meta.url), 'utf8');
const a = Math.min(...['  var lfOf = ', '  var mlOf = '].map((k) => src.indexOf(k)).filter((i) => i >= 0));
const b = src.indexOf('  window._casoraHaMap = {');
assert.ok(a > 0 && b > a, 'lfOf, mlOf and lmOf sit together before window._casoraHaMap');
assert.ok(/var lmOf = /.test(src.slice(a, b)), 'lmOf is among them');
const { lmOf, mlOf } = vm.runInNewContext(src.slice(a, b) + '; ({ lmOf: lmOf, mlOf: mlOf })', {});
const same = (x, y, m) => assert.strictEqual(JSON.stringify(x), JSON.stringify(y), m);

// Leaflet map as HA 2026.11 builds it: an object with getSize (the engine has no _map).
const leafletMap = { getSize() { return { x: 1, y: 1 }; }, setView() {} };
const calls = [];
const mlMap = {
  project: ([lng, lat]) => ({ x: lng, y: lat }), unproject: (pt) => ({ lng: pt.x, lat: pt.y }),
  resize: () => calls.push(['resize']), jumpTo: (o) => calls.push(['jumpTo', o]),
};

// The real shape of HA 2026.11.
const el = { _engine: { leafletMap } };
assert.strictEqual(lmOf(el), leafletMap, 'HA 2026.11: the Leaflet map from ha-map._engine.leafletMap');
// Older HA.
assert.strictEqual(lmOf({ leafletMap }), leafletMap, 'older HA: ha-map.leafletMap');
// A Leaflet engine next to a MapLibre-looking _map: still the Leaflet map, never the wrapper.
assert.strictEqual(lmOf({ _engine: { leafletMap, _map: mlMap } }), leafletMap, 'a Leaflet map is never replaced by a MapLibre wrapper');
// mlOf (the ready poll's MapLibre branch) ignores an engine that has a Leaflet map, also next to a MapLibre-looking _map.
assert.strictEqual(mlOf({ _engine: { leafletMap, _map: mlMap } }), null, 'mlOf: an engine with a Leaflet map is not a MapLibre map');
assert.strictEqual(mlOf({ leafletMap, _engine: { _map: mlMap } }), null, 'mlOf: older HA shape with a Leaflet map');
assert.strictEqual(mlOf({ _engine: { _map: mlMap } }), mlMap, 'mlOf: a MapLibre-only engine');
// Nothing to find.
assert.strictEqual(lmOf({ _engine: { leafletMap: {} } }), null, 'an engine map without getSize is not a Leaflet map');
assert.strictEqual(lmOf({ _engine: {} }), null);
assert.strictEqual(lmOf(null), null);

// The MapLibre path as before: a wrapper with Leaflet's interface (lat/lng in, lng/lat to MapLibre, zoom one lower).
const w = lmOf({ _engine: { _map: mlMap } });
assert.ok(w && w !== mlMap, 'MapLibre: a wrapper');
w.setView([50, 8], 13);
same(calls.pop(), ['jumpTo', { center: [8, 50], zoom: 12 }]);
w.invalidateSize();
same(calls.pop(), ['resize']);
same(w.latLngToContainerPoint([50, 8]), { x: 8, y: 50 });
same(w.containerPointToLatLng({ x: 8, y: 50 }), { lat: 50, lng: 8 });

// The ready poll asks the same lookup (it cannot run without a browser, so the source is checked).
assert.match(src, /var lm = lfOf\(m\), mlx = mlOf\(m\);/, 'the ready poll finds the Leaflet map through lfOf');

console.log('ok tanken_leaflet_map');
