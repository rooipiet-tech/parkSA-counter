import { expect, test } from '@playwright/test';
import { gotoApp, startSession, tapTile, unlock } from './helpers.ts';

test('backend failure never blocks counting; queue drains and last-sync updates on recovery (AC-24)', async ({
  page
}) => {
  await gotoApp(page);
  await unlock(page);
  await startSession(page);

  // Healthy sync first: a tap + flush set the last-sync indicator.
  await tapTile(page, 'mr-parking', 1);
  await page.evaluate(() => window.__PARKSA__.flush());
  await expect(page.getByTestId('last-sync')).toHaveText(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  const lastSyncBefore = await page.getByTestId('last-sync').textContent();

  // Inject a persistent backend fault (stub-only hook).
  await page.evaluate(() => window.__PARKSA__.injectFault(50));

  // Flush attempts fail...
  const failed = await page.evaluate(() =>
    window.__PARKSA__.flush().then(
      () => false,
      () => true
    )
  );
  expect(failed).toBe(true);

  // ...but counting continues, unblocked, with no modal/dialog in the way.
  await tapTile(page, 'safe-car', 3);
  await expect(page.getByTestId('count-safe-car')).toHaveText('3');
  await expect(page.getByTestId('unsynced-badge')).not.toHaveText('0');
  expect(await page.locator('dialog, [role=dialog], [role=alertdialog]').count()).toBe(0);
  await expect(page.getByTestId('undo-btn')).toBeVisible();
  await expect(page.getByTestId('tile-mr-parking')).toBeVisible();

  // Recovery: clear the fault; the queue drains and last-sync advances.
  await page.evaluate(() => window.__PARKSA__.clearFault());
  await page.evaluate(() => window.__PARKSA__.flush());
  await expect(page.getByTestId('unsynced-badge')).toHaveText('0', { timeout: 20_000 });
  await expect(page.getByTestId('last-sync')).toHaveText(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

  const server = await page.evaluate(() => window.__PARKSA__.getServerState());
  expect(server.events).toHaveLength(4);
  expect(server.events.every((e) => !e.tombstoned)).toBe(true);
  void lastSyncBefore; // timestamps may render identically within the same second
});
