/**
 * SAST (South African Standard Time, Africa/Johannesburg) binning.
 *
 * This is the SINGLE timezone conversion point for the whole app (DC-05).
 * South Africa observes a fixed UTC+2 offset year-round (no DST), so the
 * conversion is a constant shift. NO other module may perform its own
 * UTC-offset arithmetic — everything (aggregation, CSV, coverage, seed
 * generation) must import these helpers.
 */

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000; // UTC+2, fixed (no DST in South Africa)

export const DOW_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
] as const;

type TsInput = string | number | Date;

function toMs(ts: TsInput): number {
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'number') return ts;
  return new Date(ts).getTime();
}

/** A Date whose UTC fields read as SAST wall-clock fields. Internal only. */
function shifted(ts: TsInput): Date {
  return new Date(toMs(ts) + SAST_OFFSET_MS);
}

/** Hour-of-day 0-23 in SAST. */
export function toSastHour(ts: TsInput): number {
  return shifted(ts).getUTCHours();
}

/** Calendar date 'YYYY-MM-DD' in SAST. */
export function toSastDate(ts: TsInput): string {
  const d = shifted(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Day-of-week in SAST: 0 = Sunday ... 6 = Saturday. */
export function toSastDow(ts: TsInput): number {
  return shifted(ts).getUTCDay();
}

/** Day-of-week name in SAST ('Sunday'...'Saturday'). */
export function toSastDowName(ts: TsInput): string {
  return DOW_NAMES[toSastDow(ts)];
}

/**
 * Convert SAST wall-clock components to a UTC epoch-ms instant.
 * `date` is 'YYYY-MM-DD' in SAST.
 */
export function sastToUtcMs(date: string, hour = 0, minute = 0, second = 0, ms = 0): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour, minute, second, ms) - SAST_OFFSET_MS;
}

/** UTC epoch-ms [start, end) of the SAST hour bin `date` x `hour`. */
export function sastBinRangeUtc(date: string, hour: number): [number, number] {
  const start = sastToUtcMs(date, hour);
  return [start, start + 60 * 60 * 1000];
}

/** Add n calendar days to a SAST date string. */
export function addSastDays(date: string, n: number): string {
  const ms = sastToUtcMs(date) + n * 24 * 60 * 60 * 1000;
  return toSastDate(ms);
}

/** Inclusive list of SAST date strings from..to. */
export function eachSastDate(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addSastDays(cur, 1);
  }
  return out;
}

/** Key for a per-bin coverage map entry: '<date>T<hour>' with zero-padded hour. */
export function sastBinKey(date: string, hour: number): string {
  return `${date}T${String(hour).padStart(2, '0')}`;
}
