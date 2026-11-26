// The day wording ("Heute" / "Morgen" / weekday / date) is written once: window.casoraDayWord (00-finder.js).
// Every caller keeps its own look through the options: translator, weekday window, date format.
//   node dev/unit/day_wording.mjs
// @deckt: 00-finder.js#casoraDayWord
process.env.TZ = 'Europe/Berlin';
import assert from 'node:assert/strict';
import { loadDayWord } from './lib/day_word.mjs';

const word = loadDayWord({});
const now = new Date(2026, 10, 19, 23, 30);   // Thursday 19.11.2026, late evening
const at = (n) => new Date(2026, 10, 19 + n, 0, 5);
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const weekday = (d) => WD[d.getDay()];

// Today and tomorrow are words, by calendar day (not 24-hour blocks).
assert.equal(word(at(0), { now }), 'Heute');
assert.equal(word(at(1), { now }), 'Morgen');
assert.equal(word(new Date(2026, 10, 20, 23, 59), { now }), 'Morgen', 'late tomorrow is still tomorrow');
// The translator is applied to the two words only.
assert.equal(word(at(0), { now, tr: (x) => x + '!' }), 'Heute!');
assert.equal(word(at(1), { now, tr: (x) => x + '!' }), 'Morgen!');
assert.equal(word(at(3), { now, tr: (x) => x + '!', weekday }), 'So', 'a weekday is the caller\'s text');

// Default for the rest: d.m. without padding; no weekday unless asked.
assert.equal(word(at(3), { now }), '22.11.');
assert.equal(word(at(-2), { now }), '17.11.');
// Weekday window: 2 up to 6 days ahead; "back" adds the days before today.
assert.equal(word(at(2), { now, weekday }), 'Sa');
assert.equal(word(at(6), { now, weekday }), 'Mi');
assert.equal(word(at(7), { now, weekday }), '26.11.');
assert.equal(word(at(-2), { now, weekday }), '17.11.', 'no window back by default');
assert.equal(word(at(-2), { now, weekday, back: 7 }), 'Di');
assert.equal(word(at(-7), { now, weekday, back: 7 }), '12.11.');
// Own date format for what is left.
assert.equal(word(at(10), { now, date: (d) => 'on ' + d.getDate() }), 'on 29');
// Days before today: a date by default, "Heute" where the caller wants a line that never says yesterday.
assert.equal(word(at(-1), { now }), '18.11.');
assert.equal(word(at(-1), { now, past: 'today' }), 'Heute');
assert.equal(word(at(-5), { now, past: 'today', weekday, back: 7 }), 'Heute');
// A day count stands for the day too (the waste result has {days}); only the two words, '' for the rest.
assert.equal(word(0), 'Heute');
assert.equal(word(1), 'Morgen');
assert.equal(word(2), '');
assert.equal(word(1, { tr: (x) => x.toUpperCase() }), 'MORGEN');
// Not a Date and not a count: nothing, never "NaN.NaN.".
assert.equal(word(undefined), '');
assert.equal(word('2026-11-20', { now }), '');
assert.equal(word(new Date('x'), { now }), '');
assert.equal(word(null), '');
// Without options "now" is the real clock.
assert.equal(word(new Date()), 'Heute');
console.log('day_wording ok');
