import { expect, test } from '@playwright/test';
import { todaySast } from './helpers.ts';

/**
 * Full golden path driven EXCLUSIVELY through [data-testid=...] selectors and
 * the window.__PARKSA__ agent API — no text or CSS-class selectors (AC-21).
 */
test('an agent can drive the entire app headlessly (AC-21)', async ({ page }) => {
  // The one page.goto of this test (F9): fresh state.
  await page.goto('/?fresh=1');
  await page.waitForFunction(() => window.__PARKSA__ !== undefined);

  // 1. Unlock via PIN.
  await page.getByTestId('pin-input').fill('1234');
  await page.getByTestId('pin-submit').click();

  // 2. Start a session.
  await page.getByTestId('observer-input').fill('AGENT-1');
  await page.getByTestId('session-start').click();
  await expect(page.getByTestId('undo-btn')).toBeVisible();

  // 3. Tap online (drop-off half).
  const tile = page.getByTestId('tile-mr-parking-dropoff');
  for (let i = 0; i < 2; i++) {
    await tile.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true, bubbles: true });
    await tile.dispatchEvent('pointerup', { pointerId: 1, bubbles: true });
  }
  await expect(page.getByTestId('count-mr-parking-dropoff')).toHaveText('2');

  // 4. Inspect the queue.
  let queue = await page.evaluate(() => window.__PARKSA__.getQueueState());
  expect(queue.events).toHaveLength(2);
  expect(queue.events.every((e) => e.synced_offline === false)).toBe(true);

  // 5. Force offline and tap again — this time the PICK-UP half.
  await page.evaluate(() => window.__PARKSA__.setForceOffline(true));
  const tile2 = page.getByTestId('tile-safe-car-pickup');
  await tile2.dispatchEvent('pointerdown', { pointerId: 2, isPrimary: true, bubbles: true });
  await tile2.dispatchEvent('pointerup', { pointerId: 2, bubbles: true });
  queue = await page.evaluate(() => window.__PARKSA__.getQueueState());
  expect(queue.events).toHaveLength(3);
  expect(queue.events.at(-1)!.synced_offline).toBe(true);
  expect(queue.events.at(-1)!.direction).toBe('pickup'); // direction carried in queue state (AD-7)
  expect(queue.pendingCount).toBeGreaterThan(0);

  // 6. Undo the offline tap, go back online, flush.
  await page.getByTestId('undo-btn').click();
  await page.evaluate(() => window.__PARKSA__.setForceOffline(false));
  await page.evaluate(() => window.__PARKSA__.flush());

  // 7. Verify server state.
  const server = await page.evaluate(() => window.__PARKSA__.getServerState());
  expect(server.events).toHaveLength(3);
  expect(server.events.filter((e) => e.tombstoned)).toHaveLength(1);
  expect(server.sessions).toHaveLength(1);
  expect(server.sessions[0].observer_label).toBe('AGENT-1');
  queue = await page.evaluate(() => window.__PARKSA__.getQueueState());
  expect(queue.pendingCount).toBe(0);
  expect(queue.events.every((e) => e.synced)).toBe(true);

  // 8. Open settings via the deliberate long-press gesture.
  const settingsBtn = page.getByTestId('settings-open');
  await settingsBtn.dispatchEvent('pointerdown', { pointerId: 3, isPrimary: true, bubbles: true });
  await page.waitForTimeout(700);
  await settingsBtn.dispatchEvent('pointerup', { pointerId: 3, bubbles: true });
  await expect(page.getByTestId('provider-add')).toBeVisible();

  // 9. Add a provider.
  await page.getByTestId('provider-add-name').fill('Agent Park');
  await page.getByTestId('provider-add').click();
  await expect(page.getByTestId('provider-row-agent-park')).toBeVisible();
  await page.getByTestId('settings-back').click();
  await expect(page.getByTestId('provider-tile-agent-park')).toBeVisible();

  // 10. Open the dashboard.
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('csv-export')).toBeVisible();
  await expect(page.getByTestId('dash-total-mr-parking')).toHaveText('2');

  // 11. Programmatic CSV over today's range.
  const range = { from: todaySast(), to: todaySast() };
  const csv = await page.evaluate((r) => window.__PARKSA__.exportCsv(r), range);
  const lines = csv.trimEnd().split('\n');
  expect(lines[0].startsWith('provider_id,provider_name,direction,event_id,')).toBe(true);
  expect(lines).toHaveLength(4); // 3 events (one flagged tombstoned)
  expect(lines.filter((l) => l.includes('AGENT-1'))).toHaveLength(3);
  // direction column present with both halves used (drop-off ×2, pick-up ×1).
  const dirIdx = lines[0].split(',').indexOf('direction');
  const dirs = lines.slice(1).map((l) => l.split(',')[dirIdx]).sort();
  expect(dirs).toEqual(['dropoff', 'dropoff', 'pickup']);
});
