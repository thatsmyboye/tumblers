import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RING_SIZE,
  STATE_COUNT,
  applyMove,
  decodeState,
  encodeState,
  isSolved,
  legalMoves,
  letterAt,
  mod,
  moveMatrix,
  rowStatus,
  windowRows,
} from '../src/engine.js';
import { ringsFromRows, valid } from './helpers.js';

const rings = ringsFromRows(['crane', 'slate', 'pound', 'gizmo', 'flick', 'hurdy']);

/** crane / slate / pound sit at ring slots 0,1,2 so offsets of all zero solve it. */
const plainLock = { rings, links: [], seized: [], start: [0, 0, 0, 0, 0] };

test('mod is always non-negative', () => {
  assert.equal(mod(-1, 6), 5);
  assert.equal(mod(7, 6), 1);
  assert.equal(mod(0, 6), 0);
});

test('an unlinked wheel turns alone', () => {
  const next = applyMove(plainLock, [0, 0, 0, 0, 0], 2, 1);
  assert.deepEqual(next, [0, 0, 1, 0, 0]);
});

test('a link turns the linked wheel with the right sign', () => {
  const same = { ...plainLock, links: [{ from: 0, to: 3, sign: 1 }] };
  assert.deepEqual(applyMove(same, [0, 0, 0, 0, 0], 0, 1), [1, 0, 0, 1, 0]);

  const reverse = { ...plainLock, links: [{ from: 0, to: 3, sign: -1 }] };
  assert.deepEqual(applyMove(reverse, [0, 0, 0, 0, 0], 0, 1), [1, 0, 0, 5, 0]);
});

test('links do not cascade past one hop', () => {
  const chain = {
    ...plainLock,
    links: [
      { from: 0, to: 1, sign: 1 },
      { from: 1, to: 2, sign: 1 },
    ],
  };
  // Turning 0 moves 0 and 1 — but not 2, which only 1 drives.
  assert.deepEqual(applyMove(chain, [0, 0, 0, 0, 0], 0, 1), [1, 1, 0, 0, 0]);
  assert.deepEqual(applyMove(chain, [0, 0, 0, 0, 0], 1, 1), [0, 1, 1, 0, 0]);
});

test('every move is undone by the opposite move', () => {
  const lock = {
    ...plainLock,
    links: [
      { from: 0, to: 3, sign: -1 },
      { from: 4, to: 1, sign: 1 },
    ],
  };
  for (const { wheel, dir } of legalMoves(lock)) {
    const start = [1, 2, 3, 4, 5];
    const there = applyMove(lock, start, wheel, dir);
    assert.deepEqual(applyMove(lock, there, wheel, -dir), start);
  }
});

test('the move matrix is the identity plus the links', () => {
  const lock = { ...plainLock, links: [{ from: 1, to: 4, sign: -1 }] };
  const matrix = moveMatrix(lock);
  assert.equal(matrix[1][1], 1);
  assert.equal(matrix[1][4], -1);
  assert.equal(matrix[4][1], 0);
});

test('a seized wheel offers no moves of its own but still gets dragged', () => {
  const lock = { ...plainLock, links: [{ from: 0, to: 2, sign: 1 }], seized: [2] };
  const moves = legalMoves(lock);
  assert.equal(moves.length, 8);
  assert.ok(!moves.some((move) => move.wheel === 2));
  assert.deepEqual(applyMove(lock, [0, 0, 0, 0, 0], 0, 1), [1, 0, 1, 0, 0]);
});

test('the window shows three rows read off the rings', () => {
  assert.deepEqual(windowRows(plainLock, [0, 0, 0, 0, 0]), ['CRANE', 'SLATE', 'POUND']);
  assert.deepEqual(windowRows(plainLock, [1, 1, 1, 1, 1]), ['SLATE', 'POUND', 'GIZMO']);
  assert.equal(letterAt(plainLock, [0, 0, 0, 0, 0], 4, 1), 'E');
});

test('offsets wrap around the ring', () => {
  assert.deepEqual(windowRows(plainLock, [5, 5, 5, 5, 5]), ['HURDY', 'CRANE', 'SLATE']);
});

test('combination mode only needs the middle row', () => {
  const lock = { ...plainLock, rings: ringsFromRows(['zzzzz', 'slate', 'qqqqq', 'gizmo', 'flick', 'hurdy']) };
  assert.ok(isSolved(lock, [0, 0, 0, 0, 0], 'combination', valid.has));
  assert.ok(!isSolved(lock, [0, 0, 0, 0, 0], 'full', valid.has));
});

test('full lock needs all three rows', () => {
  assert.ok(isSolved(plainLock, [0, 0, 0, 0, 0], 'full', valid.has));
  const status = rowStatus(plainLock, [0, 0, 0, 0, 0], 'combination', valid.has);
  assert.deepEqual(
    status.map((row) => row.required),
    [false, true, false],
  );
  assert.ok(status.every((row) => row.valid));
});

test('state packing round-trips every position', () => {
  for (let index = 0; index < STATE_COUNT; index += 1) {
    assert.equal(encodeState(decodeState(index)), index);
  }
  assert.equal(encodeState([0, 0, 0, 0, 0]), 0);
  assert.equal(encodeState([5, 5, 5, 5, 5]), STATE_COUNT - 1);
  assert.equal(decodeState(1)[0], 1);
  assert.equal(RING_SIZE ** 5, STATE_COUNT);
});
