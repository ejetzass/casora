// @deckt: dashboards/casora/button_card_templates.json#global, custom_components/casora/scripts/casora-core.js#casoraCameraAlert
// The camera alert helper lives once, in casora-core.js; no template carries its own copy.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const templates = JSON.parse(read('dashboards/casora/button_card_templates.json'));
const copies = [];
const walk = (node, path) => {
  if (typeof node === 'string') {
    if (/casoraCameraAlert\s*=(?!=)/.test(node)) copies.push(path);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'casora_camera_alert_helper') copies.push(`${path}/${key}`);
      walk(value, `${path}/${key}`);
    }
  }
};
walk(templates, '');
assert.deepEqual(copies, [], 'a template carries its own copy of the camera alert helper');

const core = read('custom_components/casora/scripts/casora-core.js');
assert.equal(core.match(/window\.casoraCameraAlert\s*=(?!=)/g)?.length, 1, 'casora-core.js defines the helper exactly once');
console.log('camera_alert_helper_once: ok');
