/** Wires the board, the game session, scoring, saving and the daily pack together. */

import { Board } from './board.js';
import { WHEEL_COUNT, driversOf, encodeState, isSeized } from './engine.js';
import { Game } from './game.js';
import { DIFFICULTIES, generateLock } from './generator.js';
import { createSearch, goalMask, search } from './solver.js';
import { selectDaily } from './daily.js';
import { decodeLock, encodeLock } from './lockcode.js';
import { MODE_LABELS, shareText, starGlyphs, starsFor } from './score.js';
import { createStore } from './storage.js';
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
  lockInfo: $('lock-info'),
  hintNote: $('hint-note'),
  themeRow: $('theme-row'),
  themeBtn: $('theme-btn'),
  themeClue: $('theme-clue'),
  moves: $('stat-moves'),
  par: $('stat-par'),
  undos: $('stat-undos'),
  undo: $('undo'),
  hint: $('hint'),
  reset: $('reset'),
  result: $('result'),
  resultTitle: $('result-title'),
  resultStars: $('result-stars'),
  resultAnswer: $('result-answer'),
  share: $('share'),
  shareLock: $('share-lock'),
  shareText: $('share-text'),
  continue: $('continue'),
  again: $('again'),
  loading: $('loading'),
  helpBtn: $('help-btn'),
  helpDialog: $('help-dialog'),
};

const store = createStore();

/** How long a first tap on Reset stays armed, waiting for the second. */
const RESET_ARM_MS = 2500;

const state = {
  /** @type {'daily' | 'combination' | 'full'} */
  mode: 'daily',
  /** Where the lock came from: it decides numbering, saving and sharing. */
  source: /** @type {'daily' | 'practice' | 'shared'} */ ('daily'),
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
  /** Input is locked: a leg just finished, or the whole lock is open. */
  finished: false,
  /** The position the last hint was given for, so re-pressing it is free. */
  hintedState: null,
  /** Wheel the keyboard turns. */
  selected: 0,
  resetTimer: null,
  words: null,
  dailies: null,
};

let board;

/* ---------------------------------------------------------------- lock setup */

function startGame(lock, { mode, source, number = null, phase = mode === 'daily' ? 'combination' : mode }) {
  state.lock = lock;
  state.mode = mode;
  state.source = source;
  state.number = number;
  state.phase = phase;
  state.legs = [];
  state.legStartMoves = 0;
  state.themeRevealed = false;
  state.finished = false;
  state.hintedState = null;
  disarmReset();
  state.game = new Game(lock, phase === 'full' ? 'full' : 'combination', state.words.valid.has);
  state.par = lock.par?.[state.game.mode] ?? solveFromHere();

  board.setLock(lock);
  board.setSelected(-1);
  describeSeized(lock);
  ui.hintNote.hidden = true;
  ui.result.hidden = true;
  ui.themeRow.hidden = !lock.theme;
  ui.themeBtn.hidden = false;
  ui.themeClue.textContent = '';
  render();
}

/**
 * Name the seized wheels in words under the board. They are the one thing a
 * player cannot work out by trying it — every other wheel just turns.
 */
