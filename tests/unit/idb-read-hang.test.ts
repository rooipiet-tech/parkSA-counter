import { afterEach, describe, expect, it, vi } from 'vitest';

// Reproduce the SECOND iOS Safari / WebKit symptom (distinct from idb-hang.test.ts,
// which hangs the OPEN): here `indexedDB.open()` SUCCEEDS, but the FIRST read
// transaction on the returned connection HANGS — the request fires neither
// success nor error, so `db.get(...)` / `db.getAllFromIndex(...)` return promises
// that NEVER settle. A try/catch around the reads cannot rescue a hang, so
// TapQueue.open's restore `await` never resolves and boot() stalls on "Loading…".
//
// The fix must time-guard the restore reads too, then ABANDON the hung
// connection for a full in-memory DB (so the NEXT op can't hang either).

/** A never-settling promise: models a read request whose callbacks never fire. */
function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

let closed = false;

// db.get / db.getAllFromIndex HANG; everything else is inert. The open resolves
// to this object, so `persistent` starts true and the restore path runs.
const hungDb = {
  get: () => neverSettles<unknown>(),
  getAllFromIndex: () => neverSettles<unknown[]>(),
  getAll: () => neverSettles<unknown[]>(),
  count: () => neverSettles<number>(),
  transaction: () => {
    throw new Error('transaction should never be reached on the abandoned hung DB');
  },
  close: () => {
    closed = true;
  }
};

vi.mock('idb', () => ({
  // Open SUCCEEDS immediately (unlike idb-hang.test.ts) — the hang is in the reads.
  openDB: vi.fn(() => Promise.resolve(hungDb))
}));

import { TapQueue } from '../../src/queue/queue.ts';
import { IDB_OPEN_TIMEOUT_MS } from '../../src/queue/db.ts';
import { createAppCtx } from '../../src/app-context.ts';
import { StubAdapter } from '../../src/adapters/stub.ts';
import { makeSession } from './helpers.ts';

const FAST_TIMEOUT_MS = 50;

afterEach(() => {
  vi.useRealTimers();
  closed = false;
});

describe('read-hang: indexedDB.open() succeeds but the first read hangs', () => {
  it('TapQueue.open still RESOLVES within the timeout into an in-memory (non-persistent) queue', async () => {
    // Pre-fix: the restore `await db.get(...)` never settles, so this promise
    // never resolves and the test fails by vitest's per-test timeout.
    // Post-fix: the read is raced against FAST_TIMEOUT_MS, then the hung DB is
    // abandoned for an in-memory one.
    const q = await TapQueue.open({ isOffline: () => false, idbTimeoutMs: FAST_TIMEOUT_MS });
    expect(q.persistent).toBe(false);
    expect(q.currentSession()).toBe(null);
    // The unusable connection must be released, not left dangling.
    expect(closed).toBe(true);
  });

  it('enqueue / getQueueState work in memory AFTER the read hang (next op does not hang)', async () => {
    const q = await TapQueue.open({ isOffline: () => false, idbTimeoutMs: FAST_TIMEOUT_MS });
    // These operations would hang against the abandoned real DB (its
    // transaction() throws); they must run against the in-memory fallback.
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

  it('createAppCtx resolves with storageAvailable=false (boot does not hang on the read)', async () => {
    // createAppCtx uses the DEFAULT timeout; fake timers avoid a real 3s wait.
    vi.useFakeTimers();
    const ctxPromise = createAppCtx(new StubAdapter());
    await vi.advanceTimersByTimeAsync(IDB_OPEN_TIMEOUT_MS + 50);
    const ctx = await ctxPromise;

    expect(ctx.storageAvailable).toBe(false);
    // Genuinely usable in memory after the degrade: a tap tallies.
    ctx.actions.startSession('OBS-1', 'Parkade 2');
    expect(ctx.actions.tap('mr-parking', 'dropoff')).toBe(1);
  });
});
