import { expect, test } from '@playwright/test';
import { gotoApp, longPressSettingsOpen, startSession, unlock, waitForReady, PIN } from './helpers.ts';

test('PIN gates the app; wrong PIN stays blocked; unlock persists across reload (AC-11)', async ({
  page
}) => {
  await gotoApp(page);
  await expect(page.getByTestId('pin-input')).toBeVisible();
  await expect(page.getByTestId('session-start')).toHaveCount(0); // counting blocked

  await page.getByTestId('pin-input').fill('0000');
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('pin-input')).toBeVisible(); // still blocked
  await expect(page.getByTestId('session-start')).toHaveCount(0);

  await page.getByTestId('pin-input').fill(PIN);
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('session-start')).toBeVisible();

  // Spec-mandated reload in the same context: once-per-device unlock, no re-prompt.
  await page.reload();
  await waitForReady(page);
  await expect(page.getByTestId('pin-input')).toHaveCount(0);
  await expect(page.getByTestId('session-start')).toBeVisible();
});

test('settings need a deliberate >=500ms long-press, not a stray tap (AC-11)', async ({ page }) => {
  await gotoApp(page);
  await unlock(page);
  await startSession(page);

  // A plain click does NOT open settings.
  await page.getByTestId('settings-open').click();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('provider-add')).toHaveCount(0);
  await expect(page.getByTestId('undo-btn')).toBeVisible(); // still counting

  // A short press (<500ms) does not open settings either.
  const btn = page.getByTestId('settings-open');
  await btn.dispatchEvent('pointerdown', { pointerId: 5, isPrimary: true, bubbles: true });
  await page.waitForTimeout(200);
  await btn.dispatchEvent('pointerup', { pointerId: 5, bubbles: true });
  await page.waitForTimeout(500);
  await expect(page.getByTestId('provider-add')).toHaveCount(0);

  // The documented long-press does.
  await longPressSettingsOpen(page);
  await expect(page.getByTestId('provider-add')).toBeVisible();
});

test('settings honor the same PIN gate (AC-11)', async ({ page }) => {
  await gotoApp(page);
  // Try to deep-link into settings while locked: PIN screen still shows.
  await page.evaluate(() => {
    location.hash = '#/settings';
  });
  await expect(page.getByTestId('pin-input')).toBeVisible();
  await expect(page.getByTestId('provider-add')).toHaveCount(0);

  await unlock(page);
  // After unlock the hash view resolves; settings content is reachable now.
  await expect(page.getByTestId('provider-add')).toBeVisible();
});
