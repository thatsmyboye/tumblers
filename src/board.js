/**
 * Board rendering and input: the five drums, the three-row window, and the
 * link chains. Touch first — drag a wheel and it follows your finger, with
 * everything it is chained to moving alongside; or use the arrows.
 */

import { RING_SIZE, WHEEL_COUNT, WINDOW_ROWS, isSeized, mod, moveMatrix, wheelRole } from './engine.js';

/**
 * Each drum strip holds two spare cells beyond the six on show — one above,
 * one below — so a drag of up to a full cell in either direction always has
 * a letter to reveal. Slot `s` shows ring position `offset + s + SLOT_OFFSET`.
 */
const STRIP_SLOTS = RING_SIZE + 2;
const SLOT_OFFSET = -2;
/** Window rows occupy these strip slots. */
const FIRST_WINDOW_SLOT = 2;

/** How far (as a fraction of a cell) a drag must travel to count as a turn. */
const COMMIT_FRACTION = 0.3;
/** Movement below this is a press, not a drag. */
const DRAG_SLOP = 4;
/** Longest we wait for a CSS transition before carrying on regardless. */
const SETTLE_MS = 180;

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
   * @param {{
   *   onTurn: (wheel: number, dir: 1 | -1, options?: { silent?: boolean }) => boolean,
   *   canTurn?: (wheel: number) => boolean,
   * }} handlers
   */
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.lock = null;
    this.matrix = null;
    this.hideRings = false;
    /** @type {SVGPathElement[]} */
    this.chainPaths = [];
    /** @type {{ wheel: number, pointerId: number, startY: number, dy: number, active: boolean } | null} */
    this.drag = null;
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
    this.strips = [];
    this.roleNodes = [];

    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      const role = el('div', 'role');
      this.roleNodes.push(role);
      this.roleRow.append(role);

      this.upRow.append(this.makeTurnButton(wheel, 1));
      this.downRow.append(this.makeTurnButton(wheel, -1));

      const drum = el('div', 'drum');
      drum.dataset.wheel = String(wheel);
      drum.style.setProperty('--i', String(wheel));
      const strip = el('div', 'strip');
      const cells = [];
      for (let slot = 0; slot < STRIP_SLOTS; slot += 1) {
        const windowRow = slot - FIRST_WINDOW_SLOT;
        const inWindow = windowRow >= 0 && windowRow < WINDOW_ROWS;
        const cell = el('div', `cell${inWindow ? ' cell-window' : ' cell-back'}`);
        if (inWindow) cell.dataset.row = String(windowRow);
        cells.push(cell);
        strip.append(cell);
      }
      drum.append(strip);
      this.cells.push(cells);
      this.strips.push(strip);
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

  /* ------------------------------------------------------------------ drag */

  /** One cell's height in pixels, read from the live layout. */
  cellHeight() {
    return this.cells[0][FIRST_WINDOW_SLOT].getBoundingClientRect().height || 48;
  }

  /**
   * Dragging a drum moves its strip with the finger, and moves every strip
   * its chains reach by the same amount in the direction of the link. Letting
   * go past the commit threshold turns the wheel; short of it, everything
   * springs back. Pressing without moving just previews.
   */
  attachDrag(drum, wheel) {
    drum.addEventListener('pointerdown', (event) => {
      if (this.drag || event.button !== 0) return;
      this.preview(wheel);
      if (isSeized(this.lock, wheel)) return;
      if (this.handlers.canTurn && !this.handlers.canTurn(wheel)) return;
      drum.setPointerCapture(event.pointerId);
      this.drag = { wheel, pointerId: event.pointerId, startY: event.clientY, dy: 0, active: false };
    });

    drum.addEventListener('pointermove', (event) => {
      const drag = this.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const raw = event.clientY - drag.startY;
      if (!drag.active && Math.abs(raw) < DRAG_SLOP) return;
      drag.active = true;
      const cell = this.cellHeight();
      drag.dy = Math.max(-cell, Math.min(cell, raw));
      this.setDragOffsets(drag.wheel, drag.dy);
    });

    const release = (event) => {
      const drag = this.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      this.drag = null;
      this.preview(null);
      if (!drag.active) return;

      const cell = this.cellHeight();
      if (event.type !== 'pointercancel' && Math.abs(drag.dy) >= cell * COMMIT_FRACTION) {
        this.commitDrag(drag.wheel, drag.dy < 0 ? 1 : -1, cell);
      } else {
        this.settleDrag(drag.wheel, 0);
      }
    };
    drum.addEventListener('pointerup', release);
    drum.addEventListener('pointercancel', release);

    drum.addEventListener('pointerenter', () => {
      if (!this.drag) this.preview(wheel);
    });
    drum.addEventListener('pointerleave', () => {
      if (!this.drag) this.preview(null);
    });
  }

  /** Wheels that move when `wheel` is driven, each with its direction sign. */
  chainOf(wheel) {
    const out = [];
    for (let c = 0; c < WHEEL_COUNT; c += 1) {
      if (this.matrix[wheel][c] !== 0) out.push({ wheel: c, sign: this.matrix[wheel][c] });
    }
    return out;
  }

  setDragOffsets(wheel, dy) {
    for (const { wheel: c, sign } of this.chainOf(wheel)) {
      this.strips[c].style.setProperty('--drag', `${sign * dy}px`);
    }
  }

  /** Ease every strip in the chain to a drag offset and resolve when settled. */
  settleDrag(wheel, dy) {
    const strips = this.chainOf(wheel).map(({ wheel: c }) => this.strips[c]);
    return this.settle(strips, (strip) => {
      const sign = this.matrix[wheel][Number(strip.parentElement.dataset.wheel)];
      strip.style.setProperty('--drag', `${sign * dy}px`);
    });
  }

  /**
   * Finish a drag as a real turn: glide the strips the rest of the way, then
   * let the game apply the move. The re-render lands the new letters exactly
   * where the strips have come to rest, so snapping the offsets back to zero
   * in the same frame is invisible.
   */
  async commitDrag(wheel, dir, cell) {
    await this.settleDrag(wheel, -dir * cell);
    const accepted = this.handlers.onTurn(wheel, dir, { silent: true });
    if (accepted) {
      for (const { wheel: c } of this.chainOf(wheel)) this.strips[c].style.setProperty('--drag', '0px');
    } else {
      await this.settleDrag(wheel, 0);
    }
  }

  /**
   * Apply `mutate` to each strip under a transition, resolving on
   * transitionend or after a deadline — reduced-motion users get no
   * transition and must not be left waiting.
   */
  settle(strips, mutate) {
    return new Promise((resolve) => {
      let pending = strips.length;
      if (pending === 0) {
        resolve();
        return;
      }
      const finish = () => {
        pending = 0;
        for (const strip of strips) strip.classList.remove('settling');
        resolve();
      };
      const timer = setTimeout(finish, SETTLE_MS);
      for (const strip of strips) {
        strip.classList.add('settling');
        strip.addEventListener(
          'transitionend',
          () => {
            pending -= 1;
            if (pending === 0) {
              clearTimeout(timer);
              finish();
            }
          },
          { once: true },
        );
        mutate(strip);
      }
    });
  }

  /* ------------------------------------------------------------------ setup */

  /** @param {import('./engine.js').Lock} lock */
  setLock(lock, { hideRings = false } = {}) {
    this.lock = lock;
    this.matrix = moveMatrix(lock);
    this.hideRings = hideRings;
    this.drag = null;
    this.preview(null);
    this.clearHint();
    for (const strip of this.strips) strip.style.setProperty('--drag', '0px');

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

  /* -------------------------------------------------------------- rendering */

  /**
   * @param {number[]} offsets
   * @param {{ word: string, required: boolean, valid: boolean }[]} rowStatus
   */
  render(offsets, rowStatus) {
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      for (let slot = 0; slot < STRIP_SLOTS; slot += 1) {
        const ringIndex = mod(offsets[wheel] + slot + SLOT_OFFSET, RING_SIZE);
        const cell = this.cells[wheel][slot];
        const inWindow = cell.dataset.row != null;
        cell.textContent = this.hideRings && !inWindow ? '' : this.lock.rings[wheel][ringIndex];
        if (inWindow) {
          const status = rowStatus[Number(cell.dataset.row)];
          // Rows the mode does not care about step back; solved rows light up.
          cell.classList.toggle('cell-optional', !status.required);
          cell.classList.toggle('cell-valid', status.required && status.valid);
        }
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

  /**
   * Glide the wheels a turn moved from where they were to where they are.
   * The letters have already been re-rendered in their new slots, so each
   * strip starts one cell back and eases home.
   * @param {{ wheel: number, delta: -1 | 0 | 1 }[]} deltas
   */
  animate(deltas) {
    const cell = this.cellHeight();
    const moved = deltas.filter((entry) => entry.delta !== 0);
    const strips = moved.map((entry) => this.strips[entry.wheel]);
    for (const { wheel, delta } of moved) {
      const strip = this.strips[wheel];
      strip.classList.remove('settling');
      strip.style.setProperty('--drag', `${delta * cell}px`);
    }
    // Force a reflow so the start position is committed before the transition.
    void this.drums.offsetWidth;
    this.settle(strips, (strip) => strip.style.setProperty('--drag', '0px'));
  }

  /** The window flashes and the letters take a bow. */
  celebrate() {
    this.root.classList.remove('unlocked');
    void this.root.offsetWidth;
    this.root.classList.add('unlocked');
    setTimeout(() => this.root.classList.remove('unlocked'), 1400);
  }

  /** Point at the next move: the arrow to press pulses until the player moves. */
  showHint(wheel, dir) {
    this.clearHint();
    const row = dir > 0 ? this.upRow : this.downRow;
    row.children[wheel].classList.add('hinted');
    this.drumNodes[wheel].classList.add('hinted');
  }

  clearHint() {
    for (const node of this.root.querySelectorAll('.hinted')) node.classList.remove('hinted');
  }

  /** Keyboard focus ring for the wheel the arrow keys will turn. */
  setSelected(wheel) {
    this.drumNodes.forEach((drum, index) => drum.classList.toggle('selected', index === wheel));
  }

  /* ---------------------------------------------------------------- preview */

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

  /* ----------------------------------------------------------------- chains */

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
