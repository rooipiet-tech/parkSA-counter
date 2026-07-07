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
