import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregate, effectiveTs, tombstoneSet } from '../../src/lib/aggregate.ts';
import { toSastDate } from '../../src/lib/sast.ts';
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

  it('per-direction cuts equal the fixture (AD-4)', () => {
    expect(agg.byHourDir).toEqual(fixture.byHourDir);
    expect(agg.byDowDir).toEqual(fixture.byDowDir);
    expect(agg.byDateDir).toEqual(fixture.byDateDir);
    expect(agg.totalsByProviderDir).toEqual(fixture.totalsByProviderDir);
  });

  it('drop-off + pick-up reconstruct the combined cut exactly (AD-4)', () => {
    for (const pid of Object.keys(agg.byHour)) {
      for (let h = 0; h < 24; h++) {
        expect(agg.byHourDir[pid].dropoff[h] + agg.byHourDir[pid].pickup[h]).toBe(agg.byHour[pid][h]);
      }
      expect(
        agg.totalsByProviderDir[pid].dropoff + agg.totalsByProviderDir[pid].pickup
      ).toBe(agg.totalsByProvider[pid]);
    }
  });

  it('per-direction provider totals match an INDEPENDENT hand count (L-0003, not the fixture)', () => {
    // Ground truth recomputed straight from the raw events by a different code
    // path than aggregate(): filter tombstones + range, group by (provider,dir).
    const dead = tombstoneSet(month.tombstones);
    const hand: Record<string, { dropoff: number; pickup: number }> = {};
    for (const e of month.events) {
      if (dead.has(e.id)) continue;
      const d = toSastDate(effectiveTs(e));
      if (d < SEED_MONTH_RANGE.from || d > SEED_MONTH_RANGE.to) continue;
      (hand[e.provider_id] ??= { dropoff: 0, pickup: 0 })[e.direction]++;
    }
    // The synthetic month is a genuine (non-trivial) mix of both directions.
    const totalDrop = Object.values(hand).reduce((s, v) => s + v.dropoff, 0);
    const totalPick = Object.values(hand).reduce((s, v) => s + v.pickup, 0);
    expect(totalDrop).toBeGreaterThan(0);
    expect(totalPick).toBeGreaterThan(0);
    // Spot-check a specific provider against the aggregate output.
    for (const pid of Object.keys(hand)) {
      expect(agg.totalsByProviderDir[pid].dropoff).toBe(hand[pid].dropoff);
      expect(agg.totalsByProviderDir[pid].pickup).toBe(hand[pid].pickup);
    }
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
