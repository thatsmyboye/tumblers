#!/usr/bin/env node
/**
 * End-to-end check of the actual page: loads it in Chromium, drags and taps
 * wheels, undoes, hints, resets, solves the daily's two legs, reloads to
 * check the save, and opens a shared lock link.
 *
 * Not part of `npm test` because it needs Playwright, which the game itself
 * does not depend on:
 *
 *   npm install --no-save playwright && node test/browser-smoke.mjs
 */

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = Number(process.env.PORT ?? 8731);
const ORIGIN = `http://localhost:${PORT}`;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('This check needs Playwright: npm install --no-save playwright');
  process.exit(1);
}

const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT)], { stdio: 'ignore' });
const stop = (code) => {
  server.kill();
  process.exit(code);
};

const problems = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) problems.push(label);
};

try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(ORIGIN)).ok) break;
    } catch {
      await delay(100);
    }
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));

  const ready = () => page.waitForFunction(() => window.tumblers?.state?.game, null, { timeout: 20000 });
  const snapshot = () =>
    page.evaluate(() => {
      const { state } = window.tumblers;
      return {
        moves: state.game.moves,
        undos: state.game.undos,
        hints: state.game.hints,
        offsets: state.game.offsets.slice(),
        par: state.par,
        finished: state.finished,
        phase: state.phase,
        source: state.source,
        shownMoves: Number(document.getElementById('stat-moves').textContent),
      };
    });

  await page.goto(ORIGIN, { waitUntil: 'networkidle' });
  await ready();

  // First visit: the how-to-play card opens by itself and stays away after.
  check('first visit opens the how-to-play card', await page.evaluate(() => document.getElementById('help-dialog').open));
  await page.locator('#help-close').click();
  check('the card is dismissed', await page.evaluate(() => !document.getElementById('help-dialog').open));

  const before = await snapshot();
  check('the daily loads with a par', before.source === 'daily' && before.par > 0);

  // A tap on the arrow turns the wheel and everything its chains drive.
  const drivenByFirst = await page.evaluate(
    () => window.tumblers.state.lock.links.filter((link) => link.from === 0).length,
  );
  await page.locator('.turnrow-up .turn').first().click();
  let now = await snapshot();
  const movedWheels = now.offsets.filter((offset, i) => offset !== before.offsets[i]).length;
  check('a turn counts one move', now.moves === 1 && now.shownMoves === 1);
  check('linked wheels turn together', movedWheels === 1 + drivenByFirst, `${movedWheels} wheels moved`);

  await page.locator('#undo').click();
  now = await snapshot();
  check(
    'undo rewinds without costing a move',
    now.moves === 0 && now.undos === 1 && JSON.stringify(now.offsets) === JSON.stringify(before.offsets),
  );

  // Dragging: a short drag springs back, a long one commits a turn.
  const firstFree = await page.evaluate(() => {
    const { lock } = window.tumblers.state;
    return lock.rings.findIndex((_, wheel) => !(lock.seized ?? []).includes(wheel));
  });
  const drum = page.locator('.drum').nth(firstFree);
  const box = await drum.boundingBox();
  const cell = await page.evaluate(() => document.querySelector('.cell-window').getBoundingClientRect().height);
  const dragBy = async (dy) => {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) await page.mouse.move(x, y + (dy * step) / 8);
    await page.mouse.up();
    await delay(260);
  };
  await dragBy(-cell * 0.15);
  now = await snapshot();
  check('a short drag springs back without a move', now.moves === 0);
  await dragBy(-cell * 0.8);
  now = await snapshot();
  check('a long drag upward commits a turn up', now.moves === 1 && now.offsets[firstFree] === (before.offsets[firstFree] + 1) % 6);
  const restingDrag = await page.evaluate(() =>
    [...document.querySelectorAll('.strip')].map((strip) => strip.style.getPropertyValue('--drag')),
  );
  check('strips rest at zero after the drag', restingDrag.every((value) => value === '0px' || value === ''), restingDrag.join(','));

  // The save survives a reload.
  await page.reload({ waitUntil: 'networkidle' });
  await ready();
  const restored = await snapshot();
  check(
    'progress survives a reload',
    restored.moves === 1 && restored.undos === 1 && JSON.stringify(restored.offsets) === JSON.stringify(now.offsets),
    `moves ${restored.moves}, undos ${restored.undos}`,
  );
  check('the how-to-play card does not reopen', await page.evaluate(() => !document.getElementById('help-dialog').open));

  // Reset asks twice when there is something to lose.
  await page.locator('#reset').click();
  const armed = await page.locator('#reset').textContent();
  now = await snapshot();
  check('reset arms first', armed === 'Tap again' && now.moves === 1);
  await page.locator('#reset').click();
  now = await snapshot();
  check('a second tap resets', now.moves === 0 && JSON.stringify(now.offsets) === JSON.stringify(before.offsets));

  // Hints: recorded once per position, pointing at a real optimal move. Taken
  // after the reset, because a reset starts the lock over — hints included.
  await page.locator('#hint').click();
  const hinted = await page.evaluate(() => document.querySelector('.turn.hinted')?.getAttribute('aria-label') ?? null);
  await page.locator('#hint').click();
  now = await snapshot();
  check('a hint pulses an arrow and is counted once per position', hinted != null && now.hints === 1, hinted ?? 'no arrow');
  const hintNote = await page.locator('#hint-note').textContent();
  check('the hint says which wheel and how far to go', /Turn wheel \d [▲▼]/.test(hintNote), hintNote);

  // Play the optimal line for whichever leg is in progress.
  const solveLeg = async () => {
    const path = await page.evaluate(async () => {
      const { createSearch, goalMask, search } = await import('/src/solver.js');
      const { state } = window.tumblers;
      return search(createSearch(state.lock), goalMask(state.lock, state.game.mode, state.words.valid), state.game.offsets).path;
    });
    for (const { wheel, dir } of path) {
      await page.locator(`.turnrow-${dir > 0 ? 'up' : 'down'} .turn`).nth(wheel).click();
    }
    await page.waitForSelector('#result:not([hidden])', { timeout: 10000 });
  };

  await solveLeg();
  now = await snapshot();
  check('the combination leg finishes and locks input', now.finished && now.phase === 'combination');
  const starsLeg1 = await page.locator('#result-stars').textContent();
  check('a hinted leg is capped at two stars', starsLeg1.trim() === '⭐⭐', starsLeg1);
  await page.locator('.turnrow-up .turn').first().click();
  now = await snapshot();
  check('turns are refused until the player continues', now.moves === (await snapshot()).moves && now.finished);

  await page.locator('#continue').click();
  now = await snapshot();
  check('the second leg starts its own move count', now.shownMoves === 0 && now.phase === 'full');
  await solveLeg();
  const share = await page.locator('#share-text').textContent();
  check(
    'the daily shares both legs, hints and the bonus star',
    /Combination \d+ \/ par \d+/.test(share) && share.includes('🌟') && share.includes('Hints 1 🔍'),
    share.split('\n').join(' | '),
  );
  const answer = await page.locator('#result-answer').textContent();
  check('the answer is revealed once the lock is open', /The lock was [A-Z]{5} · [A-Z]{5} · [A-Z]{5}/.test(answer), answer);

  await page.reload({ waitUntil: 'networkidle' });
  await ready();
  check('a finished daily shows its result again after a reload', await page.evaluate(() => !document.getElementById('result').hidden));

  // Practice mode runs the generator in the browser; a lock can be sent as a link.
  await page.locator('.tab[data-mode="full"]').click();
  await page.waitForFunction(() => window.tumblers.state.source === 'practice', null, { timeout: 30000 });
  now = await snapshot();
  check('practice mode cuts a fresh lock', now.par > 0 && !now.finished);
  const link = await page.evaluate(async () => {
    const { encodeLock } = await import('/src/lockcode.js');
    const { state } = window.tumblers;
    return `${location.origin}/?lock=${encodeLock(state.lock, state.game.mode)}`;
  });
  const practiceOffsets = now.offsets;
  await page.goto(link, { waitUntil: 'networkidle' });
  await ready();
  now = await snapshot();
  const subtitle = await page.locator('#subtitle').textContent();
  check(
    'a shared lock link opens the same lock',
    now.source === 'shared' && JSON.stringify(now.offsets) === JSON.stringify(practiceOffsets) && subtitle.startsWith('Shared lock'),
    subtitle,
  );
  await page.goto(`${ORIGIN}/?lock=garbage`, { waitUntil: 'networkidle' });
  await ready();
  now = await snapshot();
  check('a bad lock link falls back to the daily', now.source === 'daily');

  await browser.close();

  if (problems.length) {
    console.error('\nProblems:', problems);
    stop(1);
  }
  console.log('\nAll browser checks passed.');
  stop(0);
} catch (error) {
  console.error(error);
  stop(1);
}
