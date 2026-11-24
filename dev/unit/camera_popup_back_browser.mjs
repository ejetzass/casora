// Real popup frame and Back buttons, with the camera card opener isolated from Home Assistant.
// @deckt: custom_components/casora/scripts/local/45-ring-popup.js#_casoraRingPopup custom_components/casora/scripts/casora-core.js#CasoraPopup
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const npx = path.join(os.homedir(), '.npm', '_npx');
const cached = (fs.existsSync(npx) ? fs.readdirSync(npx) : [])
  .map(d => path.join(npx, d, 'node_modules', 'playwright', 'index.mjs')).find(fs.existsSync);
let chromium;
try { ({ chromium } = await import(cached || 'playwright')); }
catch { console.log('camera popup Back browser: skipped (no Playwright)'); process.exit(0); }

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  await page.route('http://casora.test/**', route => route.fulfill({ contentType: 'text/html', body: '<home-assistant></home-assistant>' }));
  await page.goto('http://casora.test/dashboard/0');
  await page.evaluate(() => {
    document.querySelector('home-assistant').hass = { panels: { dashboard: { component_name: 'lovelace' } }, states: {} };
    window.CASORA_POPUP = true;
    window._casoraRing = { route: () => 'dashboard' };
  });
  await page.addScriptTag({ path: new URL('../../custom_components/casora/scripts/casora-core.js', import.meta.url).pathname });
  await page.addScriptTag({ path: new URL('../../custom_components/casora/scripts/local/45-ring-popup.js', import.meta.url).pathname });
  await page.evaluate(() => {
    window._casoraOpenViaCard = async (id, done, { cfg }) => {
      await window.casoraPopup.open({ title: cfg.title, content: cfg.title, _entity: id });
      done(true);
    };
    window.offer = (camera, role) => {
      const at = Date.now();
      return window._casoraRingPopup.open({ camera, role, entity: role + '.' + camera, at, id: String(at) }, { title: camera });
    };
  });
  await page.evaluate(() => window.casoraPopup.open({ title: 'Modal', content: 'Modal' }));
  await page.evaluate(() => window.offer('camera.modal', 'doorbell'));
  assert.equal(await page.evaluate(() => window.casoraPopup.current.title), 'camera.modal');
  const back = page.locator('casora-popup').locator('.header-back');
  await back.click();
  await page.waitForFunction(() => window.casoraPopup.current?.title === 'Modal');
  assert.equal(await back.isHidden(), true, 'the original modal has no Back button');
  await page.evaluate(() => window.casoraPopup.close());
  await page.evaluate(() => window.offer('camera.a', 'detection'));
  await page.evaluate(() => window.offer('camera.b', 'detection'));
  assert.equal(await page.evaluate(() => window.casoraPopup.current.title), 'camera.b');
  await page.evaluate(() => window.offer('camera.c', 'doorbell'));
  assert.equal(await page.evaluate(() => window.casoraPopup.current.title), 'camera.c');
  await back.click();
  await page.waitForFunction(() => window.casoraPopup.current?.title === 'camera.b');
  await page.evaluate(() => window.offer('camera.d', 'detection'));
  assert.equal(await page.evaluate(() => window.casoraPopup.current.title), 'camera.d', 'restored detection retains its role');
  for (const title of ['camera.b', 'camera.a']) {
    await back.click();
    await page.waitForFunction(t => window.casoraPopup.current?.title === t, title);
  }
  assert.equal(await back.isHidden(), true, 'the original detection has no Back button');
  console.log('camera popup Back browser: real popup stack and buttons passed');
} finally {
  await browser.close();
}
