import { describe, expect, it } from 'vitest';
import { aggregate } from '../../src/lib/aggregate.ts';
import { exportCoverageCsv } from '../../src/lib/csv.ts';
import { sastToUtcMs, sastBinKey } from '../../src/lib/sast.ts';
import { SEED_PROVIDERS } from '../../src/seed/providers.ts';
import { StubAdapter } from '../../src/adapters/stub.ts';
import { newId } from '../../src/lib/ids.ts';
import { DEFAULT_LOCATION, type Session, type ServerEvent } from '../../src/lib/types.ts';
import { openTestQueue, makeSession } from './helpers.ts';

const DATE = '2026-06-05';

function sastEvent(hour: number, minute: number, sessionId: string): ServerEvent {
  const ts = new Date(sastToUtcMs(DATE, hour, minute)).toISOString();
  return {
    id: newId(),
    provider_id: 'mr-parking',
    direction: 'dropoff',
    device_ts: ts,
    received_at: ts,
    session_id: sessionId,
    observer_label: 'OBS-1',
    location_label: DEFAULT_LOCATION,
    synced_offline: false,
    clock_suspect: false
  };
}

describe('per-bin session coverage (AC-10 / DC-07)', () => {
  const session: Session = {
    id: newId(),
    start_ts: new Date(sastToUtcMs(DATE, 8)).toISOString(), // 08:00 SAST
    end_ts: new Date(sastToUtcMs(DATE, 12)).toISOString(), // 12:00 SAST
    end_source: 'normal',
    observer_label: 'OBS-1',
    location_label: DEFAULT_LOCATION
  };
  const events = [sastEvent(8, 15, session.id), sastEvent(9, 30, session.id), sastEvent(11, 59, session.id)];
  const range = { from: DATE, to: DATE };

  it('aggregate coverage map: hour bins 08-11 covered, 13-17 uncovered', () => {
    const agg = aggregate(events, [], [session], SEED_PROVIDERS, range);
    for (const h of [8, 9, 10, 11]) expect(agg.coverage[sastBinKey(DATE, h)]).toBe(true);
    for (const h of [13, 14, 15, 16, 17]) expect(agg.coverage[sastBinKey(DATE, h)]).toBe(false);
    expect(agg.coverage[sastBinKey(DATE, 12)]).toBe(false); // session ended exactly at 12:00
    expect(agg.coverage[sastBinKey(DATE, 7)]).toBe(false);
  });

  it('exportCoverageCsv marks the same bins and counts events per bin', () => {
    const csv = exportCoverageCsv({ events, tombstones: [], sessions: [session], range });
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('date,hour,covered,event_count');
    expect(lines).toHaveLength(1 + 24); // one row per hour bin of the single day
    const byHour = new Map(
      lines.slice(1).map((l) => {
        const [date, hour, covered, count] = l.split(',');
        expect(date).toBe(DATE);
        return [Number(hour), { covered: covered === 'true', count: Number(count) }];
      })
    );
    for (const h of [8, 9, 10, 11]) expect(byHour.get(h)!.covered).toBe(true);
    for (const h of [13, 14, 15, 16, 17]) expect(byHour.get(h)!.covered).toBe(false);
    expect(byHour.get(8)!.count).toBe(1);
    expect(byHour.get(9)!.count).toBe(1);
    expect(byHour.get(10)!.count).toBe(0); // covered but zero demand — distinguishable
    expect(byHour.get(11)!.count).toBe(1);
    expect(byHour.get(13)!.count).toBe(0);
  });

  it('tombstoned events are excluded from bin counts', () => {
    const csv = exportCoverageCsv({
      events,
      tombstones: [{ event_id: events[0].id, created_at: new Date().toISOString() }],
      sessions: [session],
      range
    });
    const row8 = csv.trimEnd().split('\n').find((l) => l.startsWith(`${DATE},8,`))!;
    expect(row8).toBe(`${DATE},8,true,0`);
  });

  it('a never-ended session can be closed retroactively via the explicit path', async () => {
    const { queue } = await openTestQueue({ startSession: false });
    const stale = makeSession();
    await queue.startSession(stale);
    // ... device is abandoned; later, close retroactively (explicit API path).
    await queue.closeSessionRetroactively(stale);
    const adapter = new StubAdapter();
    await queue.flush(adapter);
    const rows = await adapter.listSessions();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(stale.id);
    expect(rows[0].end_ts).toBeTruthy();
    expect(rows[0].end_source).toBe('retroactive');
    expect(queue.currentSession()).toBeNull();
  });

  it('normal end round-trip persists both timestamps and end_source=normal', async () => {
    const { queue, session: s } = await openTestQueue();
    await queue.endSession();
    const adapter = new StubAdapter();
    await queue.flush(adapter);
    const rows = await adapter.listSessions();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(s!.id);
    expect(rows[0].start_ts).toBe(s!.start_ts);
    expect(rows[0].end_ts).toBeTruthy();
    expect(rows[0].end_source).toBe('normal');
  });
});
