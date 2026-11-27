// @deckt: dashboards/casora/button_card_templates.json#global, custom_components/casora/scripts/casora-core.js#casoraCameraAlert
// The camera alert helper lives once, in casora-core.js. Templates and scripts/local/*.js may only guard it or call it.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

// Every piece of text that could carry a copy: each string of the templates, each scripts/local file.
const texts = [];
const collect = (node, path) => {
  if (typeof node === 'string') texts.push([path, node]);
  else if (node && typeof node === 'object') for (const [key, value] of Object.entries(node)) collect(value, `${path}/${key}`);
};
collect(JSON.parse(read('dashboards/casora/button_card_templates.json')), 'templates');
for (const file of fs.readdirSync(new URL('custom_components/casora/scripts/local/', root)).filter((f) => f.endsWith('.js'))) {
  texts.push([`scripts/local/${file}`, read(`custom_components/casora/scripts/local/${file}`)]);
}

// (a) A use is a guard or a call. Anything else (assignment, ||=, window['..'], Object.assign) is a copy.
const use = /(?:typeof\s+)?window\.casoraCameraAlert(?=\s*(?:\(|\)|&&|\?(?![?.=])|[!=]==))/g;
const misuse = texts.filter(([, text]) => text.replace(use, '').includes('casoraCameraAlert')).map(([path]) => path);
assert.deepEqual(misuse, [], 'a template or local script does more with casoraCameraAlert than guard or call it');

// (b) Strings only the helper has: a renamed copy still carries them.
const helperOnly = ['_casoraListedCameraAlerts', '_casoraCameraAlertClock', '/ding|doorbell|button/'];
const copies = texts.flatMap(([path, text]) => helperOnly.filter((s) => text.includes(s)).map((s) => `${path}: ${s}`));
assert.deepEqual(copies, [], 'a template or local script carries a copy of the camera alert helper');

const core = read('custom_components/casora/scripts/casora-core.js');
assert.equal(core.match(/window\.casoraCameraAlert\s*=(?!=)/g)?.length, 1, 'casora-core.js defines the helper exactly once');
for (const s of helperOnly) assert.ok(core.includes(s), `casora-core.js holds the helper body (${s})`);
console.log('camera_alert_helper_once: ok');
