import { effectiveTs, tombstoneSet, type DateRange } from './aggregate.ts';
import { eachSastDate, sastBinRangeUtc, toSastDate, toSastHour } from './sast.ts';
import type { Provider, Session, TapEvent, Tombstone } from './types.ts';

/** Frozen raw-events CSV header (AC-19/AC-25, amended by AD-5: `direction`
 *  inserted after provider_name). Do not reorder. */
export const RAW_CSV_HEADER =
  'provider_id,provider_name,direction,event_id,device_ts,received_at,synced_offline,session_id,observer_label,location_label,tombstoned,clock_suspect';

/** Frozen coverage CSV header. */
export const COVERAGE_CSV_HEADER = 'date,hour,covered,event_count';

/** Leading chars that spreadsheet apps interpret as a formula (CSV injection). */
const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

function csvField(v: string | number | boolean): string {
  let s = String(v);
  // RS-01: neutralize formula injection. A field beginning with =,+,-,@,tab or
  // CR is prefixed with a single quote AND force-quoted so Excel/Sheets treat
  // it as literal text (provider names are attacker-influenceable via rename).
  const injectable = FORMULA_PREFIX_RE.test(s);
  if (injectable) s = `'${s}`;
  return injectable || /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface CsvInputs {
  events: TapEvent[];
  tombstones: Tombstone[];
  providers: Provider[];
  range: DateRange;
}

/**
 * Raw events CSV over a SAST date range (filtered on the DC-06 effective
 * timestamp). Includes tombstoned events, flagged in the `tombstoned`
 * column. Deterministic: sorted by effective ts, then event id.
 */
export function exportCsv({ events, tombstones, providers, range }: CsvInputs): string {
  const dead = tombstoneSet(tombstones);
  const names = new Map(providers.map((p) => [p.id, p.name]));
  const rows = events
    .filter((e) => {
      const d = toSastDate(effectiveTs(e));
      return d >= range.from && d <= range.to;
    })
    .sort((a, b) => {
      const ta = effectiveTs(a);
      const tb = effectiveTs(b);
      return ta < tb ? -1 : ta > tb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((e) =>
      [
        e.provider_id,
        names.get(e.provider_id) ?? e.provider_id,
        e.direction,
        e.id,
        e.device_ts,
        e.received_at ?? '',
        e.synced_offline,
        e.session_id,
        e.observer_label,
        e.location_label,
        dead.has(e.id),
        e.clock_suspect
      ]
        .map(csvField)
        .join(',')
    );
  return [RAW_CSV_HEADER, ...rows].join('\n') + '\n';
}

export interface CoverageCsvInputs {
  events: TapEvent[];
  tombstones: Tombstone[];
  sessions: Session[];
  range: DateRange;
  nowMs?: number;
}

/**
 * Coverage CSV: one row per date x hour bin in range. `covered` is true iff
 * any session interval overlaps the bin; `event_count` counts non-tombstoned
 * events whose effective timestamp falls in the bin. Distinguishes
 * zero-demand bins (covered, 0) from unobserved bins (not covered).
 */
export function exportCoverageCsv({
  events,
  tombstones,
  sessions,
  range,
  nowMs
}: CoverageCsvInputs): string {
  const dead = tombstoneSet(tombstones);
  const now = nowMs ?? Date.now();
  const counts = new Map<string, number>();
  for (const e of events) {
    if (dead.has(e.id)) continue;
    const ts = effectiveTs(e);
    const date = toSastDate(ts);
    if (date < range.from || date > range.to) continue;
    const key = `${date}|${toSastHour(ts)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const intervals = sessions.map((s) => ({
    start: new Date(s.start_ts).getTime(),
    end: s.end_ts ? new Date(s.end_ts).getTime() : now
  }));
  const rows: string[] = [];
  for (const date of eachSastDate(range.from, range.to)) {
    for (let hour = 0; hour < 24; hour++) {
      const [binStart, binEnd] = sastBinRangeUtc(date, hour);
      const covered = intervals.some((iv) => iv.start < binEnd && iv.end > binStart);
      const count = counts.get(`${date}|${hour}`) ?? 0;
      rows.push([date, hour, covered, count].map(csvField).join(','));
    }
  }
  return [COVERAGE_CSV_HEADER, ...rows].join('\n') + '\n';
}
