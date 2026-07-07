import { eachSastDate, sastToUtcMs, toSastDow } from '../lib/sast.ts';
import { SEED_PROVIDERS } from './providers.ts';
import { DEFAULT_LOCATION } from '../lib/types.ts';
import type { Provider, ServerEvent, Session, Tombstone } from '../lib/types.ts';

/**
 * Deterministic synthetic month of observations: 2026-06-01..2026-06-30.
 * Fixed-seed mulberry32 PRNG — every call returns byte-identical data. Used
 * by `npm run seed:month` (writes fixtures/expected-aggregates.json), by the
 * unit tests, and by the stub adapter's `?seed=month` self-seed.
 * All wall-clock arithmetic goes through src/lib/sast.ts (DC-05).
 */

export const SEED_MONTH_RANGE = { from: '2026-06-01', to: '2026-06-30' } as const;

const SEED = 0x5eed2026;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function prngUuid(rand: () => number): string {
  let hex = '';
  for (let i = 0; i < 32; i++) hex += Math.floor(rand() * 16).toString(16);
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-4' +
    hex.slice(13, 16) +
    '-' +
    ((8 + Math.floor(rand() * 4)).toString(16) + hex.slice(17, 20)) +
    '-' +
    hex.slice(20, 32)
  );
}

export interface SeedMonth {
  range: { from: string; to: string };
  providers: Provider[];
  sessions: Session[];
  events: ServerEvent[];
  tombstones: Tombstone[];
}

export function generateMonth(): SeedMonth {
  const rand = mulberry32(SEED);
  const sessions: Session[] = [];
  const events: ServerEvent[] = [];
  const tombstones: Tombstone[] = [];

  const dates = eachSastDate(SEED_MONTH_RANGE.from, SEED_MONTH_RANGE.to);
  for (const date of dates) {
    const dow = toSastDow(sastToUtcMs(date, 12));
    const slots: Array<{ startHour: number; endHour: number; observer: string }> = [
      { startHour: 8, endHour: 12, observer: 'OBS-1' }
    ];
    // Afternoon coverage on weekdays only — leaves visible uncovered bins.
    if (dow >= 1 && dow <= 5) slots.push({ startHour: 13, endHour: 18, observer: 'OBS-2' });

    for (const slot of slots) {
      const startMs = sastToUtcMs(date, slot.startHour);
      const endMs = sastToUtcMs(date, slot.endHour);
      const session: Session = {
        id: prngUuid(rand),
        start_ts: new Date(startMs).toISOString(),
        end_ts: new Date(endMs).toISOString(),
        end_source: rand() < 0.1 ? 'retroactive' : 'normal',
        observer_label: slot.observer,
        location_label: DEFAULT_LOCATION
      };
      sessions.push(session);

      const n = 15 + Math.floor(rand() * 20);
      for (let i = 0; i < n; i++) {
        const provider = SEED_PROVIDERS[Math.floor(rand() * SEED_PROVIDERS.length)];
        const deviceMs = startMs + Math.floor(rand() * (endMs - startMs));
        const syncedOffline = rand() < 0.3;
        const receivedMs = syncedOffline
          ? endMs + Math.floor(rand() * 3_600_000) // synced later, after reconnect
          : deviceMs + 2_000 + Math.floor(rand() * 5_000);
        const event: ServerEvent = {
          id: prngUuid(rand),
          provider_id: provider.id,
          device_ts: new Date(deviceMs).toISOString(),
          received_at: new Date(receivedMs).toISOString(),
          session_id: session.id,
          observer_label: slot.observer,
          location_label: DEFAULT_LOCATION,
          synced_offline: syncedOffline,
          clock_suspect: false
        };
        events.push(event);
        if (rand() < 0.05) {
          tombstones.push({
            event_id: event.id,
            created_at: new Date(receivedMs + 60_000).toISOString()
          });
        }
      }
    }
  }

  return {
    range: { ...SEED_MONTH_RANGE },
    providers: SEED_PROVIDERS.map((p) => ({ ...p })),
    sessions,
    events,
    tombstones
  };
}
