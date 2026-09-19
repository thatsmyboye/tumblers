import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from '../src/storage.js';

function fakeBackend() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map,
  };
}

test('daily progress round-trips and is namespaced', () => {
  const backend = fakeBackend();
  const store = createStore(backend);
  assert.equal(store.loadDaily(7), null);
  store.saveDaily(7, { history: [{ wheel: 1, dir: 1 }], undos: 2 });
  assert.deepEqual(store.loadDaily(7), { history: [{ wheel: 1, dir: 1 }], undos: 2 });
  assert.ok([...backend.map.keys()].every((key) => key.startsWith('tumblers:')));
  store.clearDaily(7);
  assert.equal(store.loadDaily(7), null);
});

test('the help flag is remembered', () => {
  const store = createStore(fakeBackend());
  assert.equal(store.hasSeenHelp(), false);
  store.markHelpSeen();
  assert.equal(store.hasSeenHelp(), true);
});

test('a blocked or broken backend degrades to remembering nothing', () => {
  const none = createStore(null);
  assert.equal(none.saveDaily(1, { history: [] }), false);
  assert.equal(none.loadDaily(1), null);
  assert.equal(none.hasSeenHelp(), false);

  const throwing = createStore({
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  });
  assert.equal(throwing.saveDaily(1, { history: [] }), false);
  assert.equal(throwing.loadDaily(1), null);
  assert.doesNotThrow(() => throwing.clearDaily(1));
});

test('corrupt saved JSON reads as nothing', () => {
  const backend = fakeBackend();
  backend.setItem('tumblers:daily:3', '{not json');
  assert.equal(createStore(backend).loadDaily(3), null);
});
