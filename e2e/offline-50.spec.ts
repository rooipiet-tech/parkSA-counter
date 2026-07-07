import { expect, test } from '@playwright/test';
import {
  getQueueState,
  getServerState,
  goOnlineAndSync,
  gotoApp,
  setForceOffline,
  startSession,
  tapTile,
  unlock,
  waitForReady
} from './helpers.ts';

test('50 offline taps with a mid-session offline reload sync losslessly on reconnect (AC-07)', async ({
  page
}) => {
  test.setTimeout(120_000);
  await gotoApp(page);
  await unlock(page);
  await startSession(page);
  await setForceOffline(page, true);

  const tapWindowStart = Date.now();
  const firstHalf: Record<string, number> = { 'mr-parking': 10, 'safe-car': 8, eazypark: 7 };
  for (const [pid, n] of Object.entries(firstHalf)) await tapTile(page, pid, n);

  let state = await getQueueState(page);
  expect(state.events).toHaveLength(25);
  expect(state.pendingCount).toBe(25);

  // Spec-mandated reload, still offline: zero queue loss, session resumes.
  await page.reload();
  await waitForReady(page);
  state = await getQueueState(page);
  expect(state.events).toHaveLength(25);
  expect(state.pendingCount).toBe(25);
  expect(state.events.every((e) => e.synced_offline)).toBe(true);
  // Tile counts restored from the persisted session log.
  await expect(page.getByTestId('count-mr-parking')).toHaveText('10');
  await expect(page.getByTestId('count-safe-car')).toHaveText('8');

  const secondHalf: Record<string, number> = { 'mr-parking': 10, 'safe-car': 7, eazypark: 8 };
  for (const [pid, n] of Object.entries(secondHalf)) await tapTile(page, pid, n);
  const tapWindowEnd = Date.now();

  state = await getQueueState(page);
  expect(state.events).toHaveLength(50);
  expect(state.pendingCount).toBe(50);

  // Reconnect: auto-sync drains the queue without user action.
  await goOnlineAndSync(page);
  await expect(page.getByTestId('unsynced-badge')).toHaveText('0', { timeout: 30_000 });

  const server = await getServerState(page);
  const events = server.events.filter((e) => !e.tombstoned);
  expect(events).toHaveLength(50);

  // Per-provider distribution matches the taps.
  const byProvider = new Map<string, number>();
  for (const e of events) byProvider.set(e.provider_id, (byProvider.get(e.provider_id) ?? 0) + 1);
  expect(byProvider.get('mr-parking')).toBe(20);
  expect(byProvider.get('safe-car')).toBe(15);
  expect(byProvider.get('eazypark')).toBe(15);

  // Every event was flagged offline at enqueue time.
  expect(events.every((e) => e.synced_offline === true)).toBe(true);

  // device_ts values are preserved: monotonically non-decreasing, inside the
  // tap window, NOT the reconnect time.
  const ordered = [...events].sort((a, b) => (a.device_ts < b.device_ts ? -1 : 1));
  for (let i = 1; i < ordered.length; i++) {
    expect(ordered[i].device_ts >= ordered[i - 1].device_ts).toBe(true);
  }
  for (const e of events) {
    const t = new Date(e.device_ts).getTime();
    expect(t).toBeGreaterThanOrEqual(tapWindowStart - 2_000);
    expect(t).toBeLessThanOrEqual(tapWindowEnd + 2_000);
    // Synced later than tapped: received_at comes from the reconnect, and
    // device_ts must predate it.
    expect(new Date(e.received_at).getTime()).toBeGreaterThanOrEqual(t);
  }
});
