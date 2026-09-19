import assert from 'node:assert/strict';
import test from 'node:test';
import { DAILY_EPOCH, dailyNumber, dayIndex, selectDaily } from '../src/daily.js';

test('the epoch day is puzzle #1', () => {
  assert.equal(dayIndex(new Date(`${DAILY_EPOCH}T12:00:00Z`)), 0);
  assert.equal(dailyNumber(new Date(`${DAILY_EPOCH}T00:00:00Z`)), 1);
  assert.equal(dailyNumber(new Date(`${DAILY_EPOCH}T23:59:59Z`)), 1);
  assert.equal(dailyNumber(new Date('2026-09-02T00:00:00Z')), 2);
});

test('each day picks the next lock, and the pack wraps when it runs out', () => {
  const pack = { epoch: DAILY_EPOCH, puzzles: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  assert.deepEqual(selectDaily(pack, new Date('2026-09-01T09:00:00Z')), { number: 1, lock: { id: 'a' } });
  assert.deepEqual(selectDaily(pack, new Date('2026-09-03T09:00:00Z')), { number: 3, lock: { id: 'c' } });
  assert.deepEqual(selectDaily(pack, new Date('2026-09-04T09:00:00Z')), { number: 4, lock: { id: 'a' } });
});

test('an empty pack is an error rather than a blank board', () => {
  assert.throws(() => selectDaily({ puzzles: [] }), /empty/);
});
