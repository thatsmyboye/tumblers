/**
 * Board rendering and input: the five drums, the three-row window, and the
 * link chains. Touch first — swipe a wheel, or use the arrows above and below.
 */

import { RING_SIZE, WHEEL_COUNT, WINDOW_ROWS, isSeized, mod } from './engine.js';

/** Display slots run one ring position above the window to two below. */
const SLOT_OFFSET = -1;
const SWIPE_THRESHOLD = 16;

const CHAIN_COLORS = ['#e0a33a', '#54b8e0', '#c47ae0', '#63c98a', '#e07a7a', '#8ea0ff'];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export class Board {
  /**
   * @param {HTMLElement} root
   * @param {{ onTurn: (wheel: number, dir: 1 | -1) => void }} handlers
   */
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.lock = null;
    this.hideRings = false;
    this.build();
  }

  build() {
    this.root.classList.add('board');
    this.root.innerHTML = '';

    this.chains = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.chains.setAttribute('class', 'chains');
    this.chains.setAttribute('aria-hidden', 'true');
    this.root.append(this.chains);

    this.upRow = el('div', 'turnrow turnrow-up');
    this.drums = el('div', 'drums');
    this.downRow = el('div', 'turnrow turnrow-down');
    this.root.append(this.upRow, this.drums, this.downRow);

    this.cells = [];
    this.drumNodes = [];

    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      this.upRow.append(this.makeTurnButton(wheel, 1));
      this.downRow.append(this.makeTurnButton(wheel, -1));

      const drum = el('div', 'drum');
      drum.dataset.wheel = String(wheel);
      const cells = [];
      for (let slot = 0; slot < RING_SIZE; slot += 1) {
        const inWindow = slot >= -SLOT_OFFSET && slot < -SLOT_OFFSET + WINDOW_ROWS;
        const cell = el('div', `cell${inWindow ? ' cell-window' : ' cell-back'}`);
        cells.push(cell);
        drum.append(cell);
      }
      this.cells.push(cells);
      this.drumNodes.push(drum);
      this.drums.append(drum);
      this.attachDrag(drum, wheel);
    }

    this.window = el('div', 'window');
    this.window.setAttribute('aria-hidden', 'true');
    this.drums.append(this.window);

    this.rowMarks = [];
    for (let row = 0; row < WINDOW_ROWS; row += 1) {
      const mark = el('div', 'rowmark');
      mark.style.setProperty('--row', String(row));
      this.rowMarks.push(mark);
      this.drums.append(mark);
    }

    this.resizeObserver = new ResizeObserver(() => this.drawChains());
    this.resizeObserver.observe(this.root);
  }

  makeTurnButton(wheel, dir) {
    const button = el('button', `turn turn-${dir > 0 ? 'up' : 'down'}`, dir > 0 ? '▲' : '▼');
    button.type = 'button';
    button.dataset.wheel = String(wheel);
    button.addEventListener('click', () => this.handlers.onTurn(wheel, dir));
    return button;
  }

  /** Swipe up or down anywhere on a drum; a tap counts as a nudge up. */
  attachDrag(drum, wheel) {
    let startY = null;
    drum.addEventListener('pointerdown', (event) => {
      startY = event.clientY;
      drum.setPointerCapture(event.pointerId);
    });
    drum.addEventListener('pointerup', (event) => {
      if (startY == null) return;
      const dy = event.clientY - startY;
      startY = null;
      if (Math.abs(dy) < SWIPE_THRESHOLD) return;
      this.handlers.onTurn(wheel, dy < 0 ? 1 : -1);
    });
    drum.addEventListener('pointercancel', () => {
      startY = null;
    });
  }

  /** @param {import('./engine.js').Lock} lock */
  setLock(lock, { hideRings = false } = {}) {
    this.lock = lock;
    this.hideRings = hideRings;
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      this.drumNodes[wheel].classList.toggle('seized', isSeized(lock, wheel));
      const label = isSeized(lock, wheel) ? 'Seized — turns only through its links' : '';
      this.drumNodes[wheel].title = label;
      for (const row of [this.upRow, this.downRow]) {
        const button = row.children[wheel];
        button.disabled = isSeized(lock, wheel);
        button.setAttribute(
          'aria-label',
          `Wheel ${wheel + 1} ${button.classList.contains('turn-up') ? 'up' : 'down'}`,
        );
      }
    }
    this.drawChains();
  }

  /**
   * @param {number[]} offsets
   * @param {{ word: string, required: boolean, valid: boolean }[]} rowStatus
   */
  render(offsets, rowStatus) {
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      for (let slot = 0; slot < RING_SIZE; slot += 1) {
        const ringIndex = mod(offsets[wheel] + slot + SLOT_OFFSET, RING_SIZE);
        const cell = this.cells[wheel][slot];
        const inWindow = cell.classList.contains('cell-window');
        cell.textContent = this.hideRings && !inWindow ? '' : this.lock.rings[wheel][ringIndex];
      }
    }

    rowStatus.forEach((status, row) => {
      const mark = this.rowMarks[row];
      mark.classList.toggle('required', status.required);
      mark.classList.toggle('valid', status.valid);
      mark.textContent = status.valid ? '✓' : '';
      mark.title = status.required ? `Row ${row + 1} must spell a word` : '';
    });

    this.window.classList.toggle(
      'window-solved',
      rowStatus.every((status) => !status.required || status.valid),
    );
  }

  /** Brief snap animation on the wheels a turn actually moved. */
  animate(moved, dir) {
    for (const { wheel, moved: didMove } of moved) {
      if (!didMove) continue;
      const drum = this.drumNodes[wheel];
      drum.classList.remove('turning-up', 'turning-down');
      // Force a reflow so the animation restarts on repeated taps.
      void drum.offsetWidth;
      drum.classList.add(dir > 0 ? 'turning-up' : 'turning-down');
    }
  }

  /**
   * Draw each link as a coloured chain arcing from the wheel that drives it to
   * the wheel it turns, labelled with the direction it turns that wheel.
   */
  drawChains() {
    if (!this.lock) return;
    const svg = this.chains;
    svg.innerHTML = '';

    // Measure the band the chains live in and draw into it 1:1. Nothing here
    // may change layout, or the ResizeObserver below would never settle.
    const bandBox = svg.getBoundingClientRect();
    const { width, height } = bandBox;
    if (width === 0 || height === 0) return;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const centerOf = (wheel) => {
      const box = this.drumNodes[wheel].getBoundingClientRect();
      return box.left - bandBox.left + box.width / 2;
    };

    this.lock.links.forEach((link, index) => {
      const color = CHAIN_COLORS[index % CHAIN_COLORS.length];
      const from = centerOf(link.from);
      const to = centerOf(link.to);
      // Nest the arcs by span, then by index, so two chains never share an apex.
      const lift = Math.min(height / 2 - 4, 8 + Math.abs(to - from) * 0.16 + index * 5);
      const y = height - 4;

      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', `M ${from} ${y} Q ${(from + to) / 2} ${y - lift * 2} ${to} ${y}`);
      path.setAttribute('class', 'chain');
      path.setAttribute('stroke', color);
      svg.append(path);

      const head = document.createElementNS(svg.namespaceURI, 'circle');
      head.setAttribute('cx', String(to));
      head.setAttribute('cy', String(y));
      head.setAttribute('r', '4.5');
      head.setAttribute('fill', color);
      svg.append(head);

      const tail = document.createElementNS(svg.namespaceURI, 'circle');
      tail.setAttribute('cx', String(from));
      tail.setAttribute('cy', String(y));
      tail.setAttribute('r', '3');
      tail.setAttribute('fill', 'none');
      tail.setAttribute('stroke', color);
      tail.setAttribute('stroke-width', '2');
      svg.append(tail);

      // Slide each label to a different point along its arc so labels on
      // neighbouring chains do not stack up.
      const t = 0.5 + ((index % 3) - 1) * 0.15;
      const label = document.createElementNS(svg.namespaceURI, 'text');
      label.setAttribute('x', String((1 - t) ** 2 * from + 2 * (1 - t) * t * ((from + to) / 2) + t ** 2 * to));
      label.setAttribute('y', String(y - 4 * lift * t * (1 - t) - 5));
      label.setAttribute('class', 'chain-label');
      label.setAttribute('fill', color);
      label.textContent = link.sign > 0 ? '↑↑' : '↑↓';
      svg.append(label);
    });
  }
}
