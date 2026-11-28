// @deckt: custom_components/casora/panel/casora-panel-settings.js#_csSaverPreview
// The Studio's camera picker sits in the shared expander row, without switching away from rotation.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.style = { setProperty() {} };
    this.className = '';
    this.classList = {
      add: (name) => { this.className += ' ' + name; },
      contains: (name) => this.classes().includes(name),
      toggle: (name, on) => {
        const rest = this.classes().filter((x) => x !== name);
        this.className = (on ? [...rest, name] : rest).join(' ');
      },
    };
    this.isConnected = true;
  }
  classes() { return this.className.split(/\s+/).filter(Boolean); }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  insertBefore(child) { this.appendChild(child); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  getRootNode() { return this.parentElement ? this.parentElement.getRootNode() : this.rootNode || null; }
  querySelectorAll(selector) { return nodes(this).slice(1).filter((node) => node.classes().includes(selector.slice(1))); }
  focus() { this.getRootNode().activeElement = this; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text || this.children.map((child) => child.textContent).join(''); }
  click() { this.onclick?.(); }
}
const read = (path) => fs.readFileSync(new URL('../../custom_components/casora/' + path, import.meta.url), 'utf8');
class Panel {}
// The Studio's fold code remembers an open row here (like the browser does).
const memory = new Map();
const context = vm.createContext({
  console, localStorage: { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) }, document: { createElement: (tag) => new Element(tag), querySelector: () => null, addEventListener() {} },
  customElements: { whenDefined: () => Promise.resolve(), get: () => Panel },
  matchMedia: () => ({ matches: false }), location: { pathname: '/', search: '' },
  setInterval: () => 0, clearInterval() {},
});
context.window = context;
vm.runInContext(read('scripts/local/00-finder.js'), context);
vm.runInContext(read('scripts/local/46-screensaver.js'), context);
context._casoraSaver.mount = () => ({ update() {}, destroy() {} });
vm.runInContext(read('panel/casora-panel-settings.js'), context);
// The shared expander row (.adv > .advsum) comes from the Studio's fold code.
vm.runInContext(read('panel/casora-panel-b-ux.js'), context);
await new Promise((resolve) => setImmediate(resolve));
function nodes(root) { return [root, ...root.children.flatMap(nodes)]; }
// The shared row around the camera list, its closed grey line and its bold word.
const fold = (root) => nodes(root).find((node) => node.classes().includes('adv')
  && nodes(node).some((n) => n.classes().includes('advsum') && n.children[0]?.textContent === 'Choose cameras'));
const head = (root) => fold(root).children.find((node) => node.classes().includes('advsum'));
const grey = (root) => nodes(head(root)).find((node) => node.classes().includes('uxsum')).textContent;
const cameraList = (root) => nodes(root).find((node) => node.dataset.key === 'casora_screensaver_cameras');
const rotationRow = (root) => nodes(root).find((node) => node.dataset.key === 'casora_screensaver_mix')
  ?.children.flatMap(nodes).find((node) => node.dataset.id === 'kameras');
const isOpen = (root) => fold(root).classes().includes('open');

function render(variables = {}) {
  memory.clear();
  const panel = new Panel();
  panel._state = { compact: { rooms: [{ name: 'Mock room', variables: structuredClone(variables) }] } };
  panel._hass = { devices: {}, entities: {}, states: {
    'camera.example_door': { entity_id: 'camera.example_door', state: 'idle',
      attributes: { friendly_name: 'Mock door', entity_picture: '/api/camera_proxy/camera.example_door' } },
  } };
  panel.dirtyCalls = 0;
  panel._markDirty = () => { panel.dirtyCalls++; };
  panel._mirrorToPair = () => {};
  const root = new Element('div');
  panel._csRender = () => { root.textContent = ''; panel._csSaverPreview(root, new Element('div')); };
  panel._csSaverPreview(root, new Element('div'));
  return { panel, root };
}

