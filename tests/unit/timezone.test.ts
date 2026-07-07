import { describe, expect, it } from 'vitest';
import {
  toSastDate,
  toSastDow,
  toSastDowName,
  toSastHour,
  sastToUtcMs,
  sastBinRangeUtc,
  eachSastDate,
  sastBinKey
} from '../../src/lib/sast.ts';

describe('SAST binning (single tz conversion point, fixed UTC+2)', () => {
  it('bins 2026-03-10T21:30:00Z as hour 23, date 2026-03-10, Tuesday', () => {
    const ts = '2026-03-10T21:30:00Z';
    expect(toSastHour(ts)).toBe(23);
    expect(toSastDate(ts)).toBe('2026-03-10');
    expect(toSastDowName(ts)).toBe('Tuesday');
    expect(toSastDow(ts)).toBe(2);
  });

  it('crosses SAST midnight: 2026-03-10T22:30:00Z -> hour 0, date 2026-03-11', () => {
    const ts = '2026-03-10T22:30:00Z';
    expect(toSastHour(ts)).toBe(0);
    expect(toSastDate(ts)).toBe('2026-03-11');
  });

  it('crosses day-of-week: 2026-03-14T23:00:00Z (Saturday UTC) -> Sunday in SAST', () => {
    const ts = '2026-03-14T23:00:00Z';
    expect(toSastDowName(ts)).toBe('Sunday');
    expect(toSastDow(ts)).toBe(0);
    expect(toSastDate(ts)).toBe('2026-03-15');
  });

  it('round-trips SAST wall clock to UTC instants', () => {
    const ms = sastToUtcMs('2026-06-05', 8, 30);
    expect(new Date(ms).toISOString()).toBe('2026-06-05T06:30:00.000Z');
    expect(toSastHour(ms)).toBe(8);
    expect(toSastDate(ms)).toBe('2026-06-05');
  });

  it('bin ranges and helpers are consistent', () => {
    const [start, end] = sastBinRangeUtc('2026-06-05', 8);
    expect(end - start).toBe(3_600_000);
    expect(toSastHour(start)).toBe(8);
    expect(toSastHour(end - 1)).toBe(8);
    expect(eachSastDate('2026-06-28', '2026-07-02')).toEqual([
      '2026-06-28',
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
      '2026-07-02'
    ]);
    expect(sastBinKey('2026-06-05', 8)).toBe('2026-06-05T08');
  });
});
