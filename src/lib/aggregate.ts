import { eachSastDate, sastBinKey, sastBinRangeUtc, toSastDate, toSastDow, toSastHour } from './sast.ts';
import type { Provider, Session, TapEvent, Tombstone } from './types.ts';

/**
 * Client-side aggregation (identical over stub and Supabase data).
 *
 * DC-06 timestamp rule: the EFFECTIVE timestamp of an event is device_ts when
 * it was synced_offline, otherwise received_at. Tombstoned events are
 * excluded from every aggregate (anti-join on tombstones.event_id).
 * All binning goes through src/lib/sast.ts (DC-05).
 */

export interface DateRange {
  from: string; // SAST date 'YYYY-MM-DD', inclusive
  to: string; // SAST date 'YYYY-MM-DD', inclusive
}

export interface Aggregates {
  /** provider_id -> 24 hour-of-day counts (SAST). */
  byHour: Record<string, number[]>;
  /** provider_id -> 7 day-of-week counts (SAST, 0 = Sunday). */
  byDow: Record<string, number[]>;
  /** provider_id -> date -> count (every date in range present). */
  byDate: Record<string, Record<string, number>>;
  /** '<date>T<hour>' -> was any session observing during that bin? */
  coverage: Record<string, boolean>;
  /** Total non-tombstoned events in range. */
  total: number;
  /** provider_id -> total non-tombstoned events in range. */
  totalsByProvider: Record<string, number>;
}

export function effectiveTs(e: TapEvent): string {
  return e.synced_offline ? e.device_ts : (e.received_at ?? e.device_ts);
}

export function tombstoneSet(tombstones: Tombstone[]): Set<string> {
  return new Set(tombstones.map((t) => t.event_id));
}

export function aggregate(
  events: TapEvent[],
  tombstones: Tombstone[],
  sessions: Session[],
  providers: Provider[],
  range: DateRange,
  nowMs: number = Date.now()
): Aggregates {
  const dead = tombstoneSet(tombstones);
  const dates = eachSastDate(range.from, range.to);

  const byHour: Record<string, number[]> = {};
  const byDow: Record<string, number[]> = {};
  const byDate: Record<string, Record<string, number>> = {};
  const totalsByProvider: Record<string, number> = {};
  const providerIds = new Set(providers.map((p) => p.id));
  for (const e of events) providerIds.add(e.provider_id);
  for (const pid of providerIds) {
    byHour[pid] = new Array(24).fill(0);
    byDow[pid] = new Array(7).fill(0);
    byDate[pid] = {};
    for (const d of dates) byDate[pid][d] = 0;
    totalsByProvider[pid] = 0;
  }

  let total = 0;
  for (const e of events) {
    if (dead.has(e.id)) continue; // tombstone anti-join
    const ts = effectiveTs(e);
    const date = toSastDate(ts);
    if (date < range.from || date > range.to) continue;
    byHour[e.provider_id][toSastHour(ts)]++;
    byDow[e.provider_id][toSastDow(ts)]++;
    byDate[e.provider_id][date]++;
    totalsByProvider[e.provider_id]++;
    total++;
  }

  // Per-bin session coverage: a bin is covered iff any session interval
  // overlaps it. Open sessions are treated as running until `nowMs`.
  const coverage: Record<string, boolean> = {};
  const intervals = sessions.map((s) => ({
    start: new Date(s.start_ts).getTime(),
    end: s.end_ts ? new Date(s.end_ts).getTime() : nowMs
  }));
  for (const date of dates) {
    for (let hour = 0; hour < 24; hour++) {
      const [binStart, binEnd] = sastBinRangeUtc(date, hour);
      coverage[sastBinKey(date, hour)] = intervals.some(
        (iv) => iv.start < binEnd && iv.end > binStart
      );
    }
  }

  return { byHour, byDow, byDate, coverage, total, totalsByProvider };
}
