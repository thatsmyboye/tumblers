/** Small seeded RNG so generated locks (and dailies) are reproducible. */

/** @param {string} text */
export function hashSeed(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * mulberry32.
 * @param {number | string} seed
 * @returns {() => number}
 */
export function makeRng(seed) {
  let state = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng, maxExclusive) {
  return Math.floor(rng() * maxExclusive);
}

export function randRange(rng, min, maxInclusive) {
  return min + randInt(rng, maxInclusive - min + 1);
}

/** @template T @param {() => number} rng @param {T[]} items @returns {T} */
export function pick(rng, items) {
  return items[randInt(rng, items.length)];
}

/** @template T @param {() => number} rng @param {T[]} items @returns {T[]} */
export function shuffled(rng, items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pick an index with a bias toward the front of the list. `bias` of 1 is
 * uniform; higher values favour earlier entries (our answer list is ordered by
 * word frequency, so this keeps solutions familiar).
 */
export function pickBiased(rng, items, bias = 2) {
  const t = rng() ** bias;
  return items[Math.min(items.length - 1, Math.floor(t * items.length))];
}

const LETTER_WEIGHTS = {
  a: 8.2, b: 1.5, c: 2.8, d: 4.3, e: 12.7, f: 2.2, g: 2.0, h: 6.1, i: 7.0,
  j: 0.15, k: 0.77, l: 4.0, m: 2.4, n: 6.7, o: 7.5, p: 1.9, q: 0.095, r: 6.0,
  s: 6.3, t: 9.1, u: 2.8, v: 0.98, w: 2.4, x: 0.15, y: 2.0, z: 0.074,
};

const WEIGHTED_ALPHABET = Object.entries(LETTER_WEIGHTS).flatMap(([letter, weight]) =>
  Array.from({ length: Math.max(1, Math.round(weight * 4)) }, () => letter),
);

/** A letter drawn from English letter frequencies, so fillers look plausible. */
export function randomLetter(rng) {
  return pick(rng, WEIGHTED_ALPHABET);
}
