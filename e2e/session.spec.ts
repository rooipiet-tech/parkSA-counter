import { expect, test } from '@playwright/test';
import {
  DEFAULT_LOCATION,
  endSession,
  flush,
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
  await endSession(page);
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
  await endSession(page);
  await expect(page.getByTestId('unsynced-warning')).toBeVisible();
  await expect(page.getByTestId('unsynced-badge')).toHaveText('3'); // the 3 offline taps stay queued
});

test('a stale open session is closed retroactively via the exposed API (AC-10/AN-01)', async ({
  page
}) => {
  await gotoApp(page);
  await unlock(page);
  await startSession(page);
  await tapTile(page, 'mr-parking', 1);
  await flush(page); // the open session (end_ts null) now exists server-side

  const sessionId = await page.evaluate(async () => {
    const s = await window.__PARKSA__.getServerState();
    return s.sessions[0].id;
  });

  // Drive the exposed retroactive-close path (the same one the settings UI uses).
  await page.evaluate((id) => window.__PARKSA__.closeSessionRetroactively(id), sessionId);
  await flush(page);

  await expect
    .poll(async () => {
      const s = await getServerState(page);
      return s.sessions.find((x) => x.id === sessionId)?.end_source ?? null;
    })
    .toBe('retroactive');
});
