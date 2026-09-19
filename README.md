# Tumblers

A word puzzle about cracking a letter lock. Five wheels, six letters each, three
rows showing. Turn a wheel to change what the rows spell — but the wheels are
chained, so turning one turns another with it.

Playable in a browser, installable to a phone's home screen, no build step, no
dependencies.

```
npm start           # serve on http://localhost:8000
npm test            # unit tests + a check that every baked daily's par is exact
npm run gen         # print a freshly generated lock, answer included
npm run bake        # re-bake the pack of dailies
npm run build:words # rebuild the word lists from their sources
npm run build:themes
```

## How it plays

- **Drag** a wheel up or down and it follows your finger — along with every wheel
  it is chained to, in the direction of each chain. Let go past a third of a
  cell and it turns; short of that it springs back. The arrows above and below
  turn a wheel one step too.
- Wheels are joined by coloured chains, running from an **open collar** (the end
  you turn) to an **arrowhead** (the wheel it drags along). **↑↑** means that
  wheel turns the same way; **↑↓** means the opposite way. Links are one hop:
  driving A turns everything A is chained to, but does not carry on through
  *their* chains.
- The strip above the wheels says what each column can do, using the same marks:
  `free` turns alone, `○ drives` turns alone *and* pulls another (nothing pulls
  it, so it holds still while you work elsewhere), `▼ pulled` still turns on its
  own but drifts when its partner moves, and `🔒 seized` has no arrows at all —
  it only ever moves in lockstep with whatever drives it, and its chain is drawn
  as a thick bar-ended coupling.
- Press and hold any wheel to light up exactly what moves with it. Hold a seized
  wheel to see which wheels you have to turn instead.
- **Combination** mode needs the middle row to spell a word; the outer rows step
  back so the target is obvious. **Full Lock** needs all three rows at once.
- The **Daily** is one lock played twice: crack the Combination, then continue
  from wherever you landed and open the Full Lock for a bonus star. Progress is
  saved, so a reload picks up where you left off, and a finished daily shows its
  result again.
- Par is the fewest moves possible, found by exhaustive search. Undo is
  unlimited, never costs a move, and is counted separately in the share. A
  **hint** points at the next optimal move; taking one caps the lock at two
  stars. Reset asks for a second tap when there is progress to lose.
- When the lock opens you see what it was, and can share the result through the
  system share sheet (or the clipboard). A practice lock can be sent to a friend
  as a link.

```
Tumblers #42 · Full Lock 🔓
Moves 11 / par 9 ⭐⭐
Undos 2 ↩️ 💡
```

Keyboard: `1`–`5` or `←`/`→` pick a wheel, `↑`/`↓` turn it, `Z` undoes, `H` hints.

## How it works

The whole mutable board state is five ring offsets, so a position is a point in
`Z6^5` — 7,776 of them. Turning wheel `w` adds a fixed vector to that point: `+1`
on `w` itself and `±1` on each wheel it is chained to. Every move is therefore a
translation, which makes them all invertible and makes the reachable set easy to
reason about.

That smallness is what the design leans on: **par is not estimated, it is
searched**. `src/solver.js` marks every state that counts as solved, then runs a
breadth-first search from the scrambled start. The first goal it reaches is the
optimal solution. The same search, run backward from the goals, is what powers
hints and prices every possible scramble at once.

Generation (`src/generator.js`) works backward:

1. Pick three five-letter words that stack in the window.
2. Drop each column's three letters into that column's ring and fill the other
   three slots — usually with the letters of another real word, so the board
   grows decoys the player has to rule out.
3. Wire up links (and, on hard, one seized wheel), then scramble by applying
   random legal moves.
4. BFS the distance from *every* position to the nearest solution, then keep a
   scramble whose par falls inside the difficulty's band. Locks whose rings have
   no decoys, or far too many solutions, are thrown away.

The difficulty bands do not overlap — easy is par 4–6, medium 7–8, hard 10–12 —
so a harder lock is genuinely deeper, not just wired with more chains. Because
one distance table prices every possible scramble at once, generating a lock
takes about 12ms (easy, medium) to 45ms (hard): fast enough to run in the browser
for practice locks, and used offline to pre-bake the dailies.

### Layout

| Path | What it is |
| --- | --- |
| `src/engine.js` | Board state, rotation, link propagation, win detection, wheel roles |
| `src/solver.js` | BFS over the state space — exact par, optimal line, distance map |
| `src/generator.js` | Backward generation and the difficulty thresholds |
| `src/game.js` | One play session: moves, undo history, hints, save/restore |
| `src/board.js` | Drums, window, chains and role marks; drag, touch and keyboard input |
| `src/app.js` | Modes, the daily's two legs, hints, saving, results and sharing |
| `src/score.js` | Stars and the share block |
| `src/daily.js` | Calendar day → puzzle number → lock |
| `src/lockcode.js` | A lock as a short URL-safe string, for sending to a friend |
| `src/storage.js` | Saved progress, tolerant of blocked storage |
| `sw.js`, `manifest.webmanifest` | Offline play and home-screen install |
| `data/` | Word lists, theme clues, the baked pack of dailies |
| `scripts/` | Static server, lock generator CLI, daily baker, word-list and theme builders |

### Word lists

Two lists, built by `npm run build:words`:

- `data/valid5.txt` (5,525 words) is everything the game accepts. A word has to
  be spelled correctly *and* in real use: the spelling authority is
  [dwyl/english-words](https://github.com/dwyl/english-words) (public domain),
  the usage authority is the top 10,000 five-letter tokens of Peter Norvig's
  [count_1w.txt](https://norvig.com/ngrams/), the Google Web Trillion Word
  Corpus ranked by frequency. Spelling alone is not enough: the dictionary
  accepts "dulat", "cerat" and "piend", and a solver that knows those words sets
  a par no human can reach.
- `data/answers5.txt` (1,130 words) is the pool solutions come from, taken from
  [google-10000-english](https://github.com/first20hours/google-10000-english)
  in frequency order so the generator can prefer familiar words. Given names are
  removed using [dominictarr/random-name](https://github.com/dominictarr/random-name)
  (with an allowlist for words like AMBER and ROBIN); surnames, places, brands
  and corpus artefacts are listed by hand in the script.

Theme clues in `data/themes.json` are hand-written drafts filtered to accepted
words by `npm run build:themes`.

### Dailies

`data/dailies.json` holds 120 pre-baked locks with their pars and answer rows.
`src/daily.js` maps the calendar onto the pack from an epoch of 2026-09-01,
wrapping rather than running dry. Difficulty ramps across the week
(`easy easy medium medium medium hard hard`) and every third lock carries a
theme clue.

To re-bake: `npm run bake -- --count 200 --seed my-seed`. The same seed always
produces the same pack.

### Tests

`npm test` covers the engine's link algebra and wheel roles, the solver
(cross-checked against a separately written BFS), the generator's guarantees,
scoring, lock codes, saved state, and the baked pack — every daily's recorded
par is re-derived from scratch.

`test/browser-smoke.mjs` drives the real page in Chromium: the first-visit
card, tapping and dragging (a short drag springs back, a long one commits),
undo, hints, the two-tap reset, both legs of the daily, the share text and
answer reveal, a reload mid-game and after finishing, in-browser generation,
and opening a lock from a link. It is kept out of `npm test` because it needs
Playwright, which the game itself does not:

```
npm install --no-save playwright && node test/browser-smoke.mjs
```

## Not yet

Vault (endless) mode, hard mode (hiding the rings — `Board` already takes a
`hideRings` option, nothing drives it yet), accounts, streaks and stats across
days.
