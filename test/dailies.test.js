import assert from 'node:assert/strict';
import test from 'node:test';
import { RING_SIZE, WHEEL_COUNT, isSolved } from '../src/engine.js';
import { createSearch, goalMask, search } from '../src/solver.js';
import { dailies, valid } from './helpers.js';

test('the baked pack is complete and in order', () => {
  assert.ok(dailies.puzzles.length > 0);
  assert.match(dailies.epoch, /^\d{4}-\d{2}-\d{2}$/);
  dailies.puzzles.forEach((puzzle, index) => {
    assert.equal(puzzle.number, index + 1, 'daily numbers should run 1, 2, 3…');
    assert.equal(puzzle.rings.length, WHEEL_COUNT);
    assert.ok(puzzle.rings.every((ring) => ring.length === RING_SIZE));
    assert.ok(puzzle.par.combination > 0 && puzzle.par.full > 0);
  });
});

test('no baked lock gives away its answer', () => {
  for (const puzzle of dailies.puzzles) {
    assert.equal(puzzle.solution, undefined, `daily ${puzzle.number} ships its answer`);
    assert.equal(puzzle.words, undefined, `daily ${puzzle.number} ships its answer`);
  }
});

test('every baked lock is solvable and its par is exact', () => {
  for (const puzzle of dailies.puzzles) {
    assert.ok(!isSolved(puzzle, puzzle.start, 'combination', valid.has), `daily ${puzzle.number} starts solved`);
    const searchCtx = createSearch(puzzle);
    for (const mode of ['combination', 'full']) {
      const found = search(searchCtx, goalMask(puzzle, mode, valid), puzzle.start);
      assert.ok(found, `daily ${puzzle.number} has no ${mode} solution`);
      assert.equal(found.par, puzzle.par[mode], `daily ${puzzle.number} ${mode} par`);
    }
  }
});

test('the daily ramps through the week and carries some theme clues', () => {
  const week = dailies.puzzles.slice(0, 7).map((puzzle) => puzzle.difficulty);
  assert.deepEqual(week, ['easy', 'easy', 'medium', 'medium', 'medium', 'hard', 'hard']);
  assert.ok(dailies.puzzles.some((puzzle) => puzzle.theme?.clue));
});
