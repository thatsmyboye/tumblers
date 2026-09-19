import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeLock, encodeLock } from '../src/lockcode.js';
import { ringsFromRows } from './helpers.js';

const lock = {
  rings: ringsFromRows(['crane', 'slate', 'pound', 'gizmo', 'flick', 'hurdy']),
  links: [
    { from: 0, to: 3, sign: 1 },
    { from: 2, to: 1, sign: -1 },
  ],
  seized: [1],
  start: [3, 1, 4, 0, 5],
};

test('a lock survives the round trip through its code', () => {
  const code = encodeLock(lock, 'combination');
  assert.match(code, /^1~[A-Z]{30}~31405~03a,21r~1~c$/);
  const decoded = decodeLock(code);
  assert.deepEqual(decoded, { lock, mode: 'combination' });
});

test('an unlinked, unseized lock encodes with empty fields', () => {
  const plain = { ...lock, links: [], seized: [] };
  const decoded = decodeLock(encodeLock(plain));
  assert.deepEqual(decoded.lock, plain);
  assert.equal(decoded.mode, 'full');
});

test('codes are case-insensitive in the letters', () => {
  const code = encodeLock(lock).replace(/[A-Z]{30}/, (letters) => letters.toLowerCase());
  assert.deepEqual(decodeLock(code).lock.rings, lock.rings);
});

test('malformed codes are refused rather than guessed at', () => {
  const good = encodeLock(lock);
  const broken = [
    '',
    'nonsense',
    good.replace(/^1~/, '2~'),
    good.replace(/[A-Z]{30}/, 'CRANESLATE'),
    good.replace('31405', '31465'),
    good.replace('03a', '00a'),
    good.replace('03a', '03x'),
    good.replace('~1~f', '~9~f'),
    good.replace(/~f$/, '~z'),
    good.replace('~1~', '~01234~'),
  ];
  for (const code of broken) assert.equal(decodeLock(code), null, `accepted: ${code}`);
});