function describeSeized(lock) {
  const seized = lock.seized ?? [];
  ui.lockInfo.hidden = seized.length === 0;
  if (seized.length === 0) return;

  const numbers = seized.map((wheel) => wheel + 1);
  if (seized.length === 1) {
    const chains = driversOf(lock, seized[0]).length === 1 ? 'its chain' : 'its chains';
    ui.lockInfo.textContent = `🔒 Wheel ${numbers[0]} is seized — it only turns through ${chains}.`;
    return;
  }

  const list = `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
  ui.lockInfo.textContent = `🔒 Wheels ${list} are seized — they only turn through their chains.`;
}

/** The optimal line from where the board stands now, or null if there is none. */
function solutionFromHere() {
  const { lock, game } = state;
  return search(createSearch(lock), goalMask(lock, game.mode, state.words.valid), game.offsets);
}

/** Exact optimal distance from where the board stands now. */
function solveFromHere() {
  return solutionFromHere()?.par ?? 0;
}

function startDaily() {
  const { number, lock } = selectDaily(state.dailies);
  // Read the save before startGame's first render writes a blank one over it.
  const saved = store.loadDaily(number);
  startGame(lock, { mode: 'daily', source: 'daily', number });
  restoreDaily(saved);
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
    startGame(lock, { mode, source: 'practice', phase: mode });
  });
}

/**
 * A lock handed over in the URL. The code carries no par, so both are solved
 * here before play; a code that cannot be opened is refused outright.
 */
function startShared(code) {
  const decoded = decodeLock(code);
  if (!decoded) return false;
  const { lock, mode } = decoded;
  const searchCtx = createSearch(lock);
  const combination = search(searchCtx, goalMask(lock, 'combination', state.words.valid), lock.start);
  const full = search(searchCtx, goalMask(lock, 'full', state.words.valid), lock.start);
  if (!combination || !full) return false;
  lock.par = { combination: combination.par, full: full.par };
  startGame(lock, { mode, source: 'shared', phase: mode });
  return true;
}

/* -------------------------------------------------------------------- saving */

/** Progress on the daily is saved after every change; nothing else is. */
function persist() {
  if (state.source !== 'daily' || !state.game) return;
  store.saveDaily(state.number, {
    version: 1,
    game: state.game.snapshot(),
    phase: state.phase,
    legs: state.legs,
    legStartMoves: state.legStartMoves,
    par: state.par,
    themeRevealed: state.themeRevealed,
    finished: state.finished,
  });
}

/** Pick the daily back up where it was left, if a save fits today's lock. */
function restoreDaily(saved) {
  if (!saved || saved.version !== 1) return;

  const game = new Game(state.lock, saved.phase === 'full' ? 'full' : 'combination', state.words.valid.has);
  if (!game.restore(saved.game)) {
    store.clearDaily(state.number);
    return;
  }

  state.game = game;
  state.phase = saved.phase === 'full' ? 'full' : 'combination';
  state.legs = Array.isArray(saved.legs) ? saved.legs : [];
  state.legStartMoves = Number.isInteger(saved.legStartMoves) ? saved.legStartMoves : 0;
  state.par = Number.isInteger(saved.par) ? saved.par : solveFromHere();
  state.themeRevealed = saved.themeRevealed === true;
  state.finished = saved.finished === true;

  if (state.themeRevealed && state.lock.theme) {
    ui.themeClue.textContent = state.lock.theme.clue;
    ui.themeBtn.hidden = true;
  }
  if (state.finished && state.legs.length > 0) {
    showResult({ dailyContinues: state.phase === 'combination' });
  }
  render();
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
  if (state.source === 'daily') {
    const leg = state.phase === 'full' ? MODE_LABELS.full : MODE_LABELS.combination;
    return `#${state.number} · Daily · ${leg}`;
  }
  const origin = state.source === 'shared' ? 'Shared lock' : 'Practice';
  return `${origin} · ${MODE_LABELS[state.mode]}`;
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
  ui.hint.disabled = state.finished;
  board.render(game.offsets, game.rowStatus());

  for (const tab of ui.tabs.children) {
    tab.setAttribute('aria-selected', String(state.source !== 'shared' && tab.dataset.mode === state.mode));
  }
  ui.practice.hidden = state.source === 'daily';
  persist();
}

/* --------------------------------------------------------------------- moves */

function canTurn(wheel) {
  return Boolean(state.game) && !state.finished && !isSeized(state.lock, wheel);
}

/** @returns {boolean} whether the turn happened */
function onTurn(wheel, dir, { silent = false } = {}) {
  if (!canTurn(wheel)) return false;
  const deltas = state.game.turn(wheel, dir);
  if (!deltas) return false;
  if (!silent) board.animate(deltas);
  clearHint();
  disarmReset();
  navigator.vibrate?.(8);
  render();
  if (state.game.solved) finishLeg();
  return true;
}

function finishLeg() {
  const { game } = state;
  state.legs.push({
    label: state.mode === 'daily' ? (game.mode === 'full' ? 'Full Lock' : 'Combination') : null,
    moves: legMoves(),
    par: state.par,
  });

  // Input stays locked until the player chooses what happens next, so a
  // stray turn after the win cannot finish the same leg twice.
  state.finished = true;
  board.celebrate();
  showResult({ dailyContinues: state.mode === 'daily' && state.phase === 'combination' });
  render();
}

