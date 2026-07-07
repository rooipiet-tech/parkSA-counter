import type { Provider, Session, ServerEvent, TapEvent, Tombstone } from '../lib/types.ts';

/**
 * Backend adapter contract. Implementations:
 *  - StubAdapter (in-memory, default when no backend env vars are present)
 *  - SupabaseAdapter (thin mirror; never executed in the test loop)
 *  - RestAdapter (Cloudflare Worker + D1; contract-tested over a node D1 shim)
 *
 * Invariants:
 *  - insertEvents is a batch upsert deduplicated on the client-generated UUID
 *    PK; the backend stamps received_at on accept. Events are NEVER updated
 *    or deleted through this interface.
 *  - insertTombstones is idempotent on event_id (append-only undo markers).
 *  - upsertSession is idempotent by session id: insert-or-merge; an existing
 *    row only ever gains end_ts/end_source. Serves create, normal end and
 *    retroactive end. There is NO referential check events.session_id ->
 *    sessions: events may arrive before their session row.
 *  - Provider hide/delete must be refused for is_permanent providers.
 */
export interface BackendAdapter {
  readonly kind: 'stub' | 'supabase' | 'rest';

  insertEvents(events: TapEvent[]): Promise<void>;
  listEvents(): Promise<ServerEvent[]>;

  insertTombstones(tombstones: Tombstone[]): Promise<void>;
  listTombstones(): Promise<Tombstone[]>;

  upsertSession(session: Session): Promise<void>;
  listSessions(): Promise<Session[]>;

  listProviders(): Promise<Provider[]>;
  addProvider(provider: Provider): Promise<void>;
  renameProvider(id: string, name: string): Promise<void>;
  setProviderHidden(id: string, hidden: boolean): Promise<void>;
  reorderProviders(orderedIds: string[]): Promise<void>;
  deleteProvider(id: string): Promise<void>;

  /** Server clock in epoch ms — used for the clock-skew audit (DC-08). */
  getServerTime(): Promise<number>;
}
