#!/usr/bin/env node
/**
 * Generate one lock and print it, answer included — handy for eyeballing the
 * generator's output.
 *
 * Usage: node scripts/generate.mjs [--difficulty medium] [--seed abc] [--theme "Shades"] [--json]
 */

import { readFileSync } from 'node:fs';
import { WINDOW_ROWS, windowRows } from '../src/engine.js';
import { generateLock } from '../src/generator.js';
import { createDictionary, parseWordList } from '../src/words.js';

const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i].replace(/^--/, '');
  if (key === 'json') args.json = true;
  else args[key] = process.argv[(i += 1)];
}

const valid = createDictionary(parseWordList(readFileSync('data/valid5.txt', 'utf8')));
const answers = parseWordList(readFileSync('data/answers5.txt', 'utf8'));
const themes = JSON.parse(readFileSync('data/themes.json', 'utf8'));
const theme = args.theme ? themes.find((entry) => entry.clue === args.theme) : undefined;
if (args.theme && !theme) throw new Error(`No theme called "${args.theme}"`);

const lock = generateLock({
  valid,
  answers,
  theme,
  difficulty: args.difficulty ?? 'medium',
  seed: args.seed ?? Date.now(),
});

if (!lock) {
  console.error('Could not generate a lock with those settings.');
  process.exit(1);
}

if (args.json) {
  console.log(JSON.stringify(lock, null, 2));
} else {
  console.log(`difficulty ${lock.difficulty}   par ${lock.par.combination} / ${lock.par.full}`);
  if (lock.theme) console.log(`theme: ${lock.theme.clue}`);
  console.log(`answer: ${lock.words.join(' / ')}`);
  console.log(
    'links:',
    lock.links.map((link) => `${link.from + 1}→${link.to + 1}${link.sign > 0 ? '↑↑' : '↑↓'}`).join('  ') || 'none',
  );
  if (lock.seized?.length) console.log('seized:', lock.seized.map((w) => w + 1).join(', '));
  console.log('\nwindow at start:');
  for (const [index, row] of windowRows(lock, lock.start).entries()) {
    console.log(`  ${row.split('').join(' ')}${index === Math.floor(WINDOW_ROWS / 2) ? '   <- middle' : ''}`);
  }
}