function continueToFullLock() {
  state.phase = 'full';
  state.legStartMoves = state.game.moves;
  state.game.setMode('full');
  state.par = solveFromHere();
  state.finished = false;
  state.hintedState = null;
  ui.result.hidden = true;
  render();
  // The Combination may already have opened the whole lock.
  if (state.game.solved) finishLeg();
}

/* --------------------------------------------------------------------- hints */

function clearHint() {
  board.clearHint();
  ui.hintNote.hidden = true;
}

/**
 * Point at the next optimal move. The first hint for a position is recorded
 * (and caps the stars); asking again from the same spot costs nothing more.
 */
function giveHint() {
  if (!state.game || state.finished) return;
  const solution = solutionFromHere();
  if (!solution || solution.path.length === 0) return;
  const { wheel, dir } = solution.path[0];

  const here = encodeState(state.game.offsets);
  if (state.hintedState !== here) {
    state.game.useHint();
    state.hintedState = here;
  }

  board.showHint(wheel, dir);
  ui.hintNote.textContent = `🔍 Turn wheel ${wheel + 1} ${dir > 0 ? '▲ up' : '▼ down'} · ${solution.par} to go`;
  ui.hintNote.hidden = false;
  render();
}

/* --------------------------------------------------------------------- reset */

function disarmReset() {
  clearTimeout(state.resetTimer);
  state.resetTimer = null;
  ui.reset.textContent = 'Reset';
  ui.reset.classList.remove('armed');
}

/** Reset needs a second tap when there is progress to lose. */
function requestReset() {
  if (!state.game) return;
  const nothingToLose = state.game.moves === 0 && state.legs.length === 0;
  if (!nothingToLose && !state.resetTimer) {
    ui.reset.textContent = 'Tap again';
    ui.reset.classList.add('armed');
    state.resetTimer = setTimeout(disarmReset, RESET_ARM_MS);
    return;
  }
  disarmReset();
  resetLock();
}

function resetLock() {
  state.game.reset();
  state.legs = [];
  state.legStartMoves = 0;
  state.finished = false;
  state.hintedState = null;
  state.phase = state.mode === 'daily' ? 'combination' : state.mode;
  state.game.setMode(state.phase === 'full' ? 'full' : 'combination');
  state.par = state.lock.par?.[state.game.mode] ?? solveFromHere();
  clearHint();
  ui.result.hidden = true;
  render();
}

/* -------------------------------------------------------------------- results */

function shareResultText() {
  const bonusStar = state.mode === 'daily' && state.legs.length === 2;
  return shareText({
    number: state.source === 'daily' ? state.number : null,
    mode: state.mode,
    legs: state.legs.map((leg) => ({ label: leg.label ?? undefined, moves: leg.moves, par: leg.par })),
    undos: state.game.undos,
    hints: state.game.hints,
    themeRevealed: state.themeRevealed,
    bonusStar,
  });
}

