import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../src/game.js';
import { ringsFromRows, valid } from './helpers.js';

const rings = ringsFromRows(['crane', 'slate', 'pound', 'gizmo', 'flick', 'hurdy']);

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
  assert.deepEqual(
    moved.filter((entry) => entry.moved).map((entry) => entry.wheel),
    [0, 3],
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
