import { expect, test } from '@playwright/test';
import { endSession, gotoApp, startSession, tapTile, unlock } from './helpers.ts';

test('tap-to-visual-feedback stays under 200ms over 10 taps (AC-04)', async ({ page }) => {
  await gotoApp(page);
  await unlock(page);
  await startSession(page);

  const deltas = await page.evaluate(async () => {
    const tile = document.querySelector('[data-testid=tile-mr-parking]')!;
    const out: number[] = [];
    for (let i = 0; i < 10; i++) {
      const acknowledged = new Promise<number>((resolve) => {
        const mo = new MutationObserver(() => {
          mo.disconnect();
          resolve(performance.now());
        });
        mo.observe(tile, { attributes: true, childList: true, subtree: true, characterData: true });
      });
      const t0 = performance.now();
      tile.dispatchEvent(
        new PointerEvent('pointerdown', { pointerId: i + 1, isPrimary: true, bubbles: true })
      );
      const t1 = await acknowledged;
      tile.dispatchEvent(new PointerEvent('pointerup', { pointerId: i + 1, bubbles: true }));
      await new Promise((r) => setTimeout(r, 25));
      out.push(t1 - t0);
    }
    return out;
  });

  expect(deltas).toHaveLength(10);
  for (const d of deltas) expect(d).toBeLessThan(200);
});

test('tiles show running per-session counts and reset to 0 on a new session (AC-04)', async ({
  page
}) => {
  await gotoApp(page);
  await unlock(page);
  await startSession(page);

  await tapTile(page, 'mr-parking', 3);
  await tapTile(page, 'safe-car', 1);
  await expect(page.getByTestId('count-mr-parking')).toHaveText('3');
  await expect(page.getByTestId('count-safe-car')).toHaveText('1');

  await endSession(page);
  await expect(page.getByTestId('session-start')).toBeVisible();
  await startSession(page, 'OBS-2');
  await expect(page.getByTestId('count-mr-parking')).toHaveText('0');
  await expect(page.getByTestId('count-safe-car')).toHaveText('0');
});
