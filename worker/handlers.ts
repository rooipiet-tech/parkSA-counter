/**
 * Pure Worker handlers implementing the full BackendAdapter contract
 * server-side over a minimal D1-like database interface.
 *
 * The interface below is the subset of the Cloudflare D1 API this module uses:
 *   db.prepare(sql).bind(...args).all()  -> { results: Row[] }
 *   db.prepare(sql).bind(...args).first() -> Row | null
 *   db.prepare(sql).bind(...args).run()   -> unknown
 * Real D1 satisfies it; the test suite provides a better-sqlite3 shim with the
 * same surface (tests/unit/rest-adapter-contract.test.ts). Keeping these
 * handlers free of any Cloudflare-specific types lets the SAME code run in
 * node (tests) and on the edge (runtime) — no test-only construct (L-0002).
 *
 * PII posture (L-0008): rows are stored verbatim; nothing here logs or copies
 * observer_label or any field elsewhere. The caller (worker/index.ts) must not
 * log request bodies either.
 */
import type { Provider, ServerEvent, Session, TapEvent, Tombstone } from '../src/lib/types.ts';

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1Like {
  prepare(sql: string): D1PreparedStatement;
}

/** Server caps a single page; the adapter loops until a short page (L-0006). */
export const PAGE_SIZE = 1000;

const bool = (v: unknown): boolean => v === true || v === 1 || v === '1';
const bit = (v: unknown): number => (v ? 1 : 0);

/** Custom error carrying an HTTP status the Worker surfaces to the adapter. */
export class HandlerError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---- row mappers ----------------------------------------------------------

function toEvent(r: Record<string, unknown>): ServerEvent {
  return {
    id: String(r.id),
    provider_id: String(r.provider_id),
    direction: r.direction === 'pickup' ? 'pickup' : 'dropoff',
    device_ts: String(r.device_ts),
    session_id: String(r.session_id),
    observer_label: String(r.observer_label),
    location_label: String(r.location_label),
    synced_offline: bool(r.synced_offline),
    clock_suspect: bool(r.clock_suspect),
    received_at: String(r.received_at)
  };
}

function toSession(r: Record<string, unknown>): Session {
  return {
    id: String(r.id),
    start_ts: String(r.start_ts),
    end_ts: r.end_ts == null ? null : String(r.end_ts),
    end_source: r.end_source == null ? null : (String(r.end_source) as Session['end_source']),
    observer_label: String(r.observer_label),
    location_label: String(r.location_label)
  };
}

function toProvider(r: Record<string, unknown>): Provider {
  return {
    id: String(r.id),
    name: String(r.name),
    sort_order: Number(r.sort_order),
    hidden: bool(r.hidden),
    is_permanent: bool(r.is_permanent)
  };
}

// ---- events (append-only, idempotent on client UUID PK) -------------------

export async function insertEvents(db: D1Like, events: TapEvent[]): Promise<void> {
  if (!Array.isArray(events) || events.length === 0) return;
  // received_at is stamped by the server ONCE per batch (matches the stub /
  // Postgres DEFAULT now()); never trusted from the client.
  const receivedAt = new Date().toISOString();
  const sql =
    'INSERT OR IGNORE INTO events ' +
    '(id, provider_id, direction, device_ts, session_id, observer_label, location_label, synced_offline, clock_suspect, received_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  for (const e of events) {
    await db
      .prepare(sql)
      .bind(
        e.id,
        e.provider_id,
        e.direction === 'pickup' ? 'pickup' : 'dropoff',
        e.device_ts,
        e.session_id,
        e.observer_label,
        e.location_label,
        bit(e.synced_offline),
        bit(e.clock_suspect),
        receivedAt
      )
      .run();
  }
}

export async function listEvents(db: D1Like, limit = PAGE_SIZE, offset = 0): Promise<ServerEvent[]> {
  const page = Math.min(Math.max(1, limit | 0), PAGE_SIZE);
  const { results } = await db
    .prepare('SELECT * FROM events ORDER BY received_at ASC, id ASC LIMIT ? OFFSET ?')
    .bind(page, Math.max(0, offset | 0))
    .all();
  return results.map(toEvent);
}

// ---- tombstones (append-only undo markers, idempotent on event_id) --------

export async function insertTombstones(db: D1Like, tombstones: Tombstone[]): Promise<void> {
  if (!Array.isArray(tombstones) || tombstones.length === 0) return;
  const sql = 'INSERT OR IGNORE INTO tombstones (event_id, created_at) VALUES (?, ?)';
  for (const t of tombstones) {
    await db.prepare(sql).bind(t.event_id, t.created_at).run();
  }
}

