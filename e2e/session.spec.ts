import { expect, test } from '@playwright/test';
import {
  DEFAULT_LOCATION,
  getServerState,
  gotoApp,
  setForceOffline,
  startSession,
  tapTile,
  unlock
} from './helpers.ts';

test('start/end round-trip persists start_ts and end_ts with end_source=normal (AC-10)', async ({
  page
}) => {
  await gotoApp(page);
  await unlock(page);

  // Location label defaults to the ACSA parkade.
  await expect(page.getByTestId('location-input')).toHaveValue(DEFAULT_LOCATION);

  const before = Date.now();
  await startSession(page);
  await tapTile(page, 'mr-parking', 2);
  await page.getByTestId('session-end').click();
  await expect(page.getByTestId('session-start')).toBeVisible();
  const after = Date.now();

  await expect
    .poll(async () => {
      const server = await getServerState(page);
      return server.sessions.length;
    })
    .toBe(1);

  const server = await getServerState(page);
  const s = server.sessions[0];
  expect(s.observer_label).toBe('OBS-1');
  expect(s.location_label).toBe(DEFAULT_LOCATION);
  expect(s.end_source).toBe('normal');
  const start = new Date(s.start_ts).getTime();
  const end = new Date(s.end_ts!).getTime();
  expect(start).toBeGreaterThanOrEqual(before - 2_000);
  expect(end).toBeLessThanOrEqual(after + 2_000);
  expect(end).toBeGreaterThanOrEqual(start);

  // The session's events reference it.
  expect(server.events.every((e) => e.session_id === s.id)).toBe(true);
});

test('ending a session with unsynced taps shows the unsynced warning (AC-10)', async ({ page }) => {
  await gotoApp(page);
  await unlock(page);
  await startSession(page);
  await setForceOffline(page, true);
  await tapTile(page, 'safe-car', 3);
  await page.getByTestId('session-end').click();
  await expect(page.getByTestId('unsynced-warning')).toBeVisible();
  await expect(page.getByTestId('unsynced-badge')).toHaveText('3'); // the 3 offline taps stay queued
});
