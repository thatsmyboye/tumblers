/** Mapping calendar days onto the baked pack of dailies. */

export const DAILY_EPOCH = '2026-09-01';
const MS_PER_DAY = 86400000;

/** Whole UTC days between `epoch` and `date`. */
export function dayIndex(date = new Date(), epoch = DAILY_EPOCH) {
  const start = Date.parse(`${epoch}T00:00:00Z`);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((today - start) / MS_PER_DAY);
}

/** Puzzle number shown in the header and the share text. #1 is the epoch day. */
export function dailyNumber(date = new Date(), epoch = DAILY_EPOCH) {
  return dayIndex(date, epoch) + 1;
}

export function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/**
 * Pick the lock for a given day. If the calendar has run past the end of the
 * baked pack we wrap around rather than leave the player with nothing; the
 * puzzle number keeps counting up.
 *
 * @param {{ epoch?: string, puzzles: import('./engine.js').Lock[] }} pack
 */
export function selectDaily(pack, date = new Date()) {
  const number = dailyNumber(date, pack.epoch ?? DAILY_EPOCH);
  const puzzles = pack.puzzles;
  if (puzzles.length === 0) throw new Error('Daily pack is empty');
  const index = ((number - 1) % puzzles.length + puzzles.length) % puzzles.length;
  return { number: Math.max(1, number), lock: puzzles[index] };
}
