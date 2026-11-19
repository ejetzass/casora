// Tracked flights: the module's header lists every public member of window._casoraFlights, and no comment describes a
// surface that is not built yet (49-flights.js). Source check, no runtime.
//   node dev/unit/flights_api.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const src = read('custom_components/casora/scripts/local/49-flights.js');

// The header is the comment block at the top: its "window._casoraFlights.<name>" lines.
const header = src.split('\n').filter((l) => l.startsWith('//   window._casoraFlights.')).join('\n');

// Every public member is a top-level assignment F.<name> = (underscore names are private).
const members = [...new Set([...src.matchAll(/^\s*F\.([A-Za-z][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1]))];
assert.ok(members.length >= 30, 'the module has its members: ' + members.length);
const unlisted = members.filter((name) => !new RegExp('\\.' + name + '\\b').test(header));
assert.deepEqual(unlisted, [], 'every public member is in the API header');

// A header entry names something that exists (no stale names).
const listed = [...header.matchAll(/\.([A-Za-z][A-Za-z0-9_]*)(?=\(|\b)/g)].map((m) => m[1]);
const ghosts = [...new Set(listed)].filter((name) => !members.includes(name) && !['fmt', 'altitude', 'speed', 'vspeed', 'heading', 'number', 'casoraFlights', 'flight', 'sec', 'popup'].includes(name));
assert.deepEqual(ghosts, [], 'no header entry names a member that does not exist');

// Comments: no "later" promise for surfaces that this branch does not build.
const stale = src.split('\n').filter((l) => /tile now|later the screensaver|the tile line and later|popup, times, map and screensaver later/.test(l));
assert.deepEqual(stale, [], 'no stale "later" comment about a surface that is not built');

console.log('ok flights_api');
