import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StubAdapter } from '../../src/adapters/stub.ts';
import { SyncEngine } from '../../src/sync/engine.ts';
import { openTestQueue } from './helpers.ts';

/** Let real microtasks/macrotasks (promise chains, fake-indexeddb) settle. */
async function settle() {
  for (let i = 0; i < 25; i++) await new Promise<void>((r) => setImmediate(r));
}

async function advance(ms: number) {
  vi.advanceTimersByTime(ms);
  await settle();
}

describe('backend outage is non-blocking (AC-24 / DC-13)', () => {
  beforeEach(() =>
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
  );
  afterEach(() => vi.useRealTimers());

  it('persistent failure: taps still enqueue, retry delays strictly increase, queue drains after the fault clears', async () => {
    const { queue } = await openTestQueue();
    const adapter = new StubAdapter();
    adapter.injectFaults(5); // next 5 adapter calls fail

    const delays: number[] = [];
    const engine = new SyncEngine({
      flush: () => queue.flush(adapter),
      isOffline: () => false,
      intervalMs: 3_600_000, // keep the periodic timer out of the way
      baseDelayMs: 1_000,
      maxDelayMs: 60_000,
      onRetryScheduled: (d) => delays.push(d)
    });

    queue.enqueueTap('mr-parking', 'dropoff');
    engine.start(); // init attempt fails -> schedules the first retry
    await settle();
    expect(delays).toEqual([1_000]);

    // Counting is never blocked by sync failures.
    queue.enqueueTap('safe-car', 'dropoff');
    queue.enqueueTap('safe-car', 'dropoff');
    expect(queue.getCountFor('safe-car', 'dropoff')).toBe(2);
    expect(await queue.pendingCount()).toBe(3);

    // Let several retries fail: backoff delays must strictly increase, capped.
    await advance(1_000);
    await advance(2_000);
    await advance(4_000);
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000]);
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(60_000);

    // Fault clears -> a scheduled retry drains the queue with no user action.
    adapter.clearFaults();
    await advance(8_000); // 5th attempt still consumes the last injected fault
    await advance(16_000);
    await advance(32_000);
    expect(await queue.pendingCount()).toBe(0);
    expect(await adapter.listEvents()).toHaveLength(3);
    expect(engine.lastSyncAt).not.toBeNull();

    engine.stop();
  });

  it('retry delays are capped (no unbounded growth, one retry timer at a time)', async () => {
    const flush = vi.fn(() => Promise.reject(new Error('down')));
    const delays: number[] = [];
    const engine = new SyncEngine({
      flush,
      isOffline: () => false,
      intervalMs: 3_600_000,
      baseDelayMs: 1_000,
      maxDelayMs: 8_000,
      onRetryScheduled: (d) => delays.push(d)
    });
    engine.start();
    await settle();
    for (let i = 0; i < 8; i++) await advance(8_000);
    expect(delays.length).toBeGreaterThanOrEqual(5);
    expect(delays[delays.length - 1]).toBe(8_000);
    // Exactly one scheduled retry per failed attempt (init + retries).
    expect(flush.mock.calls.length).toBe(delays.length);
    engine.stop();
  });
});
