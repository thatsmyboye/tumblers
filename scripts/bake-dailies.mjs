#!/usr/bin/env node
/**
 * Pre-bake daily locks so the browser never has to run the generator.
 *
 * Usage: node scripts/bake-dailies.mjs [--count 120] [--epoch 2026-09-01]
 *                                      [--seed tumblers-v0] [--out data/dailies.json]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { DIFFICULTIES, generateLock, stripSolution } from '../src/generator.js';
import { createDictionary, parseWordList } from '../src/words.js';
import { DAILY_EPOCH } from '../src/daily.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, '')] = argv[i + 1];
  }
  return args;
}

// Ease into the week and tighten toward the weekend.
const WEEK = ['easy', 'easy', 'medium', 'medium', 'medium', 'hard', 'hard'];

const args = parseArgs(process.argv.slice(2));
const count = Number(args.count ?? 120);
const epoch = args.epoch ?? DAILY_EPOCH;
const seed = args.seed ?? 'tumblers-v0';
const out = args.out ?? 'data/dailies.json';

const valid = createDictionary(parseWordList(readFileSync('data/valid5.txt', 'utf8')));
const answers = parseWordList(readFileSync('data/answers5.txt', 'utf8'));
const themes = JSON.parse(readFileSync('data/themes.json', 'utf8'));

const epochMs = Date.parse(`${epoch}T00:00:00Z`);
const puzzles = [];
const failures = [];

for (let index = 0; index < count; index += 1) {
  const date = new Date(epochMs + index * 86400000).toISOString().slice(0, 10);
  const difficulty = WEEK[index % WEEK.length];
  // Every third lock carries a theme clue.
  const theme = index % 3 === 2 ? themes[index % themes.length] : undefined;

  const lock = generateLock({
    seed: `${seed}:${date}`,
    valid,
    answers,
    difficulty,
    theme,
    id: date,
  });

  if (!lock) {
    failures.push(date);
    continue;
  }

  puzzles.push({ number: index + 1, date, ...stripSolution(lock) });
  process.stdout.write(`\r${puzzles.length}/${count} baked`);
}

process.stdout.write('\n');

writeFileSync(
  out,
  `${JSON.stringify(
    { version: 1, epoch, seed, generated: new Date().toISOString(), puzzles },
    null,
    1,
  )}\n`,
);

const byDifficulty = Object.fromEntries(
  Object.keys(DIFFICULTIES).map((name) => [
    name,
    puzzles.filter((puzzle) => puzzle.difficulty === name).length,
  ]),
);
const pars = puzzles.map((puzzle) => puzzle.par.full);

console.log(`Wrote ${puzzles.length} locks to ${out}`);
console.log('  by difficulty:', byDifficulty);
console.log(`  full-lock par: min ${Math.min(...pars)}, max ${Math.max(...pars)}`);
console.log(`  themed: ${puzzles.filter((puzzle) => puzzle.theme).length}`);
if (failures.length) console.warn(`  could not generate: ${failures.join(', ')}`);
