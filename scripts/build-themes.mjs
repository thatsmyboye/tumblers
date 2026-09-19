#!/usr/bin/env node
/**
 * Build data/themes.json from the hand-written theme drafts below, keeping
 * only words the game accepts. Re-run after changing the word lists.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const MIN_WORDS = 6;

const DRAFTS = [
  ['In the kitchen', 'bread knife plate spoon flour sugar stove onion grill whisk pasta sauce toast bacon'],
  ['Weather report', 'storm cloud sleet frost sunny windy rains flood drift chill gusts humid foggy'],
  ['Make some noise', 'chord piano flute drums tempo lyric banjo organ tunes bugle viola cello'],
  ['On the water', 'beach ocean tides waves coral shore delta reefs canoe kayak yacht buoys'],
  ['Shades', 'amber beige black brown coral cream green ivory lemon olive peach white'],
  ['Game day', 'arena coach medal rugby score skate sport track vault pitch relay teams'],
  ['Green things', 'birch cedar maple aspen roots leafy fruit vines bloom petal thorn grass'],
  ['Look up', 'comet orbit lunar solar stars venus pluto space moons alien probe'],
  ['Money matters', 'asset audit banks bonds cents coins costs funds loans wages yield price'],
  ['Getting dressed', 'boots cloak dress glove jeans scarf shirt shoes skirt socks pants tunic'],
  ['How you feel', 'angry bliss dread happy jolly proud sorry upset weary cheer grief eager'],
  ['Anatomy', 'ankle brain chest elbow heart liver mouth nerve spine thumb wrist teeth'],
  ['Places to stay', 'attic cabin condo foyer hotel house lobby manor motel tower villa suite'],
  ['A hand of cards', 'bluff chips deuce hands joker poker spade heart clubs trump deals stack'],
  ['Whodunnit', 'alibi crime clues guilt proof thief trail raids court judge sworn'],
  ['Tools', 'clamp drill lathe level plane punch screw spade brace gauge bench'],
];

const valid = new Set(
  readFileSync('data/valid5.txt', 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
);

const themes = [];
for (const [clue, text] of DRAFTS) {
  const words = text.split(/\s+/);
  const kept = words.filter((word) => valid.has(word));
  const dropped = words.filter((word) => !valid.has(word));
  if (dropped.length) console.log(`  ${clue}: dropped ${dropped.join(', ')}`);
  if (kept.length < MIN_WORDS) {
    console.log(`SKIP ${clue} (only ${kept.length} accepted words)`);
    continue;
  }
  themes.push({ clue, words: kept });
}

writeFileSync('data/themes.json', `${JSON.stringify(themes, null, 2)}\n`);
console.log(`${themes.length} themes, ${themes.reduce((n, theme) => n + theme.words.length, 0)} words`);
