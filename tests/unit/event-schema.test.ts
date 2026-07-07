import { describe, expect, it } from 'vitest';
import { StubAdapter } from '../../src/adapters/stub.ts';
import { openTestQueue } from './helpers.ts';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('event schema (AC-06)', () => {
  it('a tapped-then-flushed event carries all required fields; received_at is stamped by the adapter', async () => {
    const { queue, session } = await openTestQueue({ offline: true });
    const row = queue.enqueueTap('mr-parking', 'pickup');

    // Client-generated UUID id exists BEFORE any flush.
    expect(row.id).toMatch(UUID_V4_RE);
    expect(row.provider_id).toBe('mr-parking');
    expect(row.direction).toBe('pickup'); // set client-side at tap time (AD-1)
    expect(typeof row.device_ts).toBe('string');
    expect(Number.isNaN(new Date(row.device_ts).getTime())).toBe(false);
    expect(row.session_id).toBe(session!.id);
    expect(row.observer_label).toBe('OBS-1');
    expect(row.location_label).toContain('OR Tambo');
    expect(row.synced_offline).toBe(true); // computed at enqueue time
    expect(row.clock_suspect).toBe(false);
    expect(row.received_at).toBeUndefined(); // backend stamps it, not the client

    const adapter = new StubAdapter();
    await queue.flush(adapter);

    const events = await adapter.listEvents();
    expect(events).toHaveLength(1);
    const server = events[0];
    expect(server.id).toBe(row.id); // same client-generated id = idempotency key
    expect(server.received_at).toBeTruthy();
    expect(Number.isNaN(new Date(server.received_at).getTime())).toBe(false);
    expect(server.device_ts).toBe(row.device_ts);
    expect(server.direction).toBe('pickup'); // carried through the adapter
    expect(server.synced_offline).toBe(true);
    expect(server.session_id).toBe(session!.id);
  });

  it('queue state exposes full rows with tombstoned/synced flags and pendingCount', async () => {
    const { queue } = await openTestQueue({ offline: false });
    queue.enqueueTap('safe-car', 'dropoff');
    queue.enqueueTap('e-parking', 'pickup');
    const state = await queue.getQueueState();
    expect(state.events).toHaveLength(2);
    expect(state.pendingCount).toBe(2);
    for (const e of state.events) {
      expect(e.tombstoned).toBe(false);
      expect(e.synced).toBe(false);
      expect(e.synced_offline).toBe(false);
    }
  });
});
