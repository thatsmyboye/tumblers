/**
 * A lock as a short URL-safe string, so a practice lock can be handed to
 * someone else: `?lock=1~RINGS~START~LINKS~SEIZED~MODE`.
 *
 *   1        format version
 *   RINGS    30 letters, wheel by wheel
 *   START    5 digits, the scrambled offsets
 *   LINKS    comma-separated `from to sign`, e.g. `03a,21r` (a: aligned, r: reversed)
 *   SEIZED   wheel digits, possibly empty
 *   MODE     c (Combination) or f (Full Lock)
 */

import { RING_SIZE, WHEEL_COUNT } from './engine.js';

const VERSION = '1';
const SEPARATOR = '~';

/**
 * @param {import('./engine.js').Lock} lock
 * @param {'combination' | 'full'} mode
 */
export function encodeLock(lock, mode = 'full') {
  const rings = lock.rings.map((ring) => ring.join('')).join('');
  const start = lock.start.join('');
  const links = lock.links.map((link) => `${link.from}${link.to}${link.sign > 0 ? 'a' : 'r'}`).join(',');
  const seized = (lock.seized ?? []).join('');
  return [VERSION, rings, start, links, seized, mode === 'combination' ? 'c' : 'f'].join(SEPARATOR);
}

/**
 * @param {string} code
 * @returns {{ lock: import('./engine.js').Lock, mode: 'combination' | 'full' } | null}
 *   null when the code is not a well-formed lock. Par is left for the caller
 *   to compute — the solver is the only thing that can vouch for it.
 */
export function decodeLock(code) {
  if (typeof code !== 'string') return null;
  const parts = code.split(SEPARATOR);
  if (parts.length !== 6 || parts[0] !== VERSION) return null;
  const [, ringText, startText, linkText, seizedText, modeText] = parts;

  const letters = ringText.toUpperCase();
  if (!new RegExp(`^[A-Z]{${RING_SIZE * WHEEL_COUNT}}$`).test(letters)) return null;
  const rings = Array.from({ length: WHEEL_COUNT }, (_, wheel) =>
    letters.slice(wheel * RING_SIZE, (wheel + 1) * RING_SIZE).split(''),
  );

  if (!new RegExp(`^[0-${RING_SIZE - 1}]{${WHEEL_COUNT}}$`).test(startText)) return null;
  const start = startText.split('').map(Number);

  const links = [];
  const pairs = new Set();
  for (const item of linkText ? linkText.split(',') : []) {
    const match = /^([0-4])([0-4])([ar])$/.exec(item);
    if (!match) return null;
    const from = Number(match[1]);
    const to = Number(match[2]);
    if (from === to || pairs.has(`${from}:${to}`)) return null;
    pairs.add(`${from}:${to}`);
    links.push({ from, to, sign: match[3] === 'a' ? 1 : -1 });
  }

  if (!/^[0-4]*$/.test(seizedText)) return null;
  const seized = [...new Set(seizedText.split('').filter(Boolean).map(Number))];
  if (seized.length === WHEEL_COUNT) return null;

  if (modeText !== 'c' && modeText !== 'f') return null;
  return { lock: { rings, links, seized, start }, mode: modeText === 'c' ? 'combination' : 'full' };
}
