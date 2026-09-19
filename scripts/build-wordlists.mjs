#!/usr/bin/env node
/**
 * Rebuild data/valid5.txt and data/answers5.txt from their public sources.
 * Only needs re-running if you want to change the sources or the filters.
 *
 * Usage: node scripts/build-wordlists.mjs
 */

import { writeFileSync } from 'node:fs';

const SOURCES = {
  // dwyl/english-words — public domain (Unlicense). Broad: what the game accepts.
  valid: 'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt',
  // first20hours/google-10000-english — frequency-ordered common English.
  // Narrow: what solutions are drawn from, so answers stay familiar.
  common: 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa.txt',
};

/**
 * Short and deliberately incomplete: these never show up as a solution word.
 * They stay in the acceptance list, so a player is never told a real word is
 * not a word.
 */
const BLOCKED = new Set([
  'bitch', 'dicks', 'whore', 'pussy', 'penis', 'semen', 'porno', 'nazis', 'fucks',
  'shits', 'sluts', 'cunts', 'dildo', 'boobs', 'rapes', 'naked', 'sexes', 'anus',
]);

async function fiveLetterWords(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  const text = await response.text();
  return text
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((word) => /^[a-z]{5}$/.test(word));
}

const valid = [...new Set(await fiveLetterWords(SOURCES.valid))].sort();
const validSet = new Set(valid);

// Keep the source's frequency order — the generator prefers earlier entries.
const seen = new Set();
const answers = (await fiveLetterWords(SOURCES.common)).filter((word) => {
  if (seen.has(word) || BLOCKED.has(word) || !validSet.has(word)) return false;
  seen.add(word);
  return true;
});

writeFileSync('data/valid5.txt', `${valid.join('\n')}\n`);
writeFileSync('data/answers5.txt', `${answers.join('\n')}\n`);
console.log(`data/valid5.txt: ${valid.length} words`);
console.log(`data/answers5.txt: ${answers.length} words`);
