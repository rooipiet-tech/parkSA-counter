import { expect, test } from '@playwright/test';
import {
  flush,
  getQueueState,
  getServerState,
  gotoApp,
  startSession,
  tapTile,
  unlock
} from './helpers.ts';

test('undo tombstones unsynced and synced events, never deletes, and excludes them from aggregates (AC-09)', async ({
  page
}) => {
  await gotoApp(page);
  await unlock(page);
  await startSession(page);

  await tapTile(page, 'mr-parking', 3);
  await expect(page.getByTestId('count-mr-parking-dropoff')).toHaveText('3');

  // Undo an UNSYNCED event.
  await page.getByTestId('undo-btn').click();
  await expect(page.getByTestId('count-mr-parking-dropoff')).toHaveText('2');
  let state = await getQueueState(page);
  expect(state.events).toHaveLength(3); // row still present
  expect(state.events.filter((e) => e.tombstoned)).toHaveLength(1);

  // Sync everything, then undo a SYNCED event.
  await flush(page);
  state = await getQueueState(page);
  expect(state.events.every((e) => e.synced)).toBe(true);
  await page.getByTestId('undo-btn').click();
  await expect(page.getByTestId('count-mr-parking-dropoff')).toHaveText('1');
  await flush(page); // tombstone itself syncs idempotently

  const server = await getServerState(page);
  const mine = server.events.filter((e) => e.provider_id === 'mr-parking');
  expect(mine).toHaveLength(3); // original rows all retained
  expect(mine.filter((e) => e.tombstoned)).toHaveLength(2); // tombstone markers present
  expect(server.tombstones).toHaveLength(2);

  // Dashboard (default range = today) excludes tombstoned events.
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('dash-total-mr-parking')).toHaveText('1');
});

test('undo with nothing left to undo is a safe no-op (AC-09)', async ({ page }) => {
  await gotoApp(page);
  await unlock(page);
  await startSession(page);

  await page.getByTestId('undo-btn').click(); // empty session: nothing happens
  let state = await getQueueState(page);
  expect(state.events).toHaveLength(0);
  expect(state.pendingCount).toBe(0);

  await tapTile(page, 'safe-car', 1);
  await page.getByTestId('undo-btn').click();
  await expect(page.getByTestId('count-safe-car-dropoff')).toHaveText('0');
  await page.getByTestId('undo-btn').click(); // everything tombstoned already
  state = await getQueueState(page);
  expect(state.events).toHaveLength(1);
  expect(state.events.filter((e) => e.tombstoned)).toHaveLength(1);
  // Still fully operational afterwards.
  await tapTile(page, 'safe-car', 1);
  await expect(page.getByTestId('count-safe-car-dropoff')).toHaveText('1');
});
