import { describe, expect, it } from 'vitest';
import { StubAdapter } from '../../src/adapters/stub.ts';
import { undoLast } from '../../src/queue/undo.ts';
import { openTestQueue } from './helpers.ts';

describe('undo = append-only tombstones (AC-09)', () => {
  it('offline undo of an unsynced event: event row stays, tombstone queued, correct half count drops', async () => {
    const { queue } = await openTestQueue({ offline: true });
    queue.enqueueTap('mr-parking', 'dropoff');
    queue.enqueueTap('mr-parking', 'dropoff');
    queue.enqueueTap('mr-parking', 'pickup'); // last tap is the pick-up half

    const undone = undoLast(queue);
    expect(undone).not.toBeNull();
    expect(undone!.direction).toBe('pickup');
    // AD-3: only the pick-up half decrements; the drop-off half is untouched.
    expect(queue.getCountFor('mr-parking', 'pickup')).toBe(0);
    expect(queue.getCountFor('mr-parking', 'dropoff')).toBe(2);

    const state = await queue.getQueueState();
    expect(state.events).toHaveLength(3); // row still present
    expect(state.events.filter((e) => e.tombstoned)).toHaveLength(1);
    expect(state.events[2].tombstoned).toBe(true); // last tap was tombstoned
    expect(state.pendingCount).toBe(3); // the event itself still syncs

    const adapter = new StubAdapter();
    await queue.flush(adapter);
    expect(await adapter.listEvents()).toHaveLength(3); // never deleted
    expect(await adapter.listTombstones()).toHaveLength(1);
    expect((await adapter.listTombstones())[0].event_id).toBe(undone!.id);
  });

  it('undo of an already-synced event tombstones it on the server too', async () => {
    const { queue } = await openTestQueue();
    const adapter = new StubAdapter();
    queue.enqueueTap('safe-car', 'dropoff');
    await queue.flush(adapter);
    expect(queue.getCountFor('safe-car', 'dropoff')).toBe(1);

    const undone = undoLast(queue);
    expect(undone).not.toBeNull();
    expect(undone!.synced).toBe(true);
    expect(queue.getCountFor('safe-car', 'dropoff')).toBe(0);

    await queue.flush(adapter);
    expect(await adapter.listEvents()).toHaveLength(1); // original row retained
    const tombstones = await adapter.listTombstones();
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].event_id).toBe(undone!.id);
  });

  it('tombstone sync is idempotent under retry', async () => {
    const { queue } = await openTestQueue();
    const adapter = new StubAdapter();
    queue.enqueueTap('e-parking', 'dropoff');
    await queue.flush(adapter);
    const undone = undoLast(queue)!;

    // First sync attempt delivers the tombstone but the ack is lost.
    await adapter.insertTombstones([{ event_id: undone.id, created_at: new Date().toISOString() }]);
    // Retry through the queue (its pending tombstone is still there).
    await queue.flush(adapter);
    await queue.flush(adapter);
    expect(await adapter.listTombstones()).toHaveLength(1);
  });

  it('undo with nothing to undo is a safe no-op', async () => {
    const { queue } = await openTestQueue();
    expect(undoLast(queue)).toBeNull();
    queue.enqueueTap('mr-parking', 'dropoff');
    undoLast(queue);
    expect(undoLast(queue)).toBeNull(); // everything already tombstoned
    const state = await queue.getQueueState();
    expect(state.events).toHaveLength(1);
    expect(state.events[0].tombstoned).toBe(true);
  });
});
