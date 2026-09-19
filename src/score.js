/** Stars, and the copyable share block. */

export const MODE_LABELS = {
  combination: 'Combination 🔐',
  full: 'Full Lock 🔓',
  daily: 'Daily 🔓',
};

/** The most stars a lock can earn once a hint has been taken. */
const HINTED_STAR_CAP = 2;

/**
 * Three stars for solving in par, two for a comfortable overshoot, one for
 * getting there at all. Undos are counted separately and never cost a star;
 * a hint caps the lock at two.
 */
export function starsFor(moves, par, { hinted = false } = {}) {
  let stars = 1;
  if (moves <= par) stars = 3;
  else if (moves <= par + Math.max(2, Math.ceil(par / 2))) stars = 2;
  return hinted ? Math.min(stars, HINTED_STAR_CAP) : stars;
}

export function starGlyphs(stars) {
  return '⭐'.repeat(stars);
}

/**
 * @typedef {{ label?: string, moves: number, par: number }} Leg
 *
 * @param {{
 *   number?: number | null,
 *   mode: 'combination' | 'full' | 'daily',
 *   moves?: number,
 *   par?: number,
 *   legs?: Leg[],
 *   undos?: number,
 *   hints?: number,
 *   themeRevealed?: boolean,
 *   bonusStar?: boolean,
 * }} result
 * @returns {string}
 */
export function shareText(result) {
  const { number, mode, undos = 0, hints = 0, themeRevealed = false, bonusStar = false } = result;
  // Practice and shared locks have no number: "Tumblers · Full Lock 🔓".
  const heading = number != null ? `Tumblers #${number}` : 'Tumblers';
  const lines = [`${heading} · ${MODE_LABELS[mode] ?? mode}`];

  const legs = result.legs ?? [{ moves: result.moves ?? 0, par: result.par ?? 0 }];
  legs.forEach((leg, index) => {
    const stars = starGlyphs(starsFor(leg.moves, leg.par, { hinted: hints > 0 }));
    const bonus = bonusStar && index === legs.length - 1 ? ' 🌟' : '';
    const prefix = leg.label ? `${leg.label} ` : 'Moves ';
    lines.push(`${prefix}${leg.moves} / par ${leg.par} ${stars}${bonus}`);
  });

  let tail = `Undos ${undos} ↩️`;
  if (hints > 0) tail += ` · Hints ${hints} 🔍`;
  if (themeRevealed) tail += ' 💡';
  lines.push(tail);
  return lines.join('\n');
}

/** Total stars earned, for the results panel. */
export function totalStars(legs, { bonusStar = false, hinted = false } = {}) {
  return legs.reduce((sum, leg) => sum + starsFor(leg.moves, leg.par, { hinted }), 0) + (bonusStar ? 1 : 0);
}
