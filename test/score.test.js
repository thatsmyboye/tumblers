import assert from 'node:assert/strict';
import test from 'node:test';
import { shareText, starsFor, totalStars } from '../src/score.js';

test('stars reward staying near par', () => {
  assert.equal(starsFor(9, 9), 3);
  assert.equal(starsFor(7, 9), 3);
  assert.equal(starsFor(11, 9), 2);
  assert.equal(starsFor(14, 9), 2);
  assert.equal(starsFor(15, 9), 1);
  // Short pars still leave room for a two-star finish.
  assert.equal(starsFor(4, 2), 2);
  assert.equal(starsFor(5, 2), 1);
});

test('share text matches the published format', () => {
  assert.equal(
    shareText({ number: 42, mode: 'full', moves: 11, par: 9, undos: 2, themeRevealed: true }),
    ['Tumblers #42 · Full Lock 🔓', 'Moves 11 / par 9 ⭐⭐', 'Undos 2 ↩️ 💡'].join('\n'),
  );
});

test('an unrevealed theme leaves the bulb off', () => {
  const text = shareText({ number: 7, mode: 'combination', moves: 4, par: 4, undos: 0 });
  assert.equal(text, ['Tumblers #7 · Combination 🔐', 'Moves 4 / par 4 ⭐⭐⭐', 'Undos 0 ↩️'].join('\n'));
});

test('a finished daily shares both legs and the bonus star', () => {
  const text = shareText({
    number: 42,
    mode: 'daily',
    legs: [
      { label: 'Combination', moves: 4, par: 4 },
      { label: 'Full Lock', moves: 11, par: 9 },
    ],
    undos: 2,
    bonusStar: true,
  });
  assert.equal(
    text,
    [
      'Tumblers #42 · Daily 🔓',
      'Combination 4 / par 4 ⭐⭐⭐',
      'Full Lock 11 / par 9 ⭐⭐ 🌟',
      'Undos 2 ↩️',
    ].join('\n'),
  );
  assert.equal(totalStars([{ moves: 4, par: 4 }, { moves: 11, par: 9 }], { bonusStar: true }), 6);
});

test('a hint caps the lock at two stars and shows in the share', () => {
  assert.equal(starsFor(9, 9, { hinted: true }), 2);
  assert.equal(starsFor(11, 9, { hinted: true }), 2);
  assert.equal(starsFor(20, 9, { hinted: true }), 1);
  assert.equal(
    shareText({ number: 3, mode: 'full', moves: 9, par: 9, undos: 0, hints: 2, themeRevealed: true }),
    ['Tumblers #3 · Full Lock 🔓', 'Moves 9 / par 9 ⭐⭐', 'Undos 0 ↩️ · Hints 2 🔍 💡'].join('\n'),
  );
  assert.equal(totalStars([{ moves: 4, par: 4 }], { hinted: true }), 2);
});

test('a practice lock shares without a puzzle number', () => {
  const text = shareText({ number: null, mode: 'combination', moves: 5, par: 4 });
  assert.equal(text.split('\n')[0], 'Tumblers · Combination 🔐');
});
