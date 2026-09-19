/**
 * Tumblers engine: board state, wheel rotation, link propagation, win detection.
 *
 * A lock is 5 vertical wheels. Each wheel is a ring of RING_SIZE letters, and a
 * window shows WINDOW_ROWS of them at a time. The mutable part of the state is
 * just the 5 ring offsets, so a whole board position is a 5-tuple in Z6^5.
 *
 * Links: turning wheel A also turns wheel B by +-1. Links are directed and
 * single-hop — driving A moves A and everything A links to, but it does not
 * cascade on through B's own links. That keeps every move invertible and keeps
 * the reachable space large enough to be worth searching.
 */

export const RING_SIZE = 6;
export const WHEEL_COUNT = 5;
export const WINDOW_ROWS = 3;
export const STATE_COUNT = RING_SIZE ** WHEEL_COUNT; // 7776

/**
 * @typedef {{ from: number, to: number, sign: 1 | -1 }} Link
 * @typedef {{
 *   id?: string,
 *   rings: string[][],
 *   links: Link[],
 *   seized?: number[],
 *   start: number[],
 *   solution?: number[],
 *   par?: { combination?: number, full?: number },
 *   theme?: { clue: string },
 * }} Lock
 */

export function mod(n, m) {
  return ((n % m) + m) % m;
}

/**
 * Row-per-wheel move matrix. `matrix[w]` is the offset delta applied to every
 * wheel when wheel `w` is turned one step up.
 * @param {Lock} lock
 * @returns {number[][]}
 */
export function moveMatrix(lock) {
  const matrix = Array.from({ length: WHEEL_COUNT }, (_, w) =>
    Array.from({ length: WHEEL_COUNT }, (_, c) => (c === w ? 1 : 0)),
  );
  for (const link of lock.links) {
    matrix[link.from][link.to] = link.sign;
  }
  return matrix;
}

/** @param {Lock} lock */
export function isSeized(lock, wheel) {
  return Boolean(lock.seized?.includes(wheel));
}

/**
 * Every move a player may make: one step up or down on each wheel that is not
 * seized. Seized wheels still turn, but only when a link drags them.
 * @param {Lock} lock
 * @returns {{ wheel: number, dir: 1 | -1 }[]}
 */
export function legalMoves(lock) {
  const moves = [];
  for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
    if (isSeized(lock, wheel)) continue;
    moves.push({ wheel, dir: 1 }, { wheel, dir: -1 });
  }
  return moves;
}

/**
 * Apply one turn, propagating through links. Returns fresh offsets.
 * @param {number[]} offsets
 * @param {number[][]} matrix
 * @returns {number[]}
 */
export function applyMoveWith(offsets, matrix, wheel, dir) {
  const next = offsets.slice();
  for (let c = 0; c < WHEEL_COUNT; c += 1) {
    next[c] = mod(next[c] + dir * matrix[wheel][c], RING_SIZE);
  }
  return next;
}

/** @param {Lock} lock */
export function applyMove(lock, offsets, wheel, dir) {
  return applyMoveWith(offsets, moveMatrix(lock), wheel, dir);
}

/**
 * How a wheel behaves relative to the links — the thing a player has to know
 * before planning a move.
 *
 * - `free`: turns alone; nothing moves it and it moves nothing.
 * - `drives`: turns alone and pulls others, but nothing pulls it, so it holds
 *   its position while you work elsewhere.
 * - `pulled`: turns on its own, but another wheel moves it too, so it drifts.
 *   (It may drive something as well.)
 * - `seized`: has no turn of its own and only ever moves in lockstep with
 *   whatever drives it.
 *
 * @param {Lock} lock
 * @returns {'free' | 'drives' | 'pulled' | 'seized'}
 */
export function wheelRole(lock, wheel) {
  if (isSeized(lock, wheel)) return 'seized';
  if (lock.links.some((link) => link.to === wheel)) return 'pulled';
  if (lock.links.some((link) => link.from === wheel)) return 'drives';
  return 'free';
}

/** The wheels whose turns move `wheel` — everything chained into it. */
export function driversOf(lock, wheel) {
  return lock.links.filter((link) => link.to === wheel).map((link) => link.from);
}

/** Letter shown in window row `row` of `wheel`. */
export function letterAt(lock, offsets, wheel, row) {
  return lock.rings[wheel][mod(offsets[wheel] + row, RING_SIZE)];
}

/**
 * The WINDOW_ROWS words currently showing, top to bottom.
 * @returns {string[]}
 */
export function windowRows(lock, offsets) {
  const rows = [];
  for (let row = 0; row < WINDOW_ROWS; row += 1) {
    let word = '';
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      word += letterAt(lock, offsets, wheel, row);
    }
    rows.push(word);
  }
  return rows;
}

export const MIDDLE_ROW = Math.floor(WINDOW_ROWS / 2);

/**
 * Which rows must spell words in a given mode.
 * @param {'combination' | 'full'} mode
 */
export function requiredRows(mode) {
  if (mode === 'full') return [...Array(WINDOW_ROWS).keys()];
  return [MIDDLE_ROW];
}

/**
 * @param {Lock} lock
 * @param {number[]} offsets
 * @param {'combination' | 'full'} mode
 * @param {(word: string) => boolean} isWord
 */
export function isSolved(lock, offsets, mode, isWord) {
  const rows = windowRows(lock, offsets);
  return requiredRows(mode).every((row) => isWord(rows[row]));
}

/** Per-row solved flags, for highlighting rows in the UI. */
export function rowStatus(lock, offsets, mode, isWord) {
  const rows = windowRows(lock, offsets);
  const required = new Set(requiredRows(mode));
  return rows.map((word, row) => ({
    word,
    required: required.has(row),
    valid: isWord(word),
  }));
}

/** Pack offsets into a single integer index, for search and memoization. */
export function encodeState(offsets) {
  let index = 0;
  for (let c = WHEEL_COUNT - 1; c >= 0; c -= 1) index = index * RING_SIZE + offsets[c];
  return index;
}

/** @returns {number[]} */
export function decodeState(index) {
  const offsets = [];
  let rest = index;
  for (let c = 0; c < WHEEL_COUNT; c += 1) {
    offsets.push(rest % RING_SIZE);
    rest = Math.floor(rest / RING_SIZE);
  }
  return offsets;
}
