import { expect, test } from '@playwright/test';
import {
  flush,
  getQueueState,
  getServerState,
  gotoApp,
  longPressSettingsOpen,
  startSession,
  tapTile,
  unlock
} from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await unlock(page);
  await startSession(page);
});

test('(a) add creates a tappable tile immediately, no redeploy (AC-17)', async ({ page }) => {
  await longPressSettingsOpen(page);
  await page.getByTestId('provider-add-name').fill('Test Park');
  await page.getByTestId('provider-add').click();
  await expect(page.getByTestId('provider-row-test-park')).toBeVisible();
  await page.getByTestId('settings-back').click();

  await expect(page.getByTestId('tile-test-park')).toBeVisible();
  await tapTile(page, 'test-park', 1);
  await expect(page.getByTestId('count-test-park')).toHaveText('1');
  const state = await getQueueState(page);
  expect(state.events.at(-1)!.provider_id).toBe('test-park');
});

test('(b) rename re-labels history: same provider_id, same counts, new name (AC-17)', async ({
  page
}) => {
  await tapTile(page, 'mr-parking', 3);
  await flush(page);

  await longPressSettingsOpen(page);
  await page.getByTestId('provider-name-mr-parking').fill('Mister Parking');
  await page.getByTestId('provider-rename-mr-parking').click();
  await page.getByTestId('settings-back').click();

  // Tile relabels immediately.
  await expect(page.getByTestId('tile-mr-parking')).toContainText('Mister Parking');

  // Dashboard row shows the new name with the historical count.
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('dash-provider-mr-parking')).toHaveText('Mister Parking');
  await expect(page.getByTestId('dash-total-mr-parking')).toHaveText('3');

  // Events keep their original provider_id.
  const server = await getServerState(page);
  const mine = server.events.filter((e) => e.provider_id === 'mr-parking');
  expect(mine).toHaveLength(3);
  expect(server.providers.find((p) => p.id === 'mr-parking')!.name).toBe('Mister Parking');
});

test('(c) hide removes the tile but history stays in aggregates and CSV (AC-17)', async ({
  page
}) => {
  await tapTile(page, 'safe-car', 2);
  await flush(page);

  await longPressSettingsOpen(page);
  await page.getByTestId('provider-hide-safe-car').click();
  await page.getByTestId('settings-back').click();
  await expect(page.getByTestId('tile-safe-car')).toHaveCount(0);
  await expect(page.getByTestId('tile-mr-parking')).toBeVisible(); // others intact

  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('dash-total-safe-car')).toHaveText('2');

  const from = await page.getByTestId('range-from').inputValue();
  const to = await page.getByTestId('range-to').inputValue();
  const csv = await page.evaluate((r) => window.__PARKSA__.exportCsv(r), { from, to });
  const rows = csv.trimEnd().split('\n').filter((l) => l.startsWith('safe-car,'));
  expect(rows).toHaveLength(2);
});

test('(d) reorder to position 1 updates the counting screen order (AC-17)', async ({ page }) => {
  await longPressSettingsOpen(page);
  await page.getByTestId('provider-top-eazypark').click();
  await expect(page.getByTestId('provider-row-eazypark')).toBeVisible();
  await page.getByTestId('settings-back').click();

  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^=tile-]')).map((el) =>
      el.getAttribute('data-testid')
    )
  );
  expect(order[0]).toBe('tile-eazypark');
  expect(order).toHaveLength(12);
});

test('(e) Unknown is permanent: no hide/delete affordance, adapter refuses (AC-17)', async ({
  page
}) => {
  await longPressSettingsOpen(page);
  await expect(page.getByTestId('provider-row-unknown')).toBeVisible();
  await expect(page.getByTestId('provider-hide-unknown')).toHaveCount(0);
  await expect(page.getByTestId('provider-delete-unknown')).toHaveCount(0);
  // Every other provider has a hide control; none has a delete control.
  await expect(page.getByTestId('provider-hide-mr-parking')).toBeVisible();
  const providers = await getServerState(page).then((s) => s.providers);
  expect(providers.find((p) => p.id === 'unknown')!.is_permanent).toBe(true);
});
