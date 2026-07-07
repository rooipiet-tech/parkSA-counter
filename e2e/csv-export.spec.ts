import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { gotoApp, unlock } from './helpers.ts';
import { SEED_MONTH_RANGE } from '../src/seed/month.ts';

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures', 'expected-aggregates.json'), 'utf8')
);

const EXPECTED_HEADER =
  'provider_id,provider_name,event_id,device_ts,received_at,synced_offline,session_id,observer_label,location_label,tombstoned,clock_suspect';

test('CSV export works from the UI and programmatically, byte-identical (AC-19)', async ({
  page
}) => {
  await gotoApp(page, { seed: 'month' });
  await unlock(page);
  await page.getByTestId('nav-dashboard').click();
  await page.getByTestId('range-from').fill(SEED_MONTH_RANGE.from);
  await page.getByTestId('range-to').fill(SEED_MONTH_RANGE.to);

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('csv-export').click();
  const download = await downloadPromise;
  const downloaded = readFileSync((await download.path())!, 'utf8');

  const lines = downloaded.trimEnd().split('\n');
  expect(lines[0]).toBe(EXPECTED_HEADER);
  for (const col of EXPECTED_HEADER.split(',')) expect(lines[0].split(',')).toContain(col);
  expect(lines.length - 1).toBe(fixture.eventCount); // all rows, tombstoned ones flagged

  // Programmatic export over the same range is byte-identical.
  const api = await page.evaluate(
    (range) => window.__PARKSA__.exportCsv(range),
    { from: SEED_MONTH_RANGE.from, to: SEED_MONTH_RANGE.to }
  );
  expect(api).toBe(downloaded);

  // Booleans round-trip: both values of synced_offline and tombstoned appear.
  const idxSynced = lines[0].split(',').indexOf('synced_offline');
  const idxTomb = lines[0].split(',').indexOf('tombstoned');
  const syncedVals = new Set(lines.slice(1).map((l) => l.split(',')[idxSynced]));
  const tombVals = new Set(lines.slice(1).map((l) => l.split(',')[idxTomb]));
  expect(syncedVals).toEqual(new Set(['true', 'false']));
  expect(tombVals).toEqual(new Set(['true', 'false']));
  expect(lines.slice(1).filter((l) => l.split(',')[idxTomb] === 'true')).toHaveLength(
    fixture.tombstoneCount
  );
});

test('coverage CSV export from the dashboard (AC-10/F2)', async ({ page }) => {
  await gotoApp(page, { seed: 'month' });
  await unlock(page);
  await page.getByTestId('nav-dashboard').click();
  await page.getByTestId('range-from').fill('2026-06-01');
  await page.getByTestId('range-to').fill('2026-06-02');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('coverage-export').click();
  const download = await downloadPromise;
  const csv = readFileSync((await download.path())!, 'utf8');
  const lines = csv.trimEnd().split('\n');
  expect(lines[0]).toBe('date,hour,covered,event_count');
  expect(lines).toHaveLength(1 + 2 * 24); // one row per date x hour bin
  // Morning session hours are covered; the small hours are not.
  expect(lines).toContain('2026-06-01,3,false,0');
  expect(lines.find((l) => l.startsWith('2026-06-01,9,'))).toMatch(/^2026-06-01,9,true,\d+$/);
});
