/**
 * Breadth-first search over the lock's state space.
 *
 * There are only RING_SIZE ** WHEEL_COUNT = 7,776 possible offset tuples, so an
 * exhaustive BFS from the scrambled start gives the exact optimal move count.
 * That number is the puzzle's par.
 */

import {
  STATE_COUNT,
  WHEEL_COUNT,
  RING_SIZE,
  decodeState,
  encodeState,
  legalMoves,
  mod,
  moveMatrix,
  requiredRows,
} from './engine.js';

const PLACE = Array.from({ length: WHEEL_COUNT }, (_, c) => RING_SIZE ** c);

/**
 * Precomputed move graph for one lock. Build it once and reuse it across
 * searches — the rings and links never change, only the offsets do.
 * @param {import('./engine.js').Lock} lock
 */
export function createSearch(lock) {
  const moves = legalMoves(lock);
  const matrix = moveMatrix(lock);
  const transitions = new Int16Array(STATE_COUNT * moves.length);

  for (let state = 0; state < STATE_COUNT; state += 1) {
    const offsets = decodeState(state);
    for (let m = 0; m < moves.length; m += 1) {
      const { wheel, dir } = moves[m];
      let next = 0;
      for (let c = 0; c < WHEEL_COUNT; c += 1) {
        next += mod(offsets[c] + dir * matrix[wheel][c], RING_SIZE) * PLACE[c];
      }
      transitions[state * moves.length + m] = next;
    }
  }

  return { lock, moves, transitions };
}

/**
 * Normalize a word-list argument: either a dictionary object or a bare
 * predicate. A bare predicate loses prefix pruning but still works.
 */
function asDictionary(words) {
  if (typeof words === 'function') return { has: words, hasPrefix: () => true };
  return { has: words.has, hasPrefix: words.hasPrefix ?? (() => true) };
}

/**
 * Mark every state that counts as solved in the given mode.
 *
 * Walks the wheels left to right, growing one partial word per required row and
 * abandoning a branch as soon as a partial word cannot start any real word.
 *
 * @param {import('./engine.js').Lock} lock
 * @param {'combination' | 'full'} mode
 * @param {{ has: (word: string) => boolean, hasPrefix?: (prefix: string) => boolean } | ((word: string) => boolean)} words
 * @returns {Uint8Array}
 */
export function goalMask(lock, mode, words) {
  const { has, hasPrefix } = asDictionary(words);
  const rows = requiredRows(mode);
  const rings = lock.rings.map((ring) => ring.map((letter) => letter.toLowerCase()));
  const mask = new Uint8Array(STATE_COUNT);

  const walk = (wheel, state, partials) => {
    if (wheel === WHEEL_COUNT) {
      if (partials.every(has)) mask[state] = 1;
      return;
    }
    for (let offset = 0; offset < RING_SIZE; offset += 1) {
      const next = partials.map(
        (partial, i) => partial + rings[wheel][mod(offset + rows[i], RING_SIZE)],
      );
      if (wheel < WHEEL_COUNT - 1 && !next.every(hasPrefix)) continue;
      walk(wheel + 1, state + offset * PLACE[wheel], next);
    }
  };

  walk(0, 0, rows.map(() => ''));
  return mask;
}

const UNVISITED = -1;

/**
 * Optimal solution from `from` to the nearest goal state.
 *
 * @param {ReturnType<typeof createSearch>} search
 * @param {Uint8Array} goals
 * @param {number[]} from offsets
 * @returns {{ par: number, path: { wheel: number, dir: 1 | -1 }[], goal: number[] } | null}
 */
export function search(searchCtx, goals, from) {
  const { moves, transitions } = searchCtx;
  const width = moves.length;
  const startIndex = encodeState(from);

  const dist = new Int16Array(STATE_COUNT).fill(UNVISITED);
  const cameFrom = new Int16Array(STATE_COUNT).fill(UNVISITED);
  const viaMove = new Int8Array(STATE_COUNT).fill(UNVISITED);

  const queue = new Int16Array(STATE_COUNT);
  let head = 0;
  let tail = 0;
  queue[tail++] = startIndex;
  dist[startIndex] = 0;

  let goalIndex = goals[startIndex] ? startIndex : UNVISITED;

  while (head < tail && goalIndex === UNVISITED) {
    const state = queue[head++];
    const base = state * width;
    for (let m = 0; m < width; m += 1) {
      const next = transitions[base + m];
      if (dist[next] !== UNVISITED) continue;
      dist[next] = dist[state] + 1;
      cameFrom[next] = state;
      viaMove[next] = m;
      if (goals[next]) {
        goalIndex = next;
        break;
      }
      queue[tail++] = next;
    }
  }

  if (goalIndex === UNVISITED) return null;

  const path = [];
  for (let state = goalIndex; state !== startIndex; state = cameFrom[state]) {
    path.push(moves[viaMove[state]]);
  }
  path.reverse();

  return { par: path.length, path, goal: decodeState(goalIndex) };
}

/**
 * Distance from every state to the nearest goal, or -1 where no goal can be
 * reached. One multi-source breadth-first search, run backward from the goals.
 *
 * Every move has an equal and opposite move, so distance-to-goal is symmetric
 * with distance-from-start: this table gives par for *any* starting position at
 * once, which is what makes scrambling cheap to vet.
 *
 * @param {ReturnType<typeof createSearch>} searchCtx
 * @param {Uint8Array} goals
 * @returns {Int16Array}
 */
export function distanceToGoals(searchCtx, goals) {
  const { moves, transitions } = searchCtx;
  const width = moves.length;
  const dist = new Int16Array(STATE_COUNT).fill(UNVISITED);
  const queue = new Int16Array(STATE_COUNT);
  let head = 0;
  let tail = 0;

  for (let state = 0; state < STATE_COUNT; state += 1) {
    if (goals[state]) {
      dist[state] = 0;
      queue[tail++] = state;
    }
  }

  while (head < tail) {
    const state = queue[head++];
    const base = state * width;
    for (let m = 0; m < width; m += 1) {
      const next = transitions[base + m];
      if (dist[next] !== UNVISITED) continue;
      dist[next] = dist[state] + 1;
      queue[tail++] = next;
    }
  }

  return dist;
}

/** Number of states reachable from `from` using legal moves. */
export function reachableCount(searchCtx, from) {
  const { moves, transitions } = searchCtx;
  const width = moves.length;
  const seen = new Uint8Array(STATE_COUNT);
  const queue = new Int16Array(STATE_COUNT);
  let head = 0;
  let tail = 0;
  const startIndex = encodeState(from);
  queue[tail++] = startIndex;
  seen[startIndex] = 1;
  while (head < tail) {
    const state = queue[head++];
    const base = state * width;
    for (let m = 0; m < width; m += 1) {
      const next = transitions[base + m];
      if (seen[next]) continue;
      seen[next] = 1;
      queue[tail++] = next;
    }
  }
  return tail;
}

/**
 * Convenience wrapper: exact par for a lock from its scrambled start.
 * @param {import('./engine.js').Lock} lock
 * @param {'combination' | 'full'} mode
 * @param {(word: string) => boolean} isWord
 */
export function solveLock(lock, mode, isWord, from = lock.start) {
  return search(createSearch(lock), goalMask(lock, mode, isWord), from);
}
