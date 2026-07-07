import { expect, test } from '@playwright/test';
import { getQueueState, gotoApp, startSession, unlock } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await unlock(page);
  await startSession(page);
});

test('(a) one physical tap (pointerdown+pointerup+click) records exactly one event (AC-05)', async ({
  page
}) => {
  // A real click produces the full pointerdown/pointerup/click sequence.
  await page.getByTestId('tile-mr-parking').click();
  const state = await getQueueState(page);
  expect(state.events).toHaveLength(1);
  expect(state.events[0].provider_id).toBe('mr-parking');
});

test('(b) 20 rapid full sequences -> exactly 20 events (AC-05)', async ({ page }) => {
  const tile = page.getByTestId('tile-mr-parking');
  for (let i = 0; i < 20; i++) {
    await tile.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true, bubbles: true });
    await tile.dispatchEvent('pointerup', { pointerId: 1, bubbles: true });
    await tile.dispatchEvent('click', { bubbles: true });
  }
  const state = await getQueueState(page);
  expect(state.events).toHaveLength(20);
});

test('(c) second pointerdown on the SAME tile while held is ignored (AC-05)', async ({ page }) => {
  const tile = page.getByTestId('tile-mr-parking');
  await tile.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true, bubbles: true });
  await tile.dispatchEvent('pointerdown', { pointerId: 2, isPrimary: false, bubbles: true });
  await tile.dispatchEvent('pointerup', { pointerId: 2, bubbles: true });
  await tile.dispatchEvent('pointerup', { pointerId: 1, bubbles: true });
  const state = await getQueueState(page);
  expect(state.events).toHaveLength(1);
  await expect(page.getByTestId('count-mr-parking')).toHaveText('1');
});

test('(e) a scroll-drag starting on a tile (pointercancel) records ZERO events (POL-01/AC-05)', async ({
  page
}) => {
  const tile = page.getByTestId('tile-mr-parking');
  // Touch-drag-to-scroll that begins on the tile: pointerdown, a large move,
  // then the browser takes over scrolling and fires pointercancel.
  await tile.dispatchEvent('pointerdown', {
    pointerId: 1,
    isPrimary: true,
    bubbles: true,
    clientX: 100,
    clientY: 100
  });
  await tile.dispatchEvent('pointermove', { pointerId: 1, bubbles: true, clientX: 100, clientY: 300 });
  await tile.dispatchEvent('pointercancel', { pointerId: 1, bubbles: true });
  const state = await getQueueState(page);
  expect(state.events).toHaveLength(0);
  await expect(page.getByTestId('count-mr-parking')).toHaveText('0');
});

test('(f) a large-move drag released off-slop (pointerup) records ZERO events (POL-01/AC-05)', async ({
  page
}) => {
  const tile = page.getByTestId('tile-mr-parking');
  await tile.dispatchEvent('pointerdown', {
    pointerId: 1,
    isPrimary: true,
    bubbles: true,
    clientX: 100,
    clientY: 100
  });
  await tile.dispatchEvent('pointermove', { pointerId: 1, bubbles: true, clientX: 100, clientY: 260 });
  await tile.dispatchEvent('pointerup', { pointerId: 1, bubbles: true, clientX: 100, clientY: 260 });
  const state = await getQueueState(page);
  expect(state.events).toHaveLength(0);
});

test('(d) simultaneous pointers on two DIFFERENT tiles record one event each (AC-05)', async ({
  page
}) => {
  const a = page.getByTestId('tile-mr-parking');
  const b = page.getByTestId('tile-safe-car');
  await a.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true, bubbles: true });
  await b.dispatchEvent('pointerdown', { pointerId: 2, isPrimary: false, bubbles: true });
  await a.dispatchEvent('pointerup', { pointerId: 1, bubbles: true });
  await b.dispatchEvent('pointerup', { pointerId: 2, bubbles: true });
  const state = await getQueueState(page);
  expect(state.events).toHaveLength(2);
  const providers = state.events.map((e) => e.provider_id).sort();
  expect(providers).toEqual(['mr-parking', 'safe-car']);
});
