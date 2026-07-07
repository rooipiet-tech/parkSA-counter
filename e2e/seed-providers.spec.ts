import { expect, test } from '@playwright/test';
import { gotoApp, startSession, unlock } from './helpers.ts';
import { SEED_PROVIDERS } from '../src/seed/providers.ts';

test('counting screen renders exactly the 12 seed tiles, in order, with stable ids (AC-03)', async ({
  page
}) => {
  await gotoApp(page);
  await unlock(page);
  await startSession(page);

  const tiles = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^=provider-tile-]')).map((el) => ({
      testid: el.getAttribute('data-testid'),
      name: el.querySelector('.tile-name')?.textContent ?? '',
      // Every provider tile splits into a drop-off + pick-up half (AD-2).
      halves: Array.from(el.querySelectorAll('[data-testid^=tile-]')).map((h) =>
        h.getAttribute('data-testid')
      )
    }))
  );

  expect(tiles).toHaveLength(12);
  tiles.forEach((tile, i) => {
    expect(tile.testid).toBe(`provider-tile-${SEED_PROVIDERS[i].id}`);
    expect(tile.name).toBe(SEED_PROVIDERS[i].name);
    expect(tile.halves).toEqual([
      `tile-${SEED_PROVIDERS[i].id}-dropoff`,
      `tile-${SEED_PROVIDERS[i].id}-pickup`
    ]);
  });
  expect(tiles[11].name).toBe('Unknown');

  // Server-side providers agree (same ids), Unknown flagged permanent.
  const providers = await page.evaluate(() =>
    window.__PARKSA__.getServerState().then((s) => s.providers)
  );
  expect(providers.map((p: { id: string }) => p.id)).toEqual(SEED_PROVIDERS.map((p) => p.id));
  expect(providers[11].is_permanent).toBe(true);
});

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

test.describe('all 12 tiles / 24 tappable zones fit a 390x844 iPhone viewport with no scrolling (POL-02/AC-05/AD-2)', () => {
  test.use({ viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA });

  test('every drop-off/pick-up half box is inside the viewport and >=44px tall', async ({ page }) => {
    await gotoApp(page);
    await unlock(page);
    await startSession(page);

    // The 24 tappable half-zones (2 per provider tile). Exclude the provider
    // wrapper (data-testid `provider-tile-...`) — only the halves are targets.
    const boxes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid^=tile-]'))
        .filter((el) => !el.getAttribute('data-testid')!.startsWith('provider-tile-'))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
        })
    );

    expect(boxes).toHaveLength(24);
    for (const b of boxes) {
      expect(b.top).toBeGreaterThanOrEqual(-0.5);
      expect(b.bottom).toBeLessThanOrEqual(844 + 0.5); // last row is NOT below the fold
      expect(b.left).toBeGreaterThanOrEqual(-0.5);
      expect(b.right).toBeLessThanOrEqual(390 + 0.5);
      expect(b.height).toBeGreaterThanOrEqual(44); // AD-2: each half is a real touch target
    }

    // The document does not scroll vertically (grid is sized to the viewport).
    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight + 1
    );
    expect(scrollable).toBe(false);
  });
});
