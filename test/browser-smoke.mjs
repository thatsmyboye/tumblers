#!/usr/bin/env node
/**
 * End-to-end check of the actual page: loads it in Chromium, turns wheels,
 * undoes, solves the daily's two legs and reads back the share text.
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

try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(ORIGIN)).ok) break;
    } catch {
      await delay(100);
    }
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));

  const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) problems.push(label);
  };

  await page.goto(ORIGIN, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.tumblers?.state?.game, null, { timeout: 20000 });

  const loaded = await page.evaluate(() => {
    const { state } = window.tumblers;
    return { mode: state.mode, rows: state.game.rows(), par: state.par };
  });
  check('the daily loads', loaded.mode === 'daily' && loaded.rows.length === 3 && loaded.par > 0);

  // Turning wheel 1 should move it and every wheel its chains drive.
  const drivenByFirst = await page.evaluate(
    () => window.tumblers.state.lock.links.filter((link) => link.from === 0).length,
  );
  await page.locator('.turnrow-up .turn').first().click();
  const afterTurn = await page.evaluate(() => ({
    moves: Number(document.getElementById('stat-moves').textContent),
    offsets: window.tumblers.state.game.offsets.slice(),
    start: window.tumblers.state.lock.start.slice(),
  }));
  const movedWheels = afterTurn.offsets.filter((offset, i) => offset !== afterTurn.start[i]).length;
  check('a turn counts one move', afterTurn.moves === 1);
  check(
    'linked wheels turn together',
    movedWheels === 1 + drivenByFirst,
    `${movedWheels} wheels moved, ${drivenByFirst} chains on wheel 1`,
  );

  await page.locator('#undo').click();
  const afterUndo = await page.evaluate(() => ({
    moves: Number(document.getElementById('stat-moves').textContent),
    undos: Number(document.getElementById('stat-undos').textContent),
    back: JSON.stringify(window.tumblers.state.game.offsets) === JSON.stringify(window.tumblers.state.lock.start),
  }));
  check('undo rewinds without costing a move', afterUndo.moves === 0 && afterUndo.undos === 1 && afterUndo.back);

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

  await page.locator('#reset').click();
  await solveLeg();
  check('combination leg finishes in par', await page.evaluate(() => document.getElementById('result-stars').textContent === '⭐⭐⭐'));

  await page.locator('#continue').click();
  check('the second leg starts its own move count', (await page.locator('#stat-moves').textContent()) === '0');
  await solveLeg();

  const share = await page.locator('#share-text').textContent();
  check('the daily shares both legs and the bonus star', /Combination \d+ \/ par \d+/.test(share) && share.includes('🌟'), share.split('\n')[0]);

  // Practice mode runs the generator in the browser.
  await page.locator('.tab[data-mode="full"]').click();
  await page.waitForFunction(() => window.tumblers.state.mode === 'full' && !document.getElementById('practice').hidden, null, { timeout: 30000 });
  check('practice mode cuts a fresh lock', await page.evaluate(() => window.tumblers.state.par > 0));

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
