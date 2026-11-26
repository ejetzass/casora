// Loads window.casoraDayWord (00-finder.js, block casora-day-word) into a window-like object, for tests that run
// one module on its own.
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../../../custom_components/casora/scripts/local/00-finder.js', import.meta.url), 'utf8');
export function loadDayWord(win) {
  const a = src.indexOf('// casora-day-word:start'), b = src.indexOf('// casora-day-word:end');
  if (a < 0 || b < a) throw new Error('casora-day-word block not found in 00-finder.js');
  new Function('window', src.slice(a, b))(win);
  return win.casoraDayWord;
}
// Same, inside a vm context (its own Date, e.g. a test clock): for tests that run 06-kalender.js in vm.createContext.
export function loadDayWordIn(ctx) {
  const a = src.indexOf('// casora-day-word:start'), b = src.indexOf('// casora-day-word:end');
  if (a < 0 || b < a) throw new Error('casora-day-word block not found in 00-finder.js');
  vm.runInContext(src.slice(a, b), ctx);
  return ctx.window.casoraDayWord;
}
