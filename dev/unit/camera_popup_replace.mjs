// Automatic camera popup replacement at the lifecycle and popup navigation boundary.
// @deckt: custom_components/casora/scripts/local/45-ring-popup.js#_casoraRingPopup
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let now = 1800000000000;
class Clock extends Date { static now() { return now; } }
function screen() {
  const store = new Map(), opened = [];
  const element = { isConnected: true, hasAttribute: name => name === 'open' && !!popup.current };
  const popup = {
    enabled: true, element, current: null, entity: null,
    open(cfg) {
      const back = cfg.back || window._casoraBackNext?.fn || null;
      this.current = back && !cfg.back ? { ...cfg, back } : cfg;
      this.entity = cfg.entity;
      element._backFn = back;
      window._casoraBackNext = null;
      opened.push(this.current);
    },
    close() { this.current = null; this.entity = null; },
  };
  const document = { hidden: false, addEventListener() {}, querySelector: () => ({
    hass: { panels: { dashboard: { component_name: 'lovelace' } } },
  }) };
  const window = { document, casoraPopup: popup, _casoraRing: { route: () => 'dashboard' },
    localStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
    _casoraOpenViaCard: (id, done, { cfg }) => { popup.open(cfg); done(true); } };
  vm.runInNewContext(fs.readFileSync(new URL('../../custom_components/casora/scripts/local/45-ring-popup.js', import.meta.url), 'utf8'), { window, Date: Clock, Number, JSON });
  function trigger(camera, role, entity = `${role}.${camera}`, at = now) {
    return window._casoraRingPopup.open({ camera, role, entity, at, id: String(at) }, { entity: camera });
  }
  return { popup, element, trigger, opened, back: () => window._casoraRingPopup.back(popup) };
}

{
  const s = screen();
  await s.trigger('camera.a', 'doorbell');
  await s.trigger('camera.b', 'doorbell');
  assert.equal(s.popup.entity, 'camera.b', 'another ring replaces a ring popup');
  s.back();
  assert.equal(s.popup.entity, 'camera.a', 'Back restores the replaced ring');
}
for (const initial of ['doorbell', 'detection']) {
  for (const next of ['doorbell', 'detection']) {
    const s = screen();
    await s.trigger('camera.a', initial);
    await s.trigger('camera.a', next, `other.${next}`);
    assert.equal(s.opened.length, 1, `${next} from the shown camera does not replace ${initial}`);
  }
}
{
  const s = screen();
  s.popup.open({ entity: 'light.mock' });
  s.element.touched = true;
  await s.trigger('camera.a', 'detection');
  assert.equal(s.popup.entity, 'light.mock', 'detection leaves a touched modal alone');
  await s.trigger('camera.a', 'doorbell');
  assert.equal(s.popup.entity, 'camera.a', 'ring replaces a touched modal');
  s.back();
  assert.equal(s.popup.entity, 'light.mock', 'Back restores the modal');
}
{
  const s = screen();
  await s.trigger('camera.a', 'detection');
  s.element.touched = true;
  await s.trigger('camera.b', 'detection');
  assert.equal(s.popup.entity, 'camera.b', 'detection replaces a touched detection');
  await s.trigger('camera.c', 'doorbell');
  assert.equal(s.popup.entity, 'camera.c', 'ring replaces a detection');
  await s.trigger('camera.d', 'detection');
  assert.equal(s.popup.entity, 'camera.c', 'detection never replaces a ring');
  s.back();
  assert.equal(s.popup.entity, 'camera.b', 'Back restores the last detection');
  await s.trigger('camera.e', 'detection');
  assert.equal(s.popup.entity, 'camera.e', 'restored detection counts as a popup');
  s.back();
  s.back();
  assert.equal(s.popup.entity, 'camera.a', 'successive Back actions restore the full chain');
}
{
  const s = screen();
  await s.trigger('camera.a', 'doorbell', 'doorbell.shared');
  await s.trigger('camera.b', 'doorbell', 'doorbell.other');
  now += 30000;
  await s.trigger('camera.a', 'doorbell', 'doorbell.shared');
  assert.equal(s.popup.entity, 'camera.b', 'cooldown follows the trigger across replacements');
  now += 30000;
  await s.trigger('camera.a', 'doorbell', 'doorbell.shared');
  assert.equal(s.popup.entity, 'camera.a', 'the trigger can open after one minute');
}
console.log('camera popup: replacement, navigation, and cooldown');
