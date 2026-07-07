import { eachSastDate, sastBinKey, sastBinRangeUtc, toSastDate, toSastDow, toSastHour } from './sast.ts';
import type { Provider, Session, TapDirection, TapEvent, Tombstone } from './types.ts';

/** A value split by tap direction (drop-off vs pick-up), alongside a total. */
export interface DirSplit<T> {
  dropoff: T;
  pickup: T;
}

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
  /** provider_id -> 24 hour-of-day counts (SAST), both directions combined. */
  byHour: Record<string, number[]>;
  /** provider_id -> 7 day-of-week counts (SAST, 0 = Sunday), combined. */
  byDow: Record<string, number[]>;
  /** provider_id -> date -> count (every date in range present), combined. */
  byDate: Record<string, Record<string, number>>;
  /** AD-4: same cuts split by direction. dropoff + pickup === the combined cut. */
  byHourDir: Record<string, DirSplit<number[]>>;
  byDowDir: Record<string, DirSplit<number[]>>;
  byDateDir: Record<string, DirSplit<Record<string, number>>>;
  /** '<date>T<hour>' -> was any session observing during that bin? */
  coverage: Record<string, boolean>;
  /** Total non-tombstoned events in range. */
  total: number;
  /** provider_id -> total non-tombstoned events in range (combined). */
  totalsByProvider: Record<string, number>;
  /** provider_id -> per-direction totals in range. */
  totalsByProviderDir: Record<string, DirSplit<number>>;
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
  const byHourDir: Record<string, DirSplit<number[]>> = {};
  const byDowDir: Record<string, DirSplit<number[]>> = {};
  const byDateDir: Record<string, DirSplit<Record<string, number>>> = {};
  const totalsByProvider: Record<string, number> = {};
  const totalsByProviderDir: Record<string, DirSplit<number>> = {};
  const providerIds = new Set(providers.map((p) => p.id));
  for (const e of events) providerIds.add(e.provider_id);
  const zeroDates = (): Record<string, number> => {
    const o: Record<string, number> = {};
    for (const d of dates) o[d] = 0;
    return o;
  };
  for (const pid of providerIds) {
    byHour[pid] = new Array(24).fill(0);
    byDow[pid] = new Array(7).fill(0);
    byDate[pid] = zeroDates();
    byHourDir[pid] = { dropoff: new Array(24).fill(0), pickup: new Array(24).fill(0) };
    byDowDir[pid] = { dropoff: new Array(7).fill(0), pickup: new Array(7).fill(0) };
    byDateDir[pid] = { dropoff: zeroDates(), pickup: zeroDates() };
    totalsByProvider[pid] = 0;
    totalsByProviderDir[pid] = { dropoff: 0, pickup: 0 };
  }

  let total = 0;
  for (const e of events) {
    if (dead.has(e.id)) continue; // tombstone anti-join
    const ts = effectiveTs(e);
    const date = toSastDate(ts);
    if (date < range.from || date > range.to) continue;
    const hour = toSastHour(ts);
    const dow = toSastDow(ts);
    const dir: TapDirection = e.direction === 'pickup' ? 'pickup' : 'dropoff';
    byHour[e.provider_id][hour]++;
    byDow[e.provider_id][dow]++;
    byDate[e.provider_id][date]++;
    totalsByProvider[e.provider_id]++;
    byHourDir[e.provider_id][dir][hour]++;
    byDowDir[e.provider_id][dir][dow]++;
    byDateDir[e.provider_id][dir][date]++;
    totalsByProviderDir[e.provider_id][dir]++;
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

  return {
    byHour,
    byDow,
    byDate,
    byHourDir,
    byDowDir,
    byDateDir,
    coverage,
    total,
    totalsByProvider,
    totalsByProviderDir
  };
}