function showResult({ dailyContinues }) {
  const bonusStar = state.mode === 'daily' && state.legs.length === 2;
  const lastLeg = state.legs[state.legs.length - 1];
  const hinted = state.game.hints > 0;
  const openedBothAtOnce = state.mode === 'daily' && !dailyContinues && lastLeg.moves === 0;

  ui.resultTitle.textContent = dailyContinues
    ? 'Combination cracked'
    : openedBothAtOnce
      ? 'Both at once 🌟'
      : state.mode === 'daily'
        ? 'Full Lock open 🌟'
        : 'Lock open';
  ui.resultStars.textContent =
    starGlyphs(starsFor(lastLeg.moves, lastLeg.par, { hinted })) + (bonusStar ? ' 🌟' : '');

  // The answer is a reveal for the finished lock, not a spoiler for the next leg.
  const answer = state.lock.answer ?? state.lock.words;
  ui.resultAnswer.hidden = dailyContinues || !answer;
  if (answer && !dailyContinues) {
    ui.resultAnswer.innerHTML = `The lock was <b>${answer.join(' · ')}</b>`;
  }

  ui.shareText.textContent = shareResultText();
  ui.continue.hidden = !dailyContinues;
  ui.shareLock.hidden = state.source === 'daily';
  ui.again.hidden = dailyContinues;
  ui.again.textContent = state.source === 'daily' ? 'Practice a new lock' : 'New lock';
  ui.result.hidden = false;
  ui.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Hand text to the system share sheet where there is one, otherwise the
 * clipboard. The button reports what happened.
 */
async function shareOut(button, text, idleLabel) {
  try {
    if (navigator.share && (!navigator.canShare || navigator.canShare({ text }))) {
      await navigator.share({ text });
      button.textContent = 'Shared ✓';
    } else {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied ✓';
    }
  } catch (error) {
    // Dismissing the share sheet rejects too; that is not a failure to report.
    if (error?.name !== 'AbortError') button.textContent = 'Select the text above to copy';
  }
  setTimeout(() => {
    button.textContent = idleLabel;
  }, 1800);
}

function lockUrl() {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('lock', encodeLock(state.lock, state.game.mode));
  return url.toString();
}

/* -------------------------------------------------------------------- wiring */

function bind() {
  board = new Board(ui.board, { onTurn, canTurn });

  ui.tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-mode]');
    if (!tab) return;
    if (tab.dataset.mode === 'daily') startDaily();
    else startPractice(tab.dataset.mode);
  });

  ui.newLock.addEventListener('click', () => startPractice(state.mode === 'daily' ? 'full' : state.mode));
  ui.again.addEventListener('click', () => startPractice(state.mode === 'daily' ? 'full' : state.mode));

  ui.undo.addEventListener('click', () => {
    if (!state.game || state.finished) return;
    if (state.game.undo()) {
      clearHint();
      render();
    }
  });

  ui.hint.addEventListener('click', giveHint);
  ui.reset.addEventListener('click', requestReset);
  ui.continue.addEventListener('click', continueToFullLock);

  ui.themeBtn.addEventListener('click', () => {
    state.themeRevealed = true;
    ui.themeClue.textContent = state.lock.theme?.clue ?? '';
    ui.themeBtn.hidden = true;
    render();
  });

  ui.share.addEventListener('click', () => shareOut(ui.share, shareResultText(), 'Share result'));
  ui.shareLock.addEventListener('click', () =>
    shareOut(ui.shareLock, `Can you open this lock?\n${lockUrl()}`, 'Send this lock to a friend'),
  );

  ui.helpBtn.addEventListener('click', () => ui.helpDialog.showModal());
  ui.helpDialog.addEventListener('close', () => store.markHelpSeen());

  // Keyboard: 1-5 or ←/→ pick a wheel, ↑/↓ turn it, Z undoes, H hints.
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, dialog')) return;
    const key = event.key;
    if (key >= '1' && key <= String(WHEEL_COUNT)) state.selected = Number(key) - 1;
    else if (key === 'ArrowLeft') state.selected = (state.selected + WHEEL_COUNT - 1) % WHEEL_COUNT;
    else if (key === 'ArrowRight') state.selected = (state.selected + 1) % WHEEL_COUNT;
    else if (key === 'ArrowUp') onTurn(state.selected, 1);
    else if (key === 'ArrowDown') onTurn(state.selected, -1);
    else if (key.toLowerCase() === 'z') ui.undo.click();
    else if (key.toLowerCase() === 'h') giveHint();
    else return;
    board.setSelected(state.selected);
    event.preventDefault();
  });
  // The selection ring is a keyboard affordance; a touch or click retires it.
  window.addEventListener('pointerdown', () => board.setSelected(-1), { capture: true });
}

/* ---------------------------------------------------------------------- boot */

function registerOffline() {
  if (!('serviceWorker' in navigator) || !window.location.protocol.startsWith('http')) return;
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Offline support is a nicety; the game runs without it.
  });
}

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

    const code = new URLSearchParams(window.location.search).get('lock');
    if (!code || !startShared(code)) {
      startDaily();
      if (code) ui.goal.textContent = 'That lock link could not be opened — here is today’s instead.';
    }

    if (!store.hasSeenHelp()) ui.helpDialog.showModal();
    registerOffline();
  } catch (error) {
    ui.loading.textContent = `Could not start: ${error.message}`;
    console.error(error);
  }
}

// Exposed for quick console poking during development.
window.tumblers = { state, DIFFICULTIES, store };

boot();
