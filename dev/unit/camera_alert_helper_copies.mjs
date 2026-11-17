// @deckt: dashboards/casora/button_card_templates.json#casoraCameraAlert
// window.casoraCameraAlert is defined by whichever template copy runs first, so every copy must be identical.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const templates = JSON.parse(fs.readFileSync(new URL('../../dashboards/casora/button_card_templates.json', import.meta.url), 'utf8'));
const guard = "typeof window.casoraCameraAlert !== 'function'";

const copies = [];
const walk = (node, path) => {
  if (typeof node === 'string') {
    if (node.includes(guard)) copies.push({ path: path.join('.'), source: node });
  } else if (Array.isArray(node)) {
    node.forEach((child, i) => walk(child, [...path, i]));
  } else if (node && typeof node === 'object') {
    Object.entries(node).forEach(([key, child]) => walk(child, [...path, key]));
  }
};
walk(templates, []);

assert.ok(copies.length >= 2, `expected several helper copies, found ${copies.length}`);
const [first, ...rest] = copies;
for (const copy of rest) {
  assert.equal(copy.source, first.source, `${copy.path} differs from ${first.path}`);
}
