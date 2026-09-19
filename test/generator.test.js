import assert from 'node:assert/strict';
import test from 'node:test';
import { RING_SIZE, WHEEL_COUNT, isSolved, windowRows } from '../src/engine.js';
import { DIFFICULTIES, generateLock, stripSolution } from '../src/generator.js';
import { createSearch, goalMask, search } from '../src/solver.js';
import { answers, valid } from './helpers.js';

const base = { valid, answers };

function generate(difficulty, seed) {
  const lock = generateLock({ ...base, difficulty, seed });
  assert.ok(lock, `expected a ${difficulty} lock for seed ${seed}`);
  return lock;
}

test('the same seed always produces the same lock', () => {
  assert.deepEqual(generate('medium', 'repeatable'), generate('medium', 'repeatable'));
  assert.notDeepEqual(generate('medium', 'one'), generate('medium', 'two'));
});

test('generated locks are well formed', () => {
  const lock = generate('medium', 'shape');
  assert.equal(lock.rings.length, WHEEL_COUNT);
  for (const ring of lock.rings) {
    assert.equal(ring.length, RING_SIZE);
    assert.ok(ring.every((letter) => /^[A-Z]$/.test(letter)), `bad ring ${ring}`);
  }
  assert.equal(lock.start.length, WHEEL_COUNT);
  assert.ok(lock.start.every((offset) => offset >= 0 && offset < RING_SIZE));
  for (const link of lock.links) {
    assert.notEqual(link.from, link.to);
    assert.ok([1, -1].includes(link.sign));
  }
});

test('the answer really is three stacked words', () => {
  const lock = generate('medium', 'answer');
  assert.deepEqual(windowRows(lock, lock.solution), lock.words);
  assert.ok(isSolved(lock, lock.solution, 'full', valid.has));
});

test('the board starts scrambled, not solved', () => {
  for (const seed of ['a', 'b', 'c', 'd']) {
    const lock = generate('medium', seed);
    assert.ok(!isSolved(lock, lock.start, 'combination', valid.has), `seed ${seed} starts solved`);
  }
});

test('recorded par is the true optimum for both modes', () => {
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    const lock = generate(difficulty, `par-${difficulty}`);
    const searchCtx = createSearch(lock);
    for (const mode of ['combination', 'full']) {
      const found = search(searchCtx, goalMask(lock, mode, valid), lock.start);
      assert.equal(found.par, lock.par[mode], `${difficulty} ${mode}`);
    }
  }
});

test('each difficulty meets its own bar', () => {
  for (const [difficulty, config] of Object.entries(DIFFICULTIES)) {
    for (const seed of [1, 2, 3]) {
      const lock = generate(difficulty, `${difficulty}-${seed}`);
      assert.ok(lock.par.full >= config.minPar.full, `${difficulty} full par ${lock.par.full}`);
      assert.ok(
        lock.par.combination >= config.minPar.combination,
        `${difficulty} combination par ${lock.par.combination}`,
      );
      assert.ok(lock.par.full <= config.maxPar.full, `${difficulty} full par ${lock.par.full}`);
      assert.ok(lock.links.length >= config.linkCount[0]);
      assert.ok(lock.links.length <= config.linkCount[1]);
      assert.equal(lock.seized.length, config.seizedCount);
    }
  }
});

test('a seized wheel is driven by a link and never drives one itself', () => {
  for (const seed of [1, 2, 3, 4]) {
    const lock = generate('hard', `seized-${seed}`);
    for (const wheel of lock.seized) {
      assert.ok(
        lock.links.some((link) => link.to === wheel),
        'a seized wheel needs a link that can move it',
      );
      assert.ok(
        !lock.links.some((link) => link.from === wheel),
        'a seized wheel cannot drive a chain it can never turn',
      );
    }
  }
});

test('there is more than one way to spell a middle-row word', () => {
  // Decoys are the point of the filler letters: combination mode should have
  // somewhere to land besides the intended answer.
  const lock = generate('medium', 'decoys');
  assert.ok(lock.stats.combinationGoals > lock.stats.fullGoals);
});

test('a themed lock only uses words from its theme', () => {
  const theme = { clue: 'Shades', words: ['amber', 'beige', 'black', 'brown', 'coral', 'cream', 'green', 'ivory'] };
  const lock = generateLock({ ...base, theme, difficulty: 'easy', seed: 'themed' });
  assert.ok(lock, 'expected a themed lock');
  assert.equal(lock.theme.clue, 'Shades');
  for (const word of lock.words) {
    assert.ok(theme.words.includes(word.toLowerCase()), `${word} is not in the theme`);
  }
});

test('publishing a lock drops the answer', () => {
  const published = stripSolution(generate('easy', 'strip'));
  assert.equal(published.solution, undefined);
  assert.equal(published.words, undefined);
  assert.ok(published.rings && published.start && published.par);
});
