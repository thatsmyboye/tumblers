/**
 * One play session against one lock: offsets, move count, undo history.
 * No DOM here — the UI reads from this and calls into it.
 */

import { RING_SIZE, applyMoveWith, isSeized, isSolved, mod, moveMatrix, rowStatus, windowRows } from './engine.js';

/** Normalize an offset change on a 6-ring to the direction it turned: -1, 0 or 1. */
function turnDelta(before, after) {
  const diff = mod(after - before, RING_SIZE);
  if (diff === 0) return 0;
  return diff <= RING_SIZE / 2 ? 1 : -1;
}

export class Game {
  /**
   * @param {import('./engine.js').Lock} lock
   * @param {'combination' | 'full'} mode
   * @param {(word: string) => boolean} isWord
   */
  constructor(lock, mode, isWord) {
    this.lock = lock;
    this.mode = mode;
    this.isWord = isWord;
    this.matrix = moveMatrix(lock);
    this.reset();
  }

  reset() {
    this.offsets = this.lock.start.slice();
    /** @type {{ wheel: number, dir: 1 | -1 }[]} */
    this.history = [];
    this.moves = 0;
    this.undos = 0;
    this.hints = 0;
    return this;
  }

  /**
   * Turn a wheel one step. Returns how far every wheel actually turned so the
   * UI can animate the whole chain (a reversed link turns the other way), or
   * null if the wheel is seized.
   * @returns {{ wheel: number, delta: -1 | 0 | 1 }[] | null}
   */
  turn(wheel, dir) {
    if (isSeized(this.lock, wheel)) return null;
    const before = this.offsets;
    this.offsets = applyMoveWith(before, this.matrix, wheel, dir);
    this.history.push({ wheel, dir });
    this.moves += 1;
    return this.offsets.map((offset, index) => ({ wheel: index, delta: turnDelta(before[index], offset) }));
  }

  /** Undo is unlimited and counted separately — it never adds to the move count. */
  undo() {
    const last = this.history.pop();
    if (!last) return false;
    this.offsets = applyMoveWith(this.offsets, this.matrix, last.wheel, /** @type {1|-1} */ (-last.dir));
    this.moves = Math.max(0, this.moves - 1);
    this.undos += 1;
    return true;
  }

  /** A hint is free to take but is recorded, and caps the stars for the lock. */
  useHint() {
    this.hints += 1;
  }

  /** Switch modes mid-lock (the daily continues from Combination into Full Lock). */
  setMode(mode) {
    this.mode = mode;
    return this;
  }

  /** Everything needed to bring this session back after a reload. */
  snapshot() {
    return { history: this.history.slice(), undos: this.undos, hints: this.hints };
  }

  /**
   * Rebuild a session from a snapshot by replaying its moves. Returns false
   * and leaves the session untouched if the snapshot does not fit this lock.
   */
  restore(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.history)) return false;
    let offsets = this.lock.start.slice();
    for (const move of snapshot.history) {
      if (!Number.isInteger(move?.wheel) || ![1, -1].includes(move.dir)) return false;
      if (move.wheel < 0 || move.wheel >= offsets.length || isSeized(this.lock, move.wheel)) return false;
      offsets = applyMoveWith(offsets, this.matrix, move.wheel, move.dir);
    }
    this.offsets = offsets;
    this.history = snapshot.history.map((move) => ({ wheel: move.wheel, dir: move.dir }));
    this.moves = this.history.length;
    this.undos = Number.isInteger(snapshot.undos) ? snapshot.undos : 0;
    this.hints = Number.isInteger(snapshot.hints) ? snapshot.hints : 0;
    return true;
  }

  rows() {
    return windowRows(this.lock, this.offsets);
  }

  rowStatus() {
    return rowStatus(this.lock, this.offsets, this.mode, this.isWord);
  }

  get solved() {
    return isSolved(this.lock, this.offsets, this.mode, this.isWord);
  }
}
