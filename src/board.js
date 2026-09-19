/**
 * Board rendering and input: the five drums, the three-row window, and the
 * link chains. Touch first — swipe a wheel, or use the arrows above and below.
 */

import { RING_SIZE, WHEEL_COUNT, WINDOW_ROWS, isSeized, mod, wheelRole } from './engine.js';

/** Display slots run one ring position above the window to two below. */
const SLOT_OFFSET = -1;
const SWIPE_THRESHOLD = 16;

const CHAIN_COLORS = ['#e0a33a', '#54b8e0', '#c47ae0', '#63c98a', '#e07a7a', '#8ea0ff'];

/**
 * What each column can do — the thing players most need to read off the board.
 * The marks echo the chain ends, so the strip doubles as a legend: an open
 * collar is the end you turn, an arrowhead is the end that gets pulled.
 *
 * The distinction that matters for planning is whether a wheel holds still
 * while you work elsewhere. A driver does; a pulled wheel drifts whenever its
 * partner turns; a seized wheel has no turn of its own at all and only ever
 * moves in lockstep with whatever drives it.
 */
const ROLES = {
  free: {
    label: 'free',
    title: 'Turns on its own. Nothing else moves with it, and nothing moves it.',
  },
  drives: {
    label: '○ drives',
    title:
      'Turns on its own and pulls another wheel along. Nothing pulls this one, so it stays put while you work elsewhere.',
  },
  pulled: {
    label: '▼ pulled',
    title: 'Turns on its own, but another wheel pulls it too — so it drifts when that wheel turns.',
  },
  seized: {
    label: '🔒 seized',
    title: 'No turn of its own — it only moves in lockstep with the wheel that drives it.',
  },
};

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
    /** @type {SVGPathElement[]} */
    this.chainPaths = [];
    this.build();
  }

  build() {
    this.root.classList.add('board');
    this.root.innerHTML = '';

    this.chains = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.chains.setAttribute('class', 'chains');
    this.chains.setAttribute('aria-hidden', 'true');
    this.root.append(this.chains);

    this.roleRow = el('div', 'roles');
    this.upRow = el('div', 'turnrow turnrow-up');
    this.drums = el('div', 'drums');
    this.downRow = el('div', 'turnrow turnrow-down');
    this.root.append(this.roleRow, this.upRow, this.drums, this.downRow);

    this.cells = [];
    this.drumNodes = [];
    this.roleNodes = [];

    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      const role = el('div', 'role');
      this.roleNodes.push(role);
      this.roleRow.append(role);

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
    const button = el('button', `turn turn-${dir > 0 ? 'up' : 'down'}`);
    button.type = 'button';
    button.dataset.wheel = String(wheel);
    button.addEventListener('click', () => this.handlers.onTurn(wheel, dir));
    // Show what this button would set in motion before it is pressed.
    button.addEventListener('pointerenter', () => this.preview(wheel));
    button.addEventListener('pointerleave', () => this.preview(null));
    button.addEventListener('focus', () => this.preview(wheel));
    button.addEventListener('blur', () => this.preview(null));
    return button;
  }

  /** Swipe up or down anywhere on a drum; pressing without swiping previews. */
  attachDrag(drum, wheel) {
    let startY = null;
    drum.addEventListener('pointerdown', (event) => {
      startY = event.clientY;
      drum.setPointerCapture(event.pointerId);
      this.preview(wheel);
    });
    drum.addEventListener('pointerup', (event) => {
      if (startY == null) return;
      const dy = event.clientY - startY;
      startY = null;
      this.preview(null);
      if (Math.abs(dy) < SWIPE_THRESHOLD) return;
      this.handlers.onTurn(wheel, dy < 0 ? 1 : -1);
    });
    drum.addEventListener('pointercancel', () => {
      startY = null;
      this.preview(null);
    });
    drum.addEventListener('pointerenter', () => this.preview(wheel));
    drum.addEventListener('pointerleave', () => {
      if (startY == null) this.preview(null);
    });
  }

  /** @param {import('./engine.js').Lock} lock */
  setLock(lock, { hideRings = false } = {}) {
    this.lock = lock;
    this.hideRings = hideRings;
    this.preview(null);

    const drivers = new Set(lock.links.map((link) => link.from));

    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      const seized = isSeized(lock, wheel);
      const roleName = wheelRole(lock, wheel);
      const role = ROLES[roleName];
      const alsoDrives = roleName === 'pulled' && drivers.has(wheel);

      const node = this.roleNodes[wheel];
      node.className = `role role-${roleName}`;
      node.textContent = role.label;
      node.title = `Wheel ${wheel + 1}: ${role.title}${alsoDrives ? ' It pulls one along as well.' : ''}`;

      const drum = this.drumNodes[wheel];
      drum.classList.toggle('seized', seized);
      drum.title = node.title;

      for (const row of [this.upRow, this.downRow]) {
        const button = row.children[wheel];
        const up = button.classList.contains('turn-up');
        button.disabled = seized;
        // A dash reads as "no turn here"; a greyed arrow just looks tappable.
        button.textContent = seized ? '—' : up ? '▲' : '▼';
        button.setAttribute(
          'aria-label',
          seized ? `Wheel ${wheel + 1} is seized` : `Turn wheel ${wheel + 1} ${up ? 'up' : 'down'}`,
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
   * Light up what a turn would set in motion: the wheel under the finger, every
   * wheel its chains drag along, and the chains between them. Pressing a seized
   * wheel shows the reverse — which wheel has to be turned to move it.
   *
   * @param {number | null} wheel
   */
  preview(wheel) {
    for (const drum of this.drumNodes) drum.classList.remove('driver', 'dragged');
    for (const path of this.chainPaths) path.classList.remove('live');
    this.root.classList.toggle('previewing', wheel != null && this.lock != null);
    if (wheel == null || !this.lock) return;

    const seized = isSeized(this.lock, wheel);
    this.drumNodes[wheel].classList.add(seized ? 'dragged' : 'driver');

    this.lock.links.forEach((link, index) => {
      const involved = seized ? link.to === wheel : link.from === wheel;
      if (!involved) return;
      this.drumNodes[seized ? link.from : link.to].classList.add(seized ? 'driver' : 'dragged');
      this.chainPaths[index]?.classList.add('live');
    });
  }

  /**
   * Draw each link as a coloured chain from the wheel that drives it to the
   * wheel it turns. The arrowhead marks the driven end, so the direction of the
   * pull is readable without tracing the arc, and a seized end is drawn as a
   * rigid coupling because that wheel can *only* move this way.
   */
  drawChains() {
    if (!this.lock) return;
    const svg = this.chains;
    svg.innerHTML = '';
    this.chainPaths = [];

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

    // A wheel can sit on several chains. Fan their ends out across the top of
    // the column so a collar and an arrowhead never land on the same spot.
    const endCount = new Map();
    for (const link of this.lock.links) {
      for (const wheel of [link.from, link.to]) endCount.set(wheel, (endCount.get(wheel) ?? 0) + 1);
    }
    const endsPlaced = new Map();
    const endX = (wheel) => {
      const total = endCount.get(wheel) ?? 1;
      const index = endsPlaced.get(wheel) ?? 0;
      endsPlaced.set(wheel, index + 1);
      return centerOf(wheel) + (index - (total - 1) / 2) * 11;
    };

    // Label positions already used, so the next one can dodge them.
    const labelSpots = [];
    const dodge = (x, y) => {
      for (let bump = 0; bump < 3; bump += 1) {
        if (!labelSpots.some((spot) => Math.abs(spot.x - x) < 18 && Math.abs(spot.y - y) < 12)) break;
        y -= 13;
      }
      labelSpots.push({ x, y });
      return y;
    };

    const add = (name, attributes) => {
      const node = document.createElementNS(svg.namespaceURI, name);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
      svg.append(node);
      return node;
    };

    this.lock.links.forEach((link, index) => {
      const color = CHAIN_COLORS[index % CHAIN_COLORS.length];
      const rigid = isSeized(this.lock, link.to);
      const from = endX(link.from);
      const to = endX(link.to);
      // Nest the arcs by span, then by index, so two chains never share an apex.
      const lift = Math.min(height / 2 - 6, 8 + Math.abs(to - from) * 0.16 + index * 5);
      // Leave room below the line for an arrowhead and a seized wheel's bar.
      const y = height - 14;

      const path = add('path', {
        d: `M ${from} ${y} Q ${(from + to) / 2} ${y - lift * 2} ${to} ${y}`,
        class: `chain${rigid ? ' chain-rigid' : ''}`,
        stroke: color,
      });
      this.chainPaths.push(path);

      // Driving end: an open collar, the wheel you put your hand on.
      add('circle', { cx: from, cy: y, r: 3.5, fill: 'none', stroke: color, 'stroke-width': 2 });

      // Driven end: an arrowhead pointing down into the wheel it turns.
      const size = rigid ? 7 : 5.5;
      add('path', {
        d: `M ${to - size} ${y - size + 1} L ${to + size} ${y - size + 1} L ${to} ${y + size - 1} Z`,
        fill: color,
        class: 'chain-head',
      });
      if (rigid) {
        // A bar across the head: this wheel has no turn of its own.
        add('rect', { x: to - size, y: y + size, width: size * 2, height: 2.5, rx: 1.25, fill: color });
      }

      // Spread the labels along their arcs, then nudge any that still land on
      // top of one another.
      const t = 0.5 + ((index + 0.5) / this.lock.links.length - 0.5) * 0.55;
      const labelX = (1 - t) ** 2 * from + 2 * (1 - t) * t * ((from + to) / 2) + t ** 2 * to;
      add('text', {
        x: labelX,
        y: dodge(labelX, y - 4 * lift * t * (1 - t) - 5),
        class: 'chain-label',
        fill: color,
      }).textContent = link.sign > 0 ? '↑↑' : '↑↓';
    });
  }
}
