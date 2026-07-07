import { expect, test } from '@playwright/test';
import {
  goOnlineAndSync,
  gotoApp,
  setForceOffline,
  startSession,
  tapTile,
  unlock
} from './helpers.ts';

test('unsynced badge is always visible on the counting screen, tracks the queue, reads 0 after sync (AC-15)', async ({
  page
}) => {
  await gotoApp(page);
  await unlock(page);
  await startSession(page);

  const badge = page.getByTestId('unsynced-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('0');

  await setForceOffline(page, true);
  await tapTile(page, 'mr-parking', 2);
  await expect(badge).toHaveText('2');
  await tapTile(page, 'eazypark', 3);
  await expect(badge).toHaveText('5'); // equals queue length while offline

  await goOnlineAndSync(page);
  await expect(badge).toHaveText('0', { timeout: 20_000 });
});
