import { expect, test } from '@playwright/test';
import { gotoApp, relaunch, setForceOffline, startSession, tapTile, unlock } from './helpers.ts';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

test.use({ userAgent: IPHONE_UA });

test('navigator.storage.persist() is requested on first load (AC-16)', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __persistCalled: boolean };
    w.__persistCalled = false;
    if (navigator.storage && navigator.storage.persist) {
      const original = navigator.storage.persist.bind(navigator.storage);
      navigator.storage.persist = () => {
        w.__persistCalled = true;
        return original();
      };
    }
  });
  await gotoApp(page);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __persistCalled: boolean }).__persistCalled))
    .toBe(true);
});

test('iPhone UA outside standalone shows the install hint (AC-16)', async ({ page }) => {
  await gotoApp(page);
  await expect(page.getByTestId('ios-install-hint')).toBeVisible();
  await expect(page.getByTestId('ios-install-hint')).toContainText(/home screen/i);
});

test('standalone display-mode hides the install hint (AC-16)', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = ((query: string) =>
      query.includes('display-mode: standalone')
        ? ({ matches: true, media: query } as MediaQueryList)
        : original(query)) as typeof window.matchMedia;
    Object.defineProperty(navigator, 'standalone', { get: () => true, configurable: true });
  });
  await gotoApp(page);
  await unlock(page); // app fully renders; hint must still be absent
  await expect(page.getByTestId('ios-install-hint')).toHaveCount(0);
});

test('relaunch with unsynced events shows a visible nag banner (AC-16)', async ({ page, context }) => {
  await gotoApp(page);
  await unlock(page);
  await startSession(page);
  await setForceOffline(page, true);
  await tapTile(page, 'mr-parking', 2);
  await expect(page.getByTestId('unsynced-badge')).toHaveText('2');

  // Spec-mandated relaunch: a second page over the same storage.
  const page2 = await relaunch(context);
  await expect(page2.getByTestId('unsynced-banner')).toBeVisible();
  await expect(page2.getByTestId('unsynced-badge')).toHaveText('2');
  await page2.close();
});
