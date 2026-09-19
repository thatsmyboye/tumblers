/** Wires the board, the game session, scoring and the daily pack together. */

import { Board } from './board.js';
import { WHEEL_COUNT, isSeized } from './engine.js';
import { Game } from './game.js';
import { DIFFICULTIES, generateLock } from './generator.js';
import { createSearch, goalMask, search } from './solver.js';
import { selectDaily } from './daily.js';
import { MODE_LABELS, shareText, starGlyphs, starsFor } from './score.js';
import { loadWordLists } from './words.js';

const $ = (id) => document.getElementById(id);

const ui = {
  subtitle: $('subtitle'),
  tabs: $('tabs'),
  goal: $('goal'),
  practice: $('practice'),
  difficulty: $('difficulty'),
  newLock: $('new-lock'),
  board: $('board'),
  themeRow: $('theme-row'),
  themeBtn: $('theme-btn'),
  themeClue: $('theme-clue'),
  moves: $('stat-moves'),
  par: $('stat-par'),
  undos: $('stat-undos'),
  undo: $('undo'),
  reset: $('reset'),
  result: $('result'),
  resultTitle: $('result-title'),
  resultStars: $('result-stars'),
  share: $('share'),
  shareText: $('share-text'),
  continue: $('continue'),
  again: $('again'),
  loading: $('loading'),
};

const state = {
  /** @type {'daily' | 'combination' | 'full'} */
  mode: 'daily',
  /** @type {import('./engine.js').Lock | null} */
  lock: null,
  /** @type {Game | null} */
  game: null,
  number: 1,
  /** Which leg of the daily we are on. */
  phase: 'combination',
  /** Par for the leg in progress; the daily's second leg is solved live. */
  par: 0,
  /** Finished legs of a daily: { label, moves, par }. */
  legs: [],
  /** Move count when the current leg started, so each leg is scored on its own. */
  legStartMoves: 0,
  themeRevealed: false,
  finished: false,
  words: null,
  dailies: null,
};

let board;

/* ---------------------------------------------------------------- lock setup */

function startGame(lock, { mode, number, phase = mode === 'daily' ? 'combination' : mode }) {
  state.lock = lock;
  state.number = number;
  state.phase = phase;
  state.legs = [];
  state.legStartMoves = 0;
  state.themeRevealed = false;
  state.finished = false;
  state.game = new Game(lock, phase === 'full' ? 'full' : 'combination', state.words.valid.has);
  state.par = lock.par?.[state.game.mode] ?? solveFromHere();

  board.setLock(lock);
  ui.result.hidden = true;
  ui.themeRow.hidden = !lock.theme;
  ui.themeBtn.hidden = false;
  ui.themeClue.textContent = '';
  render();
}

/** Exact optimal distance from where the board stands now. */
function solveFromHere() {
  const { lock, game } = state;
  const result = search(createSearch(lock), goalMask(lock, game.mode, state.words.valid), game.offsets);
  return result ? result.par : 0;
}

function startDaily() {
  const { number, lock } = selectDaily(state.dailies);
  startGame(lock, { mode: 'daily', number });
}

function startPractice(mode) {
  const difficulty = ui.difficulty.value;
  ui.loading.hidden = false;
  ui.loading.textContent = 'Cutting a new lock…';

  // Let the browser paint the message before the generator blocks the thread.
  requestAnimationFrame(() => {
    const lock = generateLock({
      valid: state.words.valid,
      answers: state.words.answers,
      difficulty,
      seed: Math.floor(Math.random() * 2 ** 31),
    });
    ui.loading.hidden = true;
    if (!lock) {
      ui.goal.textContent = 'Could not cut a lock that hard — try again.';
      return;
    }
    startGame(lock, { mode, number: state.number, phase: mode });
  });
}

/* ------------------------------------------------------------------ rendering */

function goalText() {
  const { game, lock } = state;
  const difficulty = lock.difficulty ? ` · ${lock.difficulty}` : '';
  if (game.mode === 'full') {
    return `Make <b>all three rows</b> spell words${difficulty}`;
  }
  return `Make the <b>middle row</b> spell a word${difficulty}`;
}

function subtitleText() {
  if (state.mode === 'daily') {
    const leg = state.phase === 'full' ? MODE_LABELS.full : MODE_LABELS.combination;
    return `#${state.number} · Daily · ${leg}`;
  }
  return `Practice · ${MODE_LABELS[state.mode]}`;
}

/** Moves spent on the leg in progress. */
function legMoves() {
  return Math.max(0, state.game.moves - state.legStartMoves);
}

function render() {
  const { game } = state;
  ui.subtitle.textContent = subtitleText();
  ui.goal.innerHTML = goalText();
  ui.moves.textContent = String(legMoves());
  ui.par.textContent = String(state.par);
  ui.undos.textContent = String(game.undos);
  ui.undo.disabled = game.history.length === 0 || state.finished;
  board.render(game.offsets, game.rowStatus());

  for (const tab of ui.tabs.children) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }
  ui.practice.hidden = state.mode === 'daily';
}

/* --------------------------------------------------------------------- moves */

