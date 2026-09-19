/**
 * One play session against one lock: offsets, move count, undo history.
 * No DOM here — the UI reads from this and calls into it.
 */

import { applyMoveWith, isSeized, isSolved, moveMatrix, rowStatus, windowRows } from './engine.js';

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
    return this;
  }

  /**
   * Turn a wheel one step. Returns the wheels that actually moved so the UI can
   * animate the whole chain, or null if the wheel is seized.
   */
  turn(wheel, dir) {
    if (isSeized(this.lock, wheel)) return null;
    const before = this.offsets;
    this.offsets = applyMoveWith(before, this.matrix, wheel, dir);
    this.history.push({ wheel, dir });
    this.moves += 1;
    return this.offsets.map((offset, index) => ({ wheel: index, moved: offset !== before[index] }));
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

  /** Switch modes mid-lock (the daily continues from Combination into Full Lock). */
  setMode(mode) {
    this.mode = mode;
    return this;
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
