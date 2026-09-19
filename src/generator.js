/**
 * Puzzle generation, worked backward from the answer.
 *
 * 1. Pick three five-letter words that stack in the window.
 * 2. Drop each column's three letters into that column's ring and fill the
 *    remaining ring slots with plausible filler (preferring filler that forms
 *    decoy words).
 * 3. Wire up links, then scramble by applying random legal moves.
 * 4. BFS the whole state space for the exact optimal solution — that is par.
 *    Keep a scramble only if its par falls inside the difficulty's band.
 */

import {
  RING_SIZE,
  STATE_COUNT,
  WHEEL_COUNT,
  WINDOW_ROWS,
  applyMoveWith,
  encodeState,
  legalMoves,
  mod,
  moveMatrix,
} from './engine.js';
import { createSearch, distanceToGoals, goalMask, reachableCount } from './solver.js';
import { makeRng, pick, pickBiased, randInt, randRange, randomLetter, shuffled } from './rng.js';

/**
 * The par bands do not overlap, so a difficulty means a real change in depth
 * rather than a nudge in the average. Link count and seized wheels do the rest
 * of the work: the same par is harder to find with more chains in the way.
 */
export const DIFFICULTIES = {
  easy: {
    linkCount: [1, 2],
    seizedCount: 0,
    scrambleMoves: 7,
    minPar: { combination: 3, full: 4 },
    maxPar: { full: 6 },
    minReachable: 216,
  },
  medium: {
    linkCount: [2, 3],
    seizedCount: 0,
    scrambleMoves: 10,
    minPar: { combination: 4, full: 7 },
    maxPar: { full: 8 },
    minReachable: 432,
  },
  hard: {
    linkCount: [3, 4],
    seizedCount: 1,
    // A longer walk mixes further into the state space, so deep starting
    // positions turn up often enough to demand one.
    scrambleMoves: 20,
    minPar: { combination: 5, full: 10 },
    maxPar: { full: 13 },
    minReachable: 432,
  },
};

/** How many random scrambles to try before giving up on an answer. */
const SCRAMBLES_PER_ANSWER = 40;

/** Quality bounds that keep a lock from being degenerate in either direction. */
const QUALITY = {
  minDistinctLettersPerRing: 4,
  minDecoyStates: 1,
  maxCombinationGoals: 1200,
  maxFullGoals: 60,
};

/**
 * Lay the three solution words into five rings and fill the rest.
 * @returns {{ rings: string[][], solution: number[] }}
 */
function buildRings(rng, words, answers) {
  // Ring slots 0..WINDOW_ROWS-1 hold the solution; the rest are filler. Filler
  // rows drawn from real words give the board believable decoys; at most two so
  // the ring is never just six stacked words.
  const rows = words.slice();
  let wordFillers = 0;
  for (let slot = WINDOW_ROWS; slot < RING_SIZE; slot += 1) {
    if (wordFillers < 2 && rng() < 0.6) {
      rows.push(pickBiased(rng, answers, 1.6));
      wordFillers += 1;
    } else {
      rows.push(null);
    }
  }

  const rings = [];
  for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
    const base = rows.map((row) => (row ? row[wheel].toUpperCase() : randomLetter(rng).toUpperCase()));
    if (new Set(base).size < QUALITY.minDistinctLettersPerRing) return null;
    rings.push(base);
  }

  // Rotate every ring independently so the answer does not sit at offset 0.
  const solution = [];
  for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
    const turn = randInt(rng, RING_SIZE);
    const rotated = new Array(RING_SIZE);
    for (let i = 0; i < RING_SIZE; i += 1) rotated[mod(i + turn, RING_SIZE)] = rings[wheel][i];
    rings[wheel] = rotated;
    solution.push(turn);
  }

  return { rings, solution };
}

/**
 * Random directed links. A link means "turning `from` also turns `to` by sign".
 *
 * A seized wheel is chosen first: it never drives (an outgoing link from a
 * wheel you cannot turn would be a chain that never moves) and it must be the
 * target of at least one link, or it could never move at all.
 *
 * @returns {{ links: import('./engine.js').Link[], seized: number[] } | null}
 */
function buildLinks(rng, config) {
  const seized = [];
  for (let i = 0; i < config.seizedCount; i += 1) {
    const wheel = randInt(rng, WHEEL_COUNT);
    if (!seized.includes(wheel)) seized.push(wheel);
  }

  const pairs = [];
  for (let from = 0; from < WHEEL_COUNT; from += 1) {
    if (seized.includes(from)) continue;
    for (let to = 0; to < WHEEL_COUNT; to += 1) {
      if (from !== to) pairs.push([from, to]);
    }
  }

  const wanted = randRange(rng, config.linkCount[0], config.linkCount[1]);
  const links = [];
  const pairedWheels = new Set();
  const addLink = ([from, to]) => {
    if (pairedWheels.has(`${from}:${to}`) || pairedWheels.has(`${to}:${from}`)) return false;
    pairedWheels.add(`${from}:${to}`);
    links.push({ from, to, sign: rng() < 0.5 ? 1 : -1 });
    return true;
  };

  // Every seized wheel gets its driver first, then fill in the rest at random.
  for (const wheel of seized) {
    const drivers = shuffled(rng, pairs).filter(([, to]) => to === wheel);
    if (drivers.length === 0 || !addLink(drivers[0])) return null;
  }
  for (const pair of shuffled(rng, pairs)) {
    if (links.length >= wanted) break;
    addLink(pair);
  }

  if (legalMoves({ links, seized }).length === 0) return null;
  return { links, seized };
}

