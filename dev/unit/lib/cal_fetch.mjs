// Loads the calendar fetch helpers of 00-finder.js (block casora-cal-fetch: casoraCalSpan, casoraWasteJudge,
// casoraCalFetch) into a vm context, for tests that run the calendar module (06-kalender.js) on its own. The Waste
// calendar verdict rule is a stub there: nothing counts as a Waste calendar.
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../../../custom_components/casora/scripts/local/00-finder.js', import.meta.url), 'utf8');
export function loadCalFetch(ctx) {
  const a = src.indexOf('// casora-cal-fetch:start'), b = src.indexOf('// casora-cal-fetch:end');
  if (a < 0 || b < a) throw new Error('casora-cal-fetch block not found in 00-finder.js');
  vm.runInContext(src.slice(a, b), ctx);
  if (!ctx.window.casoraWasteContent) ctx.window.casoraWasteContent = () => false;
}