function onTurn(wheel, dir) {
  if (state.finished || !state.game) return;
  if (isSeized(state.lock, wheel)) return;
  const moved = state.game.turn(wheel, dir);
  if (!moved) return;
  board.animate(moved, dir);
  render();
  if (state.game.solved) finishLeg();
}

function finishLeg() {
  const { game } = state;
  const leg = {
    label: state.mode === 'daily' ? (game.mode === 'full' ? 'Full Lock' : 'Combination') : null,
    moves: legMoves(),
    par: state.par,
  };
  state.legs.push(leg);

  const dailyContinues = state.mode === 'daily' && state.phase === 'combination';
  state.finished = !dailyContinues;
  showResult({ dailyContinues });
  render();
}

/* -------------------------------------------------------------------- results */

function showResult({ dailyContinues }) {
  const bonusStar = state.mode === 'daily' && state.legs.length === 2;
  const share = shareText({
    number: state.number,
    mode: state.mode,
    legs: state.legs.map((leg) => ({ label: leg.label ?? undefined, moves: leg.moves, par: leg.par })),
    undos: state.game.undos,
    themeRevealed: state.themeRevealed,
    bonusStar,
  });

  const lastLeg = state.legs[state.legs.length - 1];
  ui.resultTitle.textContent = dailyContinues
    ? 'Combination cracked'
    : state.mode === 'daily'
      ? 'Full Lock open 🌟'
      : 'Lock open';
  ui.resultStars.textContent = starGlyphs(starsFor(lastLeg.moves, lastLeg.par)) + (bonusStar ? ' 🌟' : '');
  ui.shareText.textContent = share;
  ui.continue.hidden = !dailyContinues;
  ui.again.hidden = state.mode === 'daily' && dailyContinues;
  ui.again.textContent = state.mode === 'daily' ? 'Practice a new lock' : 'New lock';
  ui.result.hidden = false;
  ui.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function continueToFullLock() {
  state.phase = 'full';
  state.legStartMoves = state.game.moves;
  state.game.setMode('full');
  state.par = solveFromHere();
  state.finished = false;
  ui.result.hidden = true;
  render();
}

/* -------------------------------------------------------------------- wiring */

function bind() {
  board = new Board(ui.board, { onTurn });

  ui.tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-mode]');
    if (!tab) return;
    state.mode = tab.dataset.mode;
    if (state.mode === 'daily') startDaily();
    else startPractice(state.mode);
  });

  ui.newLock.addEventListener('click', () => startPractice(state.mode));
  ui.again.addEventListener('click', () => {
    if (state.mode === 'daily') {
      state.mode = 'full';
    }
    startPractice(state.mode);
  });

  ui.undo.addEventListener('click', () => {
    if (!state.game || state.finished) return;
    if (state.game.undo()) render();
  });

  ui.reset.addEventListener('click', () => {
    if (!state.game) return;
    state.game.reset();
    state.legs = [];
    state.legStartMoves = 0;
    state.finished = false;
    state.phase = state.mode === 'daily' ? 'combination' : state.mode;
    state.game.setMode(state.phase === 'full' ? 'full' : 'combination');
    state.par = state.lock.par?.[state.game.mode] ?? solveFromHere();
    ui.result.hidden = true;
    render();
  });

  ui.continue.addEventListener('click', continueToFullLock);

  ui.themeBtn.addEventListener('click', () => {
    state.themeRevealed = true;
    ui.themeClue.textContent = state.lock.theme?.clue ?? '';
    ui.themeBtn.hidden = true;
  });

  ui.share.addEventListener('click', async () => {
    const text = ui.shareText.textContent;
    try {
      await navigator.clipboard.writeText(text);
      ui.share.textContent = 'Copied ✓';
    } catch {
      ui.share.textContent = 'Select the text above to copy';
    }
    setTimeout(() => {
      ui.share.textContent = 'Copy share text';
    }, 1800);
  });

  // Keyboard: 1-5 pick a wheel, arrows turn it.
  let selected = 0;
  window.addEventListener('keydown', (event) => {
    if (event.key >= '1' && event.key <= String(WHEEL_COUNT)) {
      selected = Number(event.key) - 1;
      return;
    }
    if (event.key === 'ArrowUp') onTurn(selected, 1);
    else if (event.key === 'ArrowDown') onTurn(selected, -1);
    else if (event.key.toLowerCase() === 'z') ui.undo.click();
    else return;
    event.preventDefault();
  });
}

/* ---------------------------------------------------------------------- boot */

async function boot() {
  bind();
  try {
    const [words, dailies] = await Promise.all([
      loadWordLists('./'),
      fetch('./data/dailies.json').then((response) => {
        if (!response.ok) throw new Error(`Could not load dailies (${response.status})`);
        return response.json();
      }),
    ]);
    state.words = words;
    state.dailies = dailies;
    ui.loading.hidden = true;
    startDaily();
  } catch (error) {
    ui.loading.textContent = `Could not start: ${error.message}`;
    console.error(error);
  }
}

// Exposed for quick console poking during development.
window.tumblers = { state, DIFFICULTIES };

boot();
