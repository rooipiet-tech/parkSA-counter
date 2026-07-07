import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { gotoApp, unlock } from './helpers.ts';
import { generateMonth, SEED_MONTH_RANGE } from '../src/seed/month.ts';
import { toSastDate, toSastDow, toSastHour } from '../src/lib/sast.ts';
import { tombstoneSet } from '../src/lib/aggregate.ts';

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures', 'expected-aggregates.json'), 'utf8')
);

test('dashboard aggregates the seeded month per fixture, read-only (AC-18)', async ({ page }) => {
  await gotoApp(page, { seed: 'month' });
  await unlock(page);
  await page.getByTestId('nav-dashboard').click();
  await page.getByTestId('range-from').fill(SEED_MONTH_RANGE.from);
  await page.getByTestId('range-to').fill(SEED_MONTH_RANGE.to);

  // Pick spot-check cells straight from the deterministic generator: an
  // offline-flagged event (binned by device_ts — the SAST conversion path).
  const month = generateMonth();
  const dead = tombstoneSet(month.tombstones);
  const offline = month.events.find((e) => e.synced_offline && !dead.has(e.id))!;
  const pid = offline.provider_id;
  const hour = toSastHour(offline.device_ts); // device_ts is authoritative for offline events
  const dow = toSastDow(offline.device_ts);
  const date = toSastDate(offline.device_ts);

  const expectedHour = fixture.byHour[pid][hour];
  expect(expectedHour).toBeGreaterThan(0); // the offline event itself is in this bin
  await expect(page.getByTestId(`cell-hour-${pid}-${hour}`)).toHaveText(String(expectedHour));

  await expect(page.getByTestId(`cell-dow-${pid}-${dow}`)).toHaveText(String(fixture.byDow[pid][dow]));
  await expect(page.getByTestId(`cell-date-${pid}-${date}`)).toHaveText(
    String(fixture.byDate[pid][date])
  );

  // A couple more cells across other providers.
  await expect(page.getByTestId('cell-hour-unknown-9')).toHaveText(String(fixture.byHour['unknown'][9]));
  await expect(page.getByTestId('dash-total-mr-parking')).toHaveText(
    String(fixture.totalsByProvider['mr-parking'])
  );
  await expect(page.getByTestId('dash-total-unknown')).toHaveText(
    String(fixture.totalsByProvider['unknown'])
  );

  // Uncovered evening hours produce zero counts (tombstones excluded, DC-06 honored upstream).
  await expect(page.getByTestId(`cell-hour-${pid}-23`)).toHaveText('0');

  // Read-only: no event-mutating controls on the dashboard.
  await expect(page.locator('[data-testid^=tile-]')).toHaveCount(0);
  await expect(page.getByTestId('undo-btn')).toHaveCount(0);
  await expect(page.getByTestId('session-end')).toHaveCount(0);
});
