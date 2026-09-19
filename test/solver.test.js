import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STATE_COUNT,
  applyMove,
  decodeState,
  encodeState,
  isSolved,
  legalMoves,
} from '../src/engine.js';
import { createSearch, distanceToGoals, goalMask, reachableCount, search, solveLock } from '../src/solver.js';
import { ringsFromRows, valid } from './helpers.js';

const rings = ringsFromRows(['crane', 'slate', 'pound', 'gizmo', 'flick', 'hurdy']);

/** A deliberately naive BFS, written differently, to check the fast one. */
function naiveSolve(lock, mode) {
  const startKey = encodeState(lock.start);
  const seen = new Map([[startKey, 0]]);
  let frontier = [lock.start];
  let depth = 0;
  while (frontier.length) {
    for (const offsets of frontier) {
      if (isSolved(lock, offsets, mode, valid.has)) return depth;
    }
    const next = [];
    for (const offsets of frontier) {
      for (const { wheel, dir } of legalMoves(lock)) {
        const moved = applyMove(lock, offsets, wheel, dir);
        const key = encodeState(moved);
        if (seen.has(key)) continue;
        seen.set(key, depth + 1);
        next.push(moved);
      }
    }
    frontier = next;
    depth += 1;
  }
  return null;
}

test('goalMask agrees with checking every state one at a time', () => {
  const lock = { rings, links: [], seized: [], start: [0, 0, 0, 0, 0] };
  for (const mode of ['combination', 'full']) {
    const mask = goalMask(lock, mode, valid);
    for (let index = 0; index < STATE_COUNT; index += 1) {
      const expected = isSolved(lock, decodeState(index), mode, valid.has) ? 1 : 0;
      assert.equal(mask[index], expected, `state ${index} in ${mode}`);
    }
  }
});

test('goalMask accepts a bare predicate too', () => {
  const lock = { rings, links: [], seized: [], start: [0, 0, 0, 0, 0] };
  const withDictionary = goalMask(lock, 'full', valid);
  const withPredicate = goalMask(lock, 'full', valid.has);
  assert.deepEqual([...withPredicate], [...withDictionary]);
});

test('a solved board is par 0', () => {
  const lock = { rings, links: [], seized: [], start: [0, 0, 0, 0, 0] };
  const result = solveLock(lock, 'full', valid);
  assert.equal(result.par, 0);
  assert.deepEqual(result.path, []);
});

test('the solution path really opens the lock', () => {
  const lock = {
    rings,
    links: [
      { from: 0, to: 2, sign: 1 },
      { from: 3, to: 1, sign: -1 },
    ],
    seized: [],
    start: [3, 4, 1, 2, 5],
  };
  const result = solveLock(lock, 'full', valid);
  assert.ok(result, 'expected the lock to be solvable');

  let offsets = lock.start;
  for (const { wheel, dir } of result.path) {
    assert.ok(!isSolved(lock, offsets, 'full', valid.has), 'path should not pass through the goal');
    offsets = applyMove(lock, offsets, wheel, dir);
  }
  assert.deepEqual(offsets, result.goal);
  assert.ok(isSolved(lock, offsets, 'full', valid.has));
});

test('par matches an independent breadth-first search', () => {
  const locks = [
    { links: [], seized: [], start: [1, 0, 0, 0, 0] },
    { links: [{ from: 0, to: 4, sign: 1 }], seized: [], start: [2, 3, 4, 5, 1] },
    {
      links: [
        { from: 1, to: 0, sign: -1 },
        { from: 4, to: 2, sign: 1 },
      ],
      seized: [2],
      start: [5, 5, 2, 1, 3],
    },
  ].map((partial) => ({ rings, ...partial }));

  for (const lock of locks) {
    for (const mode of ['combination', 'full']) {
      const fast = search(createSearch(lock), goalMask(lock, mode, valid), lock.start);
      assert.equal(fast?.par ?? null, naiveSolve(lock, mode), `${mode} on ${lock.start}`);
    }
  }
});

test('unlinked wheels reach every state; a seized wheel shrinks the space', () => {
  const free = { rings, links: [], seized: [], start: [0, 0, 0, 0, 0] };
  assert.equal(reachableCount(createSearch(free), free.start), STATE_COUNT);

  const stuck = {
    rings,
    links: [{ from: 0, to: 4, sign: 1 }],
    seized: [4],
    start: [0, 0, 0, 0, 0],
  };
  const reachable = reachableCount(createSearch(stuck), stuck.start);
  assert.ok(reachable < STATE_COUNT, 'seizing a wheel should cut the reachable space');
  assert.equal(reachable, 6 ** 4);
});

test('an unreachable goal reports no solution', () => {
  // Every wheel is seized, so nothing can turn and a board that does not start
  // solved never will be.
  const lock = {
    rings: ringsFromRows(['zzzzz', 'slate', 'zzzzz', 'zzzzz', 'zzzzz', 'zzzzz']),
    links: [{ from: 0, to: 4, sign: 1 }],
    seized: [0, 1, 2, 3, 4],
    start: [0, 0, 0, 1, 0],
  };
  assert.equal(search(createSearch(lock), goalMask(lock, 'combination', valid), lock.start), null);
});

test('the distance map gives the same par as searching from each start', () => {
  const lock = {
    rings,
    links: [
      { from: 0, to: 2, sign: 1 },
      { from: 3, to: 1, sign: -1 },
    ],
    seized: [],
    start: [0, 0, 0, 0, 0],
  };
  const searchCtx = createSearch(lock);
  const goals = goalMask(lock, 'full', valid);
  const distances = distanceToGoals(searchCtx, goals);

  for (const start of [[0, 0, 0, 0, 0], [1, 2, 3, 4, 5], [5, 0, 2, 2, 1], [3, 3, 3, 3, 3]]) {
    const found = search(searchCtx, goals, start);
    assert.equal(distances[encodeState(start)], found ? found.par : -1, `from ${start}`);
  }
});

test('states with no route to a goal are marked unreachable', () => {
  const lock = {
    rings: ringsFromRows(['zzzzz', 'slate', 'zzzzz', 'zzzzz', 'zzzzz', 'zzzzz']),
    links: [],
    seized: [0, 1, 2, 3, 4],
    start: [0, 0, 0, 0, 0],
  };
  const distances = distanceToGoals(createSearch(lock), goalMask(lock, 'combination', valid));
  assert.equal(distances[encodeState([0, 0, 0, 0, 0])], 0, 'the solved state is its own goal');
  assert.equal(distances[encodeState([1, 0, 0, 0, 0])], -1, 'nothing can turn, so nothing else is reachable');
});
