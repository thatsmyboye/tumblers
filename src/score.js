/** Stars, and the copyable share block. */

export const MODE_LABELS = {
  combination: 'Combination 🔐',
  full: 'Full Lock 🔓',
  daily: 'Daily 🔓',
};

/**
 * Three stars for solving in par, two for a comfortable overshoot, one for
 * getting there at all. Undos are counted separately and never cost a star.
 */
export function starsFor(moves, par) {
  if (moves <= par) return 3;
  if (moves <= par + Math.max(2, Math.ceil(par / 2))) return 2;
  return 1;
}

export function starGlyphs(stars) {
  return '⭐'.repeat(stars);
}

/**
 * @typedef {{ label?: string, moves: number, par: number }} Leg
 *
 * @param {{
 *   number: number,
 *   mode: 'combination' | 'full' | 'daily',
 *   moves?: number,
 *   par?: number,
 *   legs?: Leg[],
 *   undos?: number,
 *   themeRevealed?: boolean,
 *   bonusStar?: boolean,
 * }} result
 * @returns {string}
 */
export function shareText(result) {
  const { number, mode, undos = 0, themeRevealed = false, bonusStar = false } = result;
  const lines = [`Tumblers #${number} · ${MODE_LABELS[mode] ?? mode}`];

  const legs = result.legs ?? [{ moves: result.moves ?? 0, par: result.par ?? 0 }];
  legs.forEach((leg, index) => {
    const stars = starGlyphs(starsFor(leg.moves, leg.par));
    const bonus = bonusStar && index === legs.length - 1 ? ' 🌟' : '';
    const prefix = leg.label ? `${leg.label} ` : 'Moves ';
    lines.push(`${prefix}${leg.moves} / par ${leg.par} ${stars}${bonus}`);
  });

  lines.push(`Undos ${undos} ↩️${themeRevealed ? ' 💡' : ''}`);
  return lines.join('\n');
}

/** Total stars earned, for the results panel. */
export function totalStars(legs, bonusStar = false) {
  return legs.reduce((sum, leg) => sum + starsFor(leg.moves, leg.par), 0) + (bonusStar ? 1 : 0);
}
