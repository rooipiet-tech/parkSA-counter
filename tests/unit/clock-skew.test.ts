import { describe, expect, it } from 'vitest';
import { StubAdapter } from '../../src/adapters/stub.ts';
import { openTestQueue } from './helpers.ts';

describe('clock-skew audit (AC-25 / DC-08)', () => {
  it('|skew| > 120s stamps clock_suspect=true on flushed events', async () => {
    const { queue } = await openTestQueue();
    queue.enqueueTap('mr-parking', 'dropoff');
    queue.enqueueTap('safe-car', 'pickup');
    const adapter = new StubAdapter();
    adapter.setClockOffset(5 * 60_000); // server 5 minutes ahead
    await queue.flush(adapter);
    const events = await adapter.listEvents();
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.clock_suspect === true)).toBe(true);
  });

  it('|skew| <= 120s leaves clock_suspect=false', async () => {
    const { queue } = await openTestQueue();
    queue.enqueueTap('mr-parking', 'dropoff');
    const adapter = new StubAdapter();
    adapter.setClockOffset(30_000); // 30s: within tolerance
    await queue.flush(adapter);
    const events = await adapter.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0].clock_suspect).toBe(false);
  });

  it('negative skew beyond the limit is also suspect', async () => {
    const { queue } = await openTestQueue();
    queue.enqueueTap('mr-parking', 'dropoff');
    const adapter = new StubAdapter();
    adapter.setClockOffset(-5 * 60_000);
    await queue.flush(adapter);
    const events = await adapter.listEvents();
    expect(events[0].clock_suspect).toBe(true);
  });
});
