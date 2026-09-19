import { readFileSync } from 'node:fs';
import { createDictionary, parseWordList } from '../src/words.js';

export const valid = createDictionary(parseWordList(readFileSync('data/valid5.txt', 'utf8')));
export const answers = parseWordList(readFileSync('data/answers5.txt', 'utf8'));
export const dailies = JSON.parse(readFileSync('data/dailies.json', 'utf8'));

/** Turn five row-words into five rings, padding with the same words cyclically. */
export function ringsFromRows(rows) {
  return Array.from({ length: 5 }, (_, wheel) => rows.map((row) => row[wheel].toUpperCase()));
}
