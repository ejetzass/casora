// @zustand: arbeit
// @parallel: allein
// @deckt: custom_components/casora/scripts/local/24-klingel.js#KL.status,KL.ago,KL.tileText,KL.hot,HOLD,FRESH dashboards/casora/button_card_templates.json
// The casora_reolink_doorbell inherits casora_camera's image refresh: ring text must age
// without camera state changes. Only the made-up doorbell from dev/casora_mock/klingel.py is used.
// Hold the next image request BEFORE moving Date.now(): the refresh timer can also redraw
// age text, so jumping before that timer would mask a missing image-response requestUpdate.
import { open, casoraDashboard, dashboard, check, need, finish, atFinish, stable } from './lib.mjs';

const started = Date.now();
const ID = 'camera.testklingel_sub';
const dash = await casoraDashboard();
await need('a Casora dashboard', dash);
const { page } = await open({ width: 1440, height: 1000, theme: 'Casora', lang: 'de' });
await dashboard(page, dash.url, 1);
await need('the made-up doorbell', await page.evaluate((id) =>
  !!document.querySelector('home-assistant').hass.states[id], ID));

let pending = null, armed = false;
await page.route('**/api/camera_proxy/' + ID + '*', async (route) => {
  if (armed) {
    armed = false;
    await new Promise((resolve) => { pending = resolve; });
    pending = null;
  }
  await route.continue();
});
atFinish(() => { if (pending) pending(); });
await page.evaluate(async (id) => {
  const ha = document.querySelector('home-assistant');
  // Avoid another tile of this camera competing for the held request.
  window.__pierce('button-card').filter((b) => b._config?.entity === id).forEach((b) => b.remove());
  const helpers = await window.loadCardHelpers();
  const tile = helpers.createCardElement({ type: 'custom:button-card',
    template: 'casora_reolink_doorbell', entity: id, name: 'Testklingel' });
  tile.classList.add('qa-r620');
  tile.style.cssText = 'position:fixed;left:400px;top:300px;width:360px;height:220px;z-index:99990;';
  tile.hass = ha.hass;
  ha.shadowRoot.appendChild(tile);
  window.__r620 = { tile, forward: setInterval(() => {
    const visitor = ha.hass.states['binary_sensor.testklingel_visitor'];
    if (visitor?.state === 'on') window.__r620.rangAt = Date.parse(visitor.last_changed);
    tile.hass = ha.hass;
  }, 200) };
}, ID);
atFinish(() => page.evaluate(() => {
  const q = window.__r620;
  if (!q) return;
  if (q.realNow) Date.now = q.realNow;
  clearInterval(q.forward);
  q.unsubscribe?.();
  q.tile.remove();
  delete window.__r620;
}));

const readTile = () => {
  const b = window.__r620.tile;
  const st = b.shadowRoot?.querySelector('#state');
  if (!st) return null;
  return { text: (st.querySelector('.sf-f') || st).textContent.replace(/\s+/g, ' ').trim(),
    dot: !!st.querySelector('span[aria-hidden="true"]'),
    image: b.style.getPropertyValue('--casora-cam-img') };
};
const look = () => stable(page, readTile, null, { max: 3000, quiet: 150 });
await page.evaluate(async () => document.querySelector('home-assistant').hass.callService(
  'casora_mock', 'klingel_druecken', { dauer: 2, person: 2 }));
await page.waitForFunction(() => {
  const s = document.querySelector('home-assistant').hass.states;
  return ['visitor', 'person', 'motion'].every((k) => s['binary_sensor.testklingel_' + k]?.state === 'off');
}, null, { timeout: 7000 });
// Let the recorder's delayed history retry finish before the clock-only observations.
await page.waitForTimeout(12000);
const initial = await look();
// HA can restore the user's language after the browser's initial language choice.
// Translate fixed expected literals; do not derive expected ages from the tile or its helpers.
const [fresh, two, nine, ready] = await page.evaluate(() =>
  ['Hat geklingelt', 'Geklingelt · vor 2 Min.', 'Geklingelt · vor 9 Min.', 'Bereit']
    .map((s) => (window.casoraTr ? window.casoraTr(s) : s).replace(/\s+/g, ' ').trim()));
await need('ring text and dot with a loaded image', initial?.text === fresh
  && initial.dot && initial.image.includes('blob:'), initial);
await need('the actual press timestamp was observed', await page.evaluate(() =>
  Number.isFinite(window.__r620.rangAt)));

await page.evaluate(async (id) => {
  const ha = document.querySelector('home-assistant'), q = window.__r620;
  clearInterval(q.forward);
  // Retain the actual post-release states, not fakeStates: unrelated house updates must
  // not redraw our tile. Still watch the live camera for ANY state_changed event.
  q.tile.hass = ha.hass;
  q.camera = JSON.stringify(ha.hass.states[id]);
  q.changes = 0;
  q.unsubscribe = await ha.hass.connection.subscribeEvents((event) => {
    if (event.data.entity_id === id) q.changes++;
  }, 'state_changed');
  q.realNow = Date.now;
  q.offset = 0;
  Date.now = () => q.realNow() + q.offset;
}, ID);

for (const [minutes, text, dot] of [
  [2.5, two, true],
  [9.5, nine, true],
  [10.5, ready, false],
]) {
  armed = true;
  const deadline = Date.now() + 14000;
  while (!pending && Date.now() < deadline) await page.waitForTimeout(50);
  await need('the next scheduled image request', pending !== null);
  // Flush the timer's pre-jump render before releasing the held image.
  await page.evaluate(async () => { await window.__r620.tile.updateComplete; });
  const before = await look();
  await page.evaluate((m) => {
    const q = window.__r620;
    q.offset = q.rangAt + m * 60000 - q.realNow();
  }, minutes);
  pending();
  // Three seconds is deliberately shorter than the next 10 s refresh tick. A timer
  // redraw must not rescue a missing image-response redraw in the mutation check.
  const result = await stable(page, readTile, null,
    { max: 3000, until: (v) => v.image !== before.image && v.text === text && v.dot === dot });
  await check(`+${minutes} min: next image redraws ring text and dot`,
    result?.image !== before.image && result?.text === text && result?.dot === dot, result);
  const unchanged = await page.evaluate((id) => {
    const q = window.__r620;
    return q.changes === 0 && JSON.stringify(document.querySelector('home-assistant').hass.states[id]) === q.camera;
  }, ID);
  await check(`+${minutes} min: live camera entity did not change`, unchanged);
}
await check('clock-jump regression finishes in under two minutes', Date.now() - started < 120000,
  { elapsedMs: Date.now() - started });
await finish();
