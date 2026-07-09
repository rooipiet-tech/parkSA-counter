import { describe, it, expect, vi } from 'vitest';

// Simulate the iOS Safari / WebKit failure mode: IndexedDB open REJECTS.
// The whole point of the fix is that boot survives this and degrades to an
// in-memory queue instead of leaving #root blank.
vi.mock('idb', () => ({
  openDB: vi.fn(() => Promise.reject(new Error('IndexedDB blocked (simulated WebKit)')))
}));

import { TapQueue } from '../../src/queue/queue.ts';
import { createAppCtx } from '../../src/app-context.ts';
import { StubAdapter } from '../../src/adapters/stub.ts';
import { makeSession } from './helpers.ts';

describe('boot resilience: IndexedDB open throws (iOS Safari blank-page regression)', () => {
  it('TapQueue.open resolves into a usable in-memory (non-persistent) queue', async () => {
    const q = await TapQueue.open({ isOffline: () => false });
    expect(q.persistent).toBe(false);
    // A resolved queue with a null current session is the usable idle state.
    expect(q.currentSession()).toBe(null);
  });

  it('enqueue + getQueueState work in memory when IndexedDB is unavailable', async () => {
    const q = await TapQueue.open({ isOffline: () => false });
    await q.startSession(makeSession());
    q.enqueueTap('mr-parking', 'dropoff');
    q.enqueueTap('mr-parking', 'dropoff');
    q.enqueueTap('safe-car', 'dropoff');

    expect(q.getCountFor('mr-parking', 'dropoff')).toBe(2);
    expect(q.getCountFor('safe-car', 'dropoff')).toBe(1);

    const state = await q.getQueueState();
    expect(state.events).toHaveLength(3);
    expect(state.pendingCount).toBe(3);
  });

  it('in-memory taps still flush to the backend adapter', async () => {
    const q = await TapQueue.open({ isOffline: () => false });
    await q.startSession(makeSession());
    q.enqueueTap('mr-parking', 'dropoff');
    q.enqueueTap('eazypark', 'dropoff');
    const adapter = new StubAdapter();
    await q.flush(adapter);
    expect(await adapter.listEvents()).toHaveLength(2);
    expect(await q.pendingCount()).toBe(0);
  });

  it('createAppCtx boots fully and reports storage as unavailable', async () => {
    // No unhandled rejection: awaiting boot resolves to a working ctx.
    const ctx = await createAppCtx(new StubAdapter());
    expect(ctx.storageAvailable).toBe(false);
    // The app is genuinely usable: a tap after unlocking + starting a session
    // increments the in-memory tally.
    ctx.actions.startSession('OBS-1', 'Parkade 2');
    const count = ctx.actions.tap('mr-parking', 'dropoff');
    expect(count).toBe(1);
  });
});
