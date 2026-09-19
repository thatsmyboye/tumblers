#!/usr/bin/env node
/**
 * Rebuild data/valid5.txt and data/answers5.txt from their public sources.
 * Only needs re-running if you want to change the sources or the filters.
 *
 * Usage: node scripts/build-wordlists.mjs
 */

import { writeFileSync } from 'node:fs';

const SOURCES = {
  // dwyl/english-words — public domain (Unlicense). The spelling authority:
  // a token has to be in here to count as a word at all.
  dictionary: 'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt',
  // Peter Norvig's count_1w.txt — the Google Web Trillion Word Corpus, ranked
  // by frequency. The usage authority: a word has to actually be *used* to be
  // accepted, which keeps par honest. words_alpha alone accepts "dulat",
  // "cerat" and "piend", and a solver that knows those words sets a par no
  // human can reach.
  usage: 'https://norvig.com/ngrams/count_1w.txt',
  // first20hours/google-10000-english — frequency-ordered common English.
  // Narrower still: what solutions are drawn from, so answers stay familiar.
  common: 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa.txt',
  // dominictarr/random-name — a few thousand given names. Frequency lists rank
  // RALPH and ANNIE as everyday words; a lock's answer should never be one.
  givenNames: 'https://raw.githubusercontent.com/dominictarr/random-name/master/first-names.txt',
};

/** How far down the usage ranking still counts as a word people know. */
const USAGE_RANK_LIMIT = 10000;

/**
 * Short and deliberately incomplete: these never show up as a solution word.
 * They stay in the acceptance list, so a player is never told a real word is
 * not a word.
 */
const BLOCKED = new Set([
  'bitch', 'dicks', 'whore', 'pussy', 'penis', 'semen', 'porno', 'nazis', 'fucks',
  'shits', 'sluts', 'cunts', 'dildo', 'boobs', 'rapes', 'naked', 'sexes', 'anus',
  'cocks', 'balls', 'randy', 'busty',
]);

/**
 * Given names that are also ordinary words. The names list would otherwise
 * take these out of the answer pool.
 */
const DUAL_USE = new Set(`
  amber angel belle berry bride brook bunny camel candy carol carry coral daisy
  ebony faith fancy frank gates glory grace happy heath holly honey honor ivory
  jewel kitty lucky mercy merry olive pearl penny robin sandy shell storm sunny
  teddy
`.trim().split(/\s+/));

/**
 * Surnames, places and brands common enough to rank as everyday words. Given
 * names come from data; these do not have a good public list, so they are
 * kept by hand. They all stay *accepted* — a player who spells TEXAS has
 * spelled a real thing — they just never anchor an answer.
 */
const OTHER_PROPER_NOUNS = new Set(`
  adams allan asian burke chevy china cisco clark cohen colin costa czech davis
  delhi derby diego dutch edgar egypt essex evans ghana greek haiti hayes hindu
  honda idaho india intel irish isaac italy japan johns jones kenya kodak korea
  latin lewis maine marco miami milan monte moore moses mazda nikon omaha paris
  roman salem santa singh spain swiss tampa texas tokyo vegas wales watts
  welsh xerox yahoo
  allah carlo congo dover iraqi islam leeds malta mardi nepal notre papua qatar
  samoa saudi sudan syria tamil tulsa verde yemen yukon
`.trim().split(/\s+/));

/** Tokens a web corpus ranks highly that are not words: code, chat, prefixes. */
const NOT_WORDS = new Set('const gonna wanna gotta thats ascii multi devel'.split(' '));

async function fiveLetterWords(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  const text = await response.text();
  // One entry per line; a frequency file also carries a count after the word.
  return text
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0]?.toLowerCase() ?? '')
    .filter((word) => /^[a-z]{5}$/.test(word));
}

const dictionary = new Set(await fiveLetterWords(SOURCES.dictionary));

// The names dataset is thin on common male names, so top it up by hand.
const MORE_GIVEN_NAMES = `
  aaron allen brian bruce bryan craig david derek dylan elvis floyd harry henry
  jacob james jason jesus jimmy keith kenny kevin larry lloyd logan louis mario
  oscar peter ralph roger scott simon steve tyler wayne
`.trim().split(/\s+/);
const givenNames = new Set([...(await fiveLetterWords(SOURCES.givenNames)), ...MORE_GIVEN_NAMES]);
const isProperNoun = (word) =>
  OTHER_PROPER_NOUNS.has(word) || (givenNames.has(word) && !DUAL_USE.has(word));

// count_1w.txt is "word<TAB>count" per line, most frequent first, so the
// first USAGE_RANK_LIMIT five-letter tokens are the ones people actually use.
const usage = (await fiveLetterWords(SOURCES.usage)).slice(0, USAGE_RANK_LIMIT);

// Keep the source's frequency order — the generator prefers earlier entries.
const seen = new Set();
const answers = (await fiveLetterWords(SOURCES.common)).filter((word) => {
  if (seen.has(word) || BLOCKED.has(word) || NOT_WORDS.has(word) || isProperNoun(word)) return false;
  if (!dictionary.has(word)) return false;
  seen.add(word);
  return true;
});

// Accepted = spelled correctly AND in real use; every answer is accepted too.
const valid = [...new Set([...usage.filter((word) => dictionary.has(word)), ...answers])].sort();

writeFileSync('data/valid5.txt', `${valid.join('\n')}\n`);
writeFileSync('data/answers5.txt', `${answers.join('\n')}\n`);
console.log(`data/valid5.txt: ${valid.length} words`);
console.log(`data/answers5.txt: ${answers.length} words`);
