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
    Array.from(document.querySelectorAll('[data-testid^=tile-]')).map((el) => ({
      testid: el.getAttribute('data-testid'),
      name: el.querySelector('.tile-name')?.textContent ?? ''
    }))
  );

  expect(tiles).toHaveLength(12);
  tiles.forEach((tile, i) => {
    expect(tile.testid).toBe(`tile-${SEED_PROVIDERS[i].id}`);
    expect(tile.name).toBe(SEED_PROVIDERS[i].name);
  });
  expect(tiles[11].name).toBe('Unknown');

  // Server-side providers agree (same ids), Unknown flagged permanent.
  const providers = await page.evaluate(() =>
    window.__PARKSA__.getServerState().then((s) => s.providers)
  );
  expect(providers.map((p: { id: string }) => p.id)).toEqual(SEED_PROVIDERS.map((p) => p.id));
  expect(providers[11].is_permanent).toBe(true);
});