for (const [name, variables] of [
  ['default rotation', {}],
  ['explicit rotation', { casora_screensaver_kind: 'mix', casora_screensaver_mix: ['wort', 'kameras'] }],
  ['cameras only', { casora_screensaver_kind: 'kameras' }],
]) {
  const { panel, root } = render(variables);
  assert.ok(fold(root), name + ' wraps the cameras in the shared row');
  assert.equal(nodes(root).filter((node) => node.classes().includes('cs-saver-camera-choose')).length, 0,
    name + ' has no separate Choose cameras button');
  assert.equal(isOpen(root), false, name + ' starts closed');
  assert.equal(head(root).getAttribute('aria-expanded'), 'false');
  assert.equal(grey(root), 'Automatic', name + ' shows the current choice in the grey line');
  if (variables.casora_screensaver_kind === 'kameras') {
    const lists = nodes(root).find((node) => node.className === 'cs-saver-lists');
    const chips = nodes(root).find((node) => node.className === 'cs-saver-chips');
    assert.equal(fold(root).parentElement, lists, 'single-mode row is below the mode choices');
    assert.ok(lists.parentElement.children.indexOf(chips) < lists.parentElement.children.indexOf(lists));
  } else {
    assert.equal(fold(root).parentElement, rotationRow(root).parentElement, 'rotation row is beside Cameras');
    assert.equal(nodes(fold(root)).filter((node) => node.className === 'fhead').length, 0,
      'the row word is the heading of the picker');
  }
  assert.ok(cameraList(root), 'the camera list is inside the row');
  assert.ok(nodes(fold(root)).includes(cameraList(root)));
  const before = JSON.stringify(panel._state);
  head(root).click();
  assert.equal(isOpen(root), true);
  assert.equal(head(root).getAttribute('aria-expanded'), 'true');
  head(root).click();
  assert.equal(isOpen(root), false);
  assert.equal(JSON.stringify(panel._state), before, 'opening and closing does not change settings');
  assert.equal(panel.dirtyCalls, 0, 'opening and closing does not mark settings dirty');
}
for (const variables of [
  { casora_screensaver_mix: ['wort'] },
  { casora_screensaver_kind: 'wort' },
]) {
  const { root } = render(variables);
  assert.equal(fold(root), undefined, 'no camera row when Cameras is not active');
  assert.equal(cameraList(root), undefined, 'no camera picker when Cameras is not active');
}
{
  const { panel, root } = render({ casora_screensaver_cameras: ['camera.example_door'] });
  assert.equal(grey(root), '1 camera', 'one picked camera is counted');
  rotationRow(root).click();
  assert.equal(fold(root), undefined, 'excluding Cameras hides the row and picker');
  assert.equal(cameraList(root), undefined);
  rotationRow(root).click();
  assert.ok(fold(root), 'including Cameras restores the row');
  assert.deepEqual(Array.from(panel._state.compact.rooms[0].variables.casora_screensaver_cameras),
    ['camera.example_door'], 'rotation inclusion does not clear camera choices');
}
{
  const { root } = render({ casora_screensaver_cameras: ['camera.example_door', 'camera.gone'] });
  assert.equal(grey(root), '1 camera', 'a stored camera that no longer exists is not counted');
}
{
  const { panel, root } = render({ casora_screensaver_cameras: ['camera.example_door'] });
  head(root).click();
  nodes(cameraList(root)).find((node) => node.dataset.id === 'auto').click();
  assert.equal(panel._state.compact.rooms[0].variables.casora_screensaver_cameras, undefined,
    'Automatic restores the existing default selection');
  assert.equal(panel.dirtyCalls, 1, 'camera selection is a settings draft change');
  assert.equal(panel._state.compact.rooms[0].variables.casora_screensaver_kind, undefined,
    'choosing cameras keeps rotation mode');
  assert.equal(isOpen(root), true, 'selection keeps the row open');
  assert.equal(grey(root), 'Automatic');
}
{
  // Keyboard focus stays on the tapped camera row after the list is drawn again.
  const { root } = render();
  root.rootNode = { activeElement: null };
  head(root).click();
  const camera = () => nodes(cameraList(root)).find((node) => node.dataset.id === 'camera.example_door');
  camera().focus();
  const tapped = camera();
  tapped.click();
  assert.notEqual(camera(), tapped, 'the list was drawn again');
  assert.equal(root.rootNode.activeElement, camera(), 'tapping a camera keeps focus on its row');
  const elsewhere = new Element('button');
  root.rootNode.activeElement = elsewhere;
  camera().click();
  assert.equal(root.rootNode.activeElement, elsewhere, 'a redraw does not steal unrelated focus');
}
{
  const { panel, root } = render({ casora_screensaver_cameras: ['camera.example_door'] });
  head(root).click();
  nodes(root).find((node) => node.dataset.kind === 'kameras').click();
  assert.equal(panel._state.compact.rooms[0].variables.casora_screensaver_kind, 'kameras');
  assert.equal(grey(root), '1 camera');
  nodes(root).find((node) => node.dataset.kind === 'mix').click();
  assert.equal(panel._state.compact.rooms[0].variables.casora_screensaver_kind, undefined);
  assert.deepEqual(Array.from(panel._state.compact.rooms[0].variables.casora_screensaver_cameras),
    ['camera.example_door'], 'switching modes retains camera choices');
}
{
  const { panel } = render();
  panel._hass.states = {};
  const empty = new Element('div');
  panel._csSaverPreview(empty, new Element('div'));
  assert.equal(grey(empty), '0 cameras', 'nothing available shows the count with 0');
  head(empty).click();
  assert.ok(fold(empty).textContent.includes('No camera found. The preview shows an example.'),
    'empty camera picker retains its explanation');
}
// Texts of the closed row: the new count words exist in every language, as source and as built file.
const words = ['1 camera', '{n} cameras', '1 photo'];
for (const lang of ['de', 'es', 'fr', 'it', 'nb', 'nl', 'pl', 'pt']) {
  const source = JSON.parse(read('translations/panel/' + lang + '.json')).exact;
  const built = JSON.parse(read('panel/i18n/' + lang + '.json')).exact;
  for (const word of words) {
    assert.ok(source[word], lang + ' translates ' + word);
    assert.equal(built[word], source[word], lang + ' built file has ' + word);
  }
  assert.notEqual(source['{n} cameras'], '{n} cameras', lang + ' does not copy English');
  assert.match(source['{n} cameras'], /\{n\}/, lang + ' keeps the count');
}
assert.equal(JSON.parse(read('translations/panel/de.json')).exact['Choose cameras'], 'Kameras wählen');
console.log('screensaver_camera_picker: ok');