export async function listTombstones(db: D1Like, limit = PAGE_SIZE, offset = 0): Promise<Tombstone[]> {
  const page = Math.min(Math.max(1, limit | 0), PAGE_SIZE);
  const { results } = await db
    .prepare('SELECT event_id, created_at FROM tombstones ORDER BY created_at ASC, event_id ASC LIMIT ? OFFSET ?')
    .bind(page, Math.max(0, offset | 0))
    .all();
  return results.map((r) => ({ event_id: String(r.event_id), created_at: String(r.created_at) }));
}

// ---- sessions -------------------------------------------------------------

export async function upsertSession(db: D1Like, session: Session): Promise<void> {
  // Insert-if-absent (idempotent re-send is a no-op)...
  await db
    .prepare(
      'INSERT OR IGNORE INTO sessions ' +
        '(id, start_ts, end_ts, end_source, observer_label, location_label) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(
      session.id,
      session.start_ts,
      session.end_ts ?? null,
      session.end_source ?? null,
      session.observer_label,
      session.location_label
    )
    .run();
  // ...then, if ended, update ONLY end_ts/end_source on the existing row.
  if (session.end_ts != null) {
    await db
      .prepare('UPDATE sessions SET end_ts = ?, end_source = ? WHERE id = ?')
      .bind(session.end_ts, session.end_source ?? 'normal', session.id)
      .run();
  }
}

export async function listSessions(db: D1Like, limit = PAGE_SIZE, offset = 0): Promise<Session[]> {
  const page = Math.min(Math.max(1, limit | 0), PAGE_SIZE);
  const { results } = await db
    .prepare('SELECT * FROM sessions ORDER BY start_ts ASC, id ASC LIMIT ? OFFSET ?')
    .bind(page, Math.max(0, offset | 0))
    .all();
  return results.map(toSession);
}

// ---- providers ------------------------------------------------------------

export async function listProviders(db: D1Like): Promise<Provider[]> {
  const { results } = await db
    .prepare('SELECT * FROM providers ORDER BY sort_order ASC, id ASC')
    .bind()
    .all();
  return results.map(toProvider);
}

async function getProvider(db: D1Like, id: string): Promise<Provider | null> {
  const row = await db.prepare('SELECT * FROM providers WHERE id = ?').bind(id).first();
  return row ? toProvider(row) : null;
}

export async function addProvider(db: D1Like, provider: Provider): Promise<void> {
  await db
    .prepare(
      'INSERT OR IGNORE INTO providers (id, name, sort_order, hidden, is_permanent) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(provider.id, provider.name, provider.sort_order, bit(provider.hidden), bit(provider.is_permanent))
    .run();
}

export async function renameProvider(db: D1Like, id: string, name: string): Promise<void> {
  const p = await getProvider(db, id);
  if (!p) throw new HandlerError(`no provider ${id}`, 404);
  await db.prepare('UPDATE providers SET name = ? WHERE id = ?').bind(name, id).run();
}

export async function setProviderHidden(db: D1Like, id: string, hidden: boolean): Promise<void> {
  const p = await getProvider(db, id);
  if (!p) throw new HandlerError(`no provider ${id}`, 404);
  if (p.is_permanent && hidden) throw new HandlerError('cannot hide a permanent provider', 400);
  await db.prepare('UPDATE providers SET hidden = ? WHERE id = ?').bind(bit(hidden), id).run();
}

export async function reorderProviders(db: D1Like, orderedIds: string[]): Promise<void> {
  // Renumber the FULL list contiguously: listed ids first (in the given order),
  // then any unlisted providers keeping their prior relative order — identical
  // to the stub/Supabase behaviour so partial-list reorders match everywhere.
  const all = await listProviders(db);
  const listed = orderedIds.filter((id) => all.some((p) => p.id === id));
  const rest = all.filter((p) => !listed.includes(p.id)).map((p) => p.id);
  let order = 1;
  for (const id of [...listed, ...rest]) {
    await db.prepare('UPDATE providers SET sort_order = ? WHERE id = ?').bind(order++, id).run();
  }
}

export async function deleteProvider(_db: D1Like, _id: string): Promise<void> {
  // Mirror the stub/Supabase: providers are NEVER deleted (hide them instead).
  throw new HandlerError('deleting providers is not supported (hide them instead)', 400);
}

// ---- clock ----------------------------------------------------------------

export function getServerTime(): string {
  return new Date().toISOString();
}
