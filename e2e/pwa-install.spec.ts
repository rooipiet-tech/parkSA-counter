import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers.ts';

test('manifest is valid and a service worker controls the page after reload (AC-02)', async ({ page }) => {
  await gotoApp(page);

  // (a) manifest link resolves to JSON with the required fields.
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  expect(href).toBeTruthy();
  const res = await page.request.get(new URL(href!, page.url()).toString());
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.name).toBeTruthy();
  expect(manifest.start_url).toBeTruthy();
  expect(['standalone', 'fullscreen']).toContain(manifest.display);
  const sizes = (manifest.icons ?? []).map((i: { sizes: string }) => i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');

  // (b) SW registers; after a reload (spec-mandated, F11) a controller exists.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
});

test('insecure contexts render a blocking warning (AC-02)', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { get: () => false, configurable: true });
  });
  await gotoApp(page);
  await expect(page.getByTestId('insecure-context-warning')).toBeVisible();
  // The app does not boot: no PIN screen, no tiles.
  await expect(page.getByTestId('pin-input')).toHaveCount(0);
});
