import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregate } from '../../src/lib/aggregate.ts';
import { generateMonth, SEED_MONTH_RANGE } from '../../src/seed/month.ts';

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures', 'expected-aggregates.json'), 'utf8')
);

describe('seeded-month aggregation matches the checked-in fixture (AC-18)', () => {
  const month = generateMonth();
  const agg = aggregate(month.events, month.tombstones, month.sessions, month.providers, {
    from: SEED_MONTH_RANGE.from,
    to: SEED_MONTH_RANGE.to
  });

  it('the generator is deterministic', () => {
    const again = generateMonth();
    expect(again.events).toEqual(month.events);
    expect(again.sessions).toEqual(month.sessions);
    expect(again.tombstones).toEqual(month.tombstones);
    expect(month.events.length).toBe(fixture.eventCount);
    expect(month.tombstones.length).toBe(fixture.tombstoneCount);
    expect(month.sessions.length).toBe(fixture.sessionCount);
  });

  it('provider x hour-of-day equals the fixture', () => {
    expect(agg.byHour).toEqual(fixture.byHour);
  });

  it('provider x day-of-week equals the fixture', () => {
    expect(agg.byDow).toEqual(fixture.byDow);
  });

  it('provider x calendar date equals the fixture', () => {
    expect(agg.byDate).toEqual(fixture.byDate);
  });

  it('coverage map and totals equal the fixture', () => {
    expect(agg.coverage).toEqual(fixture.coverage);
    expect(agg.total).toBe(fixture.total);
    expect(agg.totalsByProvider).toEqual(fixture.totalsByProvider);
  });

  it('tombstoned events are excluded: total < raw event count', () => {
    expect(agg.total).toBeLessThan(month.events.length);
    expect(agg.total).toBe(month.events.length - month.tombstones.length);
  });

  it('the month mixes offline and online events (DC-06 rule exercised)', () => {
    expect(month.events.some((e) => e.synced_offline)).toBe(true);
    expect(month.events.some((e) => !e.synced_offline)).toBe(true);
  });
});
