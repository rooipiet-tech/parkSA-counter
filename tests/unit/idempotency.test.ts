import { describe, expect, it } from 'vitest';
import { StubAdapter } from '../../src/adapters/stub.ts';
import { TapQueue } from '../../src/queue/queue.ts';
import { openTestQueue } from './helpers.ts';

describe('idempotent sync (AC-08)', () => {
  it('(a) re-sending an already-accepted 10-event batch never duplicates', async () => {
    const { queue } = await openTestQueue();
    for (let i = 0; i < 10; i++) queue.enqueueTap('mr-parking', 'dropoff');
    const adapter = new StubAdapter();
    await queue.flush(adapter);
    expect(await adapter.listEvents()).toHaveLength(10);

    // Simulate a lost-ack re-send of the exact same batch.
    const state = await queue.getQueueState();
    const batch = state.events.map(({ tombstoned: _t, synced: _s, ...e }) => e);
    await adapter.insertEvents(batch);
    await adapter.insertEvents(batch);
    expect(await adapter.listEvents()).toHaveLength(10);

    // Double flush is also a no-op.
    await queue.flush(adapter);
    expect(await adapter.listEvents()).toHaveLength(10);
  });

  it('(b) fault AFTER server accept but before local ack: retry drains without duplicates', async () => {
    const { queue } = await openTestQueue();
    for (let i = 0; i < 10; i++) queue.enqueueTap('safe-car', 'dropoff');
    const adapter = new StubAdapter();
    adapter.failAfterAcceptOnce();

    await expect(queue.flush(adapter)).rejects.toThrow();
    // Server accepted, but the queue kept everything pending (no ack).
    expect(await adapter.listEvents()).toHaveLength(10);
    expect(await queue.pendingCount()).toBe(10);

    await queue.flush(adapter);
    expect(await adapter.listEvents()).toHaveLength(10);
    expect(await queue.pendingCount()).toBe(0);
  });

  it('(c) app restart mid-flush: a new queue over the same IndexedDB re-flushes to exactly 10', async () => {
    const { queue, dbName } = await openTestQueue();
    for (let i = 0; i < 10; i++) queue.enqueueTap('eazypark', 'dropoff');
    const adapter = new StubAdapter();
    adapter.failAfterAcceptOnce();
    await expect(queue.flush(adapter)).rejects.toThrow();
    queue.close(); // simulate app death mid-flush

    const revived = await TapQueue.open({ dbName, isOffline: () => false });
    expect(await revived.pendingCount()).toBe(10);
    await revived.flush(adapter);
    expect(await adapter.listEvents()).toHaveLength(10);
    expect(await revived.pendingCount()).toBe(0);
    // The resumed session log still shows all 10 taps, now synced.
    const state = await revived.getQueueState();
    expect(state.events).toHaveLength(10);
    expect(state.events.every((e) => e.synced)).toBe(true);
  });

  it('flush order is sessions -> skew -> events -> tombstones (load-bearing for the no-FK design)', async () => {
    const { queue } = await openTestQueue();
    queue.enqueueTap('mr-parking', 'dropoff');
    queue.undoLast();
    queue.enqueueTap('mr-parking', 'dropoff');

    const order: string[] = [];
    const adapter = new StubAdapter();
    for (const m of ['upsertSession', 'getServerTime', 'insertEvents', 'insertTombstones'] as const) {
      const orig = adapter[m].bind(adapter);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (adapter as any)[m] = (...args: unknown[]) => {
        order.push(m);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (orig as any)(...args);
      };
    }
    await queue.flush(adapter);
    expect(order.indexOf('upsertSession')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('upsertSession')).toBeLessThan(order.indexOf('getServerTime'));
    expect(order.indexOf('getServerTime')).toBeLessThan(order.indexOf('insertEvents'));
    expect(order.indexOf('insertEvents')).toBeLessThan(order.indexOf('insertTombstones'));
  });
});
