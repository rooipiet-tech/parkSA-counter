import { afterEach, describe, expect, it, vi } from 'vitest';

// Reproduce the EXACT iOS Safari / WebKit symptom: `indexedDB.open()` HANGS — it
// fires neither success nor error, so idb's `openDB` returns a promise that
// NEVER settles. (This is distinct from boot-resilience.test.ts, which mocks a
// REJECTED open. A try/catch handles a rejection; only a timeout handles a hang.)
vi.mock('idb', () => ({
  openDB: vi.fn(() => new Promise<never>(() => {})) // never resolves, never rejects
}));

import { TapQueue } from '../../src/queue/queue.ts';
import { IDB_OPEN_TIMEOUT_MS } from '../../src/queue/db.ts';
import { createAppCtx } from '../../src/app-context.ts';
import { StubAdapter } from '../../src/adapters/stub.ts';
import { makeSession } from './helpers.ts';

// A low, injected timeout keeps the real-timer tests fast (no 3s wait) while
// still exercising the hang -> timeout -> in-memory fallback path.
const FAST_TIMEOUT_MS = 50;

afterEach(() => {
  vi.useRealTimers();
});

describe('idb-hang: indexedDB.open() hangs (iOS Safari blank-page regression)', () => {
  it('TapQueue.open still RESOLVES within the timeout into an in-memory (non-persistent) queue', async () => {
    // Pre-fix this HANGS forever (no timeout) and the test fails by vitest's
    // per-test timeout; post-fix it resolves in ~FAST_TIMEOUT_MS.
    const q = await TapQueue.open({ isOffline: () => false, idbTimeoutMs: FAST_TIMEOUT_MS });
    expect(q.persistent).toBe(false);
    expect(q.currentSession()).toBe(null);
  });

  it('enqueue / getQueueState work in memory while the open is hung', async () => {
    const q = await TapQueue.open({ isOffline: () => false, idbTimeoutMs: FAST_TIMEOUT_MS });
    await q.startSession(makeSession());
    q.enqueueTap('mr-parking', 'dropoff');
    q.enqueueTap('mr-parking', 'dropoff');
    q.enqueueTap('safe-car', 'pickup');

    expect(q.getCountFor('mr-parking', 'dropoff')).toBe(2);
    expect(q.getCountFor('safe-car', 'pickup')).toBe(1);

    const state = await q.getQueueState();
    expect(state.events).toHaveLength(3);
    expect(state.pendingCount).toBe(3);
  });

  it('createAppCtx resolves with storageAvailable=false (boot does not hang)', async () => {
    // createAppCtx uses the DEFAULT timeout, so drive fake timers to avoid a
    // real 3s wait. advanceTimersByTimeAsync also flushes the awaited microtasks.
    vi.useFakeTimers();
    const ctxPromise = createAppCtx(new StubAdapter());
    await vi.advanceTimersByTimeAsync(IDB_OPEN_TIMEOUT_MS + 50);
    const ctx = await ctxPromise;

    expect(ctx.storageAvailable).toBe(false);
    // Genuinely usable in memory: a tap after starting a session tallies.
    ctx.actions.startSession('OBS-1', 'Parkade 2');
    expect(ctx.actions.tap('mr-parking', 'dropoff')).toBe(1);
  });
});
