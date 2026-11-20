// Tracked flights, the texts a user reads (49-flights.js): every German text the module shows has a translation in
// each of the eight languages that are not German, and the German ellipsis is written with a space ("Läuft …").
//   node dev/unit/flights_texts.mjs
// @deckt: custom_components/casora/scripts/local/49-flights.js
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const src = read('custom_components/casora/scripts/local/49-flights.js');
const LANGS = ['en', 'nl', 'es', 'fr', 'it', 'pl', 'pt', 'nb'];
const phrases = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(read('custom_components/casora/translations/dashboard/phrases/' + l + '.json')).exact || {}]));

// Every single-quoted literal in the module that is a sentence or a label (capital first, letters, no code characters).
const literals = [...new Set([...src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]))].filter((l) =>
  /^[A-ZÄÖÜ][a-zäöüß]/.test(l) && /[a-zäöüß]{3}/.test(l) && !/[{}:;=()\[\]<>]|mdi|data-|flights-|\bkeep\b|\bcut\b/.test(l) && !/^[A-Z][a-z]+\.[a-z]/.test(l) && l !== 'Enter'); // Enter: a key name, not a text

// The rendered German text is the key; each language must carry it.
const missing = [];
literals.forEach((k) => LANGS.forEach((l) => { if (typeof phrases[l][k] !== 'string' || !phrases[l][k].trim()) missing.push(l + ': ' + k); }));
assert.deepEqual(missing, [], 'every text of the module is translated in all eight languages');

// German ellipsis: a space before "…" (wortliste V9). The key carries it, so the translations find it.
const ellipsis = literals.filter((l) => l.endsWith('…'));
assert.ok(ellipsis.length >= 2, 'the module has its progress texts');
ellipsis.forEach((l) => assert.match(l, / …$/, 'German ellipsis has a space: "' + l + '"'));

// Dutch: no English loan word in the module's texts (the wording rule of the Dutch phrase file).
literals.forEach((k) => assert.doesNotMatch(phrases.nl[k] || '', /\b(items?|tracking|stop|status)\b/i, 'nl: no English loan in "' + k + '"'));

// The denial texts name the next step (an administrator grants the access), in every language.
['Keine Berechtigung, den Flug hinzuzufügen. Bitte einen Administrator, dir die Berechtigung zu geben.',
  'Keine Berechtigung, die Verfolgung zu beenden. Bitte einen Administrator, dir die Berechtigung zu geben.'].forEach((k) => {
  assert.ok(literals.includes(k), 'the denial text is in the module: ' + k.slice(0, 30));
});

// One translation helper in the module: a second `var tr` in the same closure hides the first (a reading slip, not a bug today).
assert.equal((src.match(/var tr = /g) || []).length, 1, 'one tr helper in 49-flights.js');

// The Manage tile name may wrap onto a second line: names are one line with an ellipsis everywhere else, and on a phone
// (about 110 px for the name) "Vluchten beheren" was cut to "Vluchten be…". The template keeps the word and wraps it.
{
  const tpl = JSON.parse(read('dashboards/casora/button_card_templates.json')).casora_flights;
  const name = Object.assign({}, ...(tpl.styles.name || []));
  assert.equal(name['white-space'], 'normal !important', 'the name wraps');
  assert.match(String(name['-webkit-line-clamp']), /^2$/, 'at most two lines, then the ellipsis');
  assert.equal(tpl.variables.casora_default_name, 'Flüge verwalten', 'the German label is unchanged');
}

console.log('ok flights_texts');
