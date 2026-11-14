// The ring popup's way back (_casoraRingPopup.back): the return path of ‹ for code that closes a popup by
// itself (the two-minute rule). A sub page returns to the page before, a top page closes.
// @deckt: custom_components/casora/scripts/local/45-ring-popup.js
//   node dev/unit/popup_back.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../../custom_components/casora/scripts/local/45-ring-popup.js', import.meta.url), 'utf8');
const window = {};
vm.runInContext(src, vm.createContext({ window }));
const back = window._casoraRingPopup.back;

const make = (open = true) => {
  const attrs = new Set(open ? ['open'] : []);
  const popup = { closed: 0, close() { attrs.delete('open'); this.closed++; } };
  popup.element = { _backFn: null, _navBackAt: 0, hasAttribute: k => attrs.has(k) };
  return popup;
};

let popup = make(false);
back(popup);
assert.equal(popup.closed, 0, 'a popup that is not open is left alone');
back({ element: null });

popup = make();
let backs = 0;
popup.element._backFn = () => { backs++; };
back(popup);
assert.equal(backs, 1, 'back uses the same way as ‹');
assert.ok(popup.element._navBackAt > 0, 'the return is marked, so the page slides in from the left');
assert.equal(popup.closed, 0);

popup.element._backFn = null;
back(popup);
assert.equal(popup.closed, 1, 'a top page closes');
console.log('ok popup_back');
