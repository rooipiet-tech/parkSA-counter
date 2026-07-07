import { describe, expect, it } from 'vitest';
import { aggregate, effectiveTs } from '../../src/lib/aggregate.ts';
import { exportCsv, RAW_CSV_HEADER } from '../../src/lib/csv.ts';
import { SEED_PROVIDERS } from '../../src/seed/providers.ts';
import { newId } from '../../src/lib/ids.ts';
import { DEFAULT_LOCATION, type ServerEvent } from '../../src/lib/types.ts';
import { openTestQueue } from './helpers.ts';

function serverEvent(overrides: Partial<ServerEvent>): ServerEvent {
  return {
    id: newId(),
    provider_id: 'mr-parking',
    direction: 'dropoff',
    device_ts: '2026-06-05T06:00:00.000Z',
    received_at: '2026-06-05T06:00:05.000Z',
    session_id: newId(),
    observer_label: 'OBS-1',
    location_label: DEFAULT_LOCATION,
    synced_offline: false,
    clock_suspect: false,
    ...overrides
  };
}

describe('event-time correctness (AC-14 / DC-06)', () => {
  it('(a) synced_offline is written by the client at enqueue time, before any send', async () => {
    let offline = true;
    const { queue } = await openTestQueue({ offline: () => offline });
    const offlineTap = queue.enqueueTap('mr-parking', 'dropoff');
    expect(offlineTap.synced_offline).toBe(true); // already set, nothing sent yet

    offline = false;
    const onlineTap = queue.enqueueTap('mr-parking', 'pickup');
    expect(onlineTap.synced_offline).toBe(false);

    const state = await queue.getQueueState();
    expect(state.events.map((e) => e.synced_offline)).toEqual([true, false]);
    expect(state.pendingCount).toBe(2); // still queued — flag was pre-send
  });

  it('(b) aggregation bins synced_offline events by device_ts, online events by received_at', () => {
    const offline = serverEvent({
      synced_offline: true,
      device_ts: '2026-06-05T06:55:00.000Z', // 08:55 SAST
      received_at: '2026-06-05T12:10:00.000Z' // 14:10 SAST — must be ignored
    });
    const online = serverEvent({
      synced_offline: false,
      device_ts: '2026-06-05T08:54:00.000Z', // 10:54 SAST
      received_at: '2026-06-05T08:56:00.000Z' // 10:56 SAST — authoritative
    });
    expect(effectiveTs(offline)).toBe(offline.device_ts);
    expect(effectiveTs(online)).toBe(online.received_at);

    const agg = aggregate([offline, online], [], [], SEED_PROVIDERS, {
      from: '2026-06-05',
      to: '2026-06-05'
    });
    const hours = agg.byHour['mr-parking'];
    expect(hours[8]).toBe(1); // offline event: device_ts hour 8 (SAST)
    expect(hours[14]).toBe(0); // NOT binned at received_at
    expect(hours[10]).toBe(1); // online event: received_at hour 10 (SAST)
  });

  it('(c) CSV surfaces synced_offline with correct values', () => {
    const a = serverEvent({ synced_offline: true, device_ts: '2026-06-05T06:55:00.000Z' });
    const b = serverEvent({ synced_offline: false });
    const csv = exportCsv({
      events: [a, b],
      tombstones: [],
      providers: SEED_PROVIDERS,
      range: { from: '2026-06-05', to: '2026-06-05' }
    });
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(RAW_CSV_HEADER);
    const idx = lines[0].split(',').indexOf('synced_offline');
    const rowA = lines.find((l) => l.includes(a.id))!;
    const rowB = lines.find((l) => l.includes(b.id))!;
    expect(rowA.split(',')[idx]).toBe('true');
    expect(rowB.split(',')[idx]).toBe('false');
  });
});