function scramble(rng, lock, from, steps) {
  const matrix = moveMatrix(lock);
  const moves = legalMoves(lock);
  let offsets = from.slice();
  let previous = null;
  for (let i = 0; i < steps; i += 1) {
    const options = moves.filter(
      (move) => !previous || !(move.wheel === previous.wheel && move.dir === -previous.dir),
    );
    const move = pick(rng, options);
    offsets = applyMoveWith(offsets, matrix, move.wheel, move.dir);
    previous = move;
  }
  return offsets;
}

function countMask(mask) {
  let total = 0;
  for (let i = 0; i < STATE_COUNT; i += 1) total += mask[i];
  return total;
}

/**
 * Try to lay an answer into a fixed wiring. The wiring (and therefore the move
 * graph) is passed in because building the transition table is the expensive
 * part — one table serves many candidate answers.
 *
 * @returns {import('./engine.js').Lock | null}
 */
function attemptLock(rng, wiring, searchCtx, options) {
  const { valid, answers, config, theme } = options;
  const pool = theme ? theme.words : answers;
  if (pool.length < WINDOW_ROWS) return null;

  const words = [];
  for (let guard = 0; words.length < WINDOW_ROWS && guard < 50; guard += 1) {
    const word = theme ? pick(rng, pool) : pickBiased(rng, pool, 2);
    if (!words.includes(word)) words.push(word);
  }
  if (words.length < WINDOW_ROWS) return null;

  const built = buildRings(rng, words, answers);
  if (!built) return null;

  /** @type {import('./engine.js').Lock} */
  const lock = {
    rings: built.rings,
    links: wiring.links,
    seized: wiring.seized,
    start: built.solution,
    solution: built.solution,
  };

  const combinationGoals = goalMask(lock, 'combination', valid);
  const fullGoals = goalMask(lock, 'full', valid);
  const combinationCount = countMask(combinationGoals);
  const fullCount = countMask(fullGoals);

  if (fullCount < 1 || fullCount > QUALITY.maxFullGoals) return null;
  if (combinationCount > QUALITY.maxCombinationGoals) return null;
  if (combinationCount - fullCount < QUALITY.minDecoyStates) return null;

  // Par for every possible starting position, in two searches. Scrambles can
  // then be checked with a lookup instead of a fresh search each time.
  const combinationPar = distanceToGoals(searchCtx, combinationGoals);
  const fullPar = distanceToGoals(searchCtx, fullGoals);

  // Collect every scramble that lands inside the difficulty's par band and take
  // one at random, so locks spread across the band instead of piling up on
  // whichever end the search happens to reach first.
  const candidates = [];
  for (let attempt = 0; attempt < SCRAMBLES_PER_ANSWER; attempt += 1) {
    const start = scramble(rng, lock, built.solution, config.scrambleMoves);
    const state = encodeState(start);
    const combination = combinationPar[state];
    const full = fullPar[state];

    if (combination < config.minPar.combination) continue;
    if (full < config.minPar.full) continue;
    if (config.maxPar?.full && full > config.maxPar.full) continue;

    candidates.push({ start, par: { combination, full } });
  }

  if (candidates.length === 0) return null;

  const chosen = pick(rng, candidates);
  lock.start = chosen.start;
  lock.par = chosen.par;
  lock.words = words.map((word) => word.toUpperCase());
  lock.stats = { combinationGoals: combinationCount, fullGoals: fullCount };
  if (theme) lock.theme = { clue: theme.clue };
  return lock;
}

/**
 * @param {{
 *   seed?: number | string,
 *   rng?: () => number,
 *   valid: { has: (word: string) => boolean },
 *   answers: string[],
 *   difficulty?: keyof typeof DIFFICULTIES,
 *   theme?: { clue: string, words: string[] },
 *   attempts?: number,
 *   answersPerWiring?: number,
 *   id?: string,
 * }} options
 * @returns {import('./engine.js').Lock | null}
 */
export function generateLock(options) {
  const config = DIFFICULTIES[options.difficulty ?? 'medium'];
  if (!config) throw new Error(`Unknown difficulty: ${options.difficulty}`);
  const rng = options.rng ?? makeRng(options.seed ?? Date.now());
  const attempts = options.attempts ?? 400;
  const answersPerWiring = options.answersPerWiring ?? 16;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const wiring = buildLinks(rng, config);
    if (!wiring) continue;

    // The move graph depends only on the wiring, so build it once per wiring
    // and try several answers against it.
    const searchCtx = createSearch(wiring);
    // Moves are translations, so the reachable set is the same size wherever
    // you start; a start of all zeros is as good as any.
    if (reachableCount(searchCtx, new Array(WHEEL_COUNT).fill(0)) < config.minReachable) continue;

    for (let i = 0; i < answersPerWiring; i += 1) {
      const lock = attemptLock(rng, wiring, searchCtx, { ...options, config });
      if (lock) {
        lock.id = options.id ?? `lock-${attempt}`;
        lock.difficulty = options.difficulty ?? 'medium';
        return lock;
      }
    }
  }
  return null;
}

/** Drop the answer from a lock before publishing it. */
export function stripSolution(lock) {
  const { solution, words, stats, ...rest } = lock;
  return rest;
}
