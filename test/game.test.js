import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMove } from '../src/engine.js';
import { Game } from '../src/game.js';
import { ringsFromRows, valid } from './helpers.js';

const rings = ringsFromRows(['crane', 'slate', 'pound', 'gizmo', 'flick', 'hurdy']);
const applyMoveOnce = (lock, offsets, wheel, dir) => applyMove(lock, offsets, wheel, dir);

const lock = {
  rings,
  links: [{ from: 0, to: 3, sign: -1 }],
  seized: [],
  start: [2, 2, 2, 2, 2],
};

test('turning counts a move and reports the whole chain', () => {
  const game = new Game(lock, 'full', valid.has);
  const moved = game.turn(0, 1);
  assert.equal(game.moves, 1);
  // Wheel 1 went up; its reversed chain pulled wheel 4 down.
  assert.deepEqual(
    moved.map((entry) => entry.delta),
    [1, 0, 0, -1, 0],
  );
  assert.deepEqual(game.offsets, [3, 2, 2, 1, 2]);
});

test('undo is free: it takes back a move without costing one', () => {
  const game = new Game(lock, 'full', valid.has);
  game.turn(0, 1);
  game.turn(4, -1);
  assert.equal(game.moves, 2);

  assert.equal(game.undo(), true);
  assert.equal(game.moves, 1);
  assert.equal(game.undos, 1);

  assert.equal(game.undo(), true);
  assert.deepEqual(game.offsets, lock.start);
  assert.equal(game.moves, 0);
  assert.equal(game.undos, 2);

  assert.equal(game.undo(), false, 'nothing left to undo');
  assert.equal(game.undos, 2);
});

test('reset returns the lock to its scrambled start', () => {
  const game = new Game(lock, 'full', valid.has);
  game.turn(1, 1);
  game.turn(2, 1);
  game.undo();
  game.reset();
  assert.deepEqual(game.offsets, lock.start);
  assert.equal(game.moves, 0);
  assert.equal(game.undos, 0);
  assert.deepEqual(game.history, []);
});

test('a seized wheel refuses a direct turn', () => {
  const seizedLock = { ...lock, seized: [3] };
  const game = new Game(seizedLock, 'full', valid.has);
  assert.equal(game.turn(3, 1), null);
  assert.equal(game.moves, 0);
  // ...but wheel 0 still drags it.
  game.turn(0, 1);
  assert.deepEqual(game.offsets, [3, 2, 2, 1, 2]);
});

test('solving depends on the mode, and the mode can change mid-lock', () => {
  // Middle row spells a word, the others do not.
  const partial = {
    rings: ringsFromRows(['zzzzz', 'crane', 'qqqqq', 'gizmo', 'flick', 'hurdy']),
    links: [],
    seized: [],
    start: [0, 0, 0, 0, 0],
  };
  const game = new Game(partial, 'combination', valid.has);
  assert.equal(game.solved, true);
  game.setMode('full');
  assert.equal(game.solved, false);
});

test('a turn across the ring seam still reports a one-step delta', () => {
  const seam = { ...lock, links: [], start: [5, 0, 0, 0, 0] };
  const game = new Game(seam, 'full', valid.has);
  assert.deepEqual(game.turn(0, 1).map((entry) => entry.delta), [1, 0, 0, 0, 0]);
  assert.equal(game.offsets[0], 0);
  assert.deepEqual(game.turn(0, -1).map((entry) => entry.delta), [-1, 0, 0, 0, 0]);
});

test('a snapshot brings a session back exactly', () => {
  const game = new Game(lock, 'full', valid.has);
  game.turn(0, 1);
  game.turn(2, -1);
  game.turn(4, 1);
  game.undo();
  game.useHint();
  const snapshot = game.snapshot();

  const restored = new Game(lock, 'full', valid.has);
  assert.equal(restored.restore(snapshot), true);
  assert.deepEqual(restored.offsets, game.offsets);
  assert.equal(restored.moves, 2);
  assert.equal(restored.undos, 1);
  assert.equal(restored.hints, 1);
  assert.equal(restored.undo(), true, 'history survives, so undo still works');
  assert.deepEqual(restored.offsets, applyMoveOnce(lock, lock.start, 0, 1));
});

test('a snapshot that does not fit the lock is refused', () => {
  const game = new Game(lock, 'full', valid.has);
  game.turn(1, 1);
  const before = game.offsets.slice();
  assert.equal(game.restore({ history: [{ wheel: 9, dir: 1 }] }), false);
  assert.equal(game.restore({ history: [{ wheel: 0, dir: 2 }] }), false);
  assert.equal(game.restore(null), false);
  assert.deepEqual(game.offsets, before, 'a refused restore changes nothing');
});
