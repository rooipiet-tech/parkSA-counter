import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportCsv, exportCoverageCsv, RAW_CSV_HEADER, COVERAGE_CSV_HEADER } from '../../src/lib/csv.ts';
import { generateMonth, SEED_MONTH_RANGE } from '../../src/seed/month.ts';
import { newId } from '../../src/lib/ids.ts';
import { DEFAULT_LOCATION, type ServerEvent } from '../../src/lib/types.ts';
import { SEED_PROVIDERS } from '../../src/seed/providers.ts';

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures', 'expected-aggregates.json'), 'utf8')
);

function serverEvent(overrides: Partial<ServerEvent> = {}): ServerEvent {
  return {
    id: newId(),
    provider_id: 'mr-parking',
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

describe('CSV export (AC-19 / AC-25)', () => {
  it('raw header is EXACTLY the frozen column list', () => {
    expect(RAW_CSV_HEADER).toBe(
      'provider_id,provider_name,event_id,device_ts,received_at,synced_offline,session_id,observer_label,location_label,tombstoned,clock_suspect'
    );
    const csv = exportCsv({ events: [], tombstones: [], providers: [], range: { from: '2026-06-01', to: '2026-06-01' } });
    expect(csv.split('\n')[0]).toBe(RAW_CSV_HEADER);
  });

  it('coverage header is EXACTLY date,hour,covered,event_count', () => {
    expect(COVERAGE_CSV_HEADER).toBe('date,hour,covered,event_count');
    const csv = exportCoverageCsv({
      events: [],
      tombstones: [],
      sessions: [],
      range: { from: '2026-06-01', to: '2026-06-01' }
    });
    expect(csv.split('\n')[0]).toBe('date,hour,covered,event_count');
  });

  it('synced_offline, tombstoned and clock_suspect round-trip correctly', () => {
    const kept = serverEvent({ synced_offline: true, clock_suspect: true });
    const undone = serverEvent({ device_ts: '2026-06-05T07:00:00.000Z', received_at: '2026-06-05T07:00:03.000Z' });
    const csv = exportCsv({
      events: [kept, undone],
      tombstones: [{ event_id: undone.id, created_at: '2026-06-05T08:00:00.000Z' }],
      providers: SEED_PROVIDERS,
      range: { from: '2026-06-05', to: '2026-06-05' }
    });
    const lines = csv.trimEnd().split('\n');
    expect(lines).toHaveLength(3); // header + both rows (tombstoned rows stay visible, flagged)
    const cols = lines[0].split(',');
    const get = (line: string, name: string) => line.split(',')[cols.indexOf(name)];
    const keptRow = lines.find((l) => l.includes(kept.id))!;
    const undoneRow = lines.find((l) => l.includes(undone.id))!;
    expect(get(keptRow, 'synced_offline')).toBe('true');
    expect(get(keptRow, 'tombstoned')).toBe('false');
    expect(get(keptRow, 'clock_suspect')).toBe('true');
    expect(get(undoneRow, 'tombstoned')).toBe('true');
    expect(get(undoneRow, 'clock_suspect')).toBe('false');
    expect(get(keptRow, 'provider_name')).toBe('Mr Parking');
    expect(get(keptRow, 'device_ts')).toBe(kept.device_ts);
    expect(get(keptRow, 'received_at')).toBe(kept.received_at);
  });

  it('range filters on the effective (DC-06) timestamp', () => {
    const inRange = serverEvent({
      synced_offline: true,
      device_ts: '2026-06-05T06:00:00.000Z', // 08:00 SAST 06-05
      received_at: '2026-06-07T06:00:00.000Z' // received days later — ignored
    });
    const outOfRange = serverEvent({ device_ts: '2026-06-09T06:00:00.000Z', received_at: '2026-06-09T06:00:05.000Z' });
    const csv = exportCsv({
      events: [inRange, outOfRange],
      tombstones: [],
      providers: SEED_PROVIDERS,
      range: { from: '2026-06-05', to: '2026-06-05' }
    });
    const lines = csv.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(inRange.id);
  });

  it('seeded month exports deterministically and matches the fixture row count', () => {
    const month = generateMonth();
    const args = {
      events: month.events,
      tombstones: month.tombstones,
      providers: month.providers,
      range: { from: SEED_MONTH_RANGE.from, to: SEED_MONTH_RANGE.to }
    };
    const csv1 = exportCsv(args);
    const csv2 = exportCsv(args);
    expect(csv1).toBe(csv2); // byte-identical
    const rows = csv1.trimEnd().split('\n').length - 1;
    expect(rows).toBe(fixture.csvRowCount);
    expect(rows).toBe(fixture.eventCount);
  });

  it('fields containing commas or quotes are escaped', () => {
    const e = serverEvent({ location_label: 'Parkade 2, "South"' });
    const csv = exportCsv({
      events: [e],
      tombstones: [],
      providers: SEED_PROVIDERS,
      range: { from: '2026-06-05', to: '2026-06-05' }
    });
    expect(csv).toContain('"Parkade 2, ""South"""');
  });
});
