import type { BackendAdapter } from './types.ts';
import type { Provider, Session, ServerEvent, TapEvent, Tombstone } from '../lib/types.ts';
import { SEED_PROVIDERS } from '../seed/providers.ts';

export interface StubSeedData {
  events?: ServerEvent[];
  sessions?: Session[];
  tombstones?: Tombstone[];
  providers?: Provider[];
}

/**
 * In-memory stub backend. Default adapter when no Supabase env vars are set.
 * Mirrors the semantics the Supabase schema enforces server-side:
 *  - events: insert-only, PK dedup on client UUID, received_at stamped here
 *  - tombstones: idempotent insert on event_id
 *  - sessions: idempotent upsert; existing rows only gain end_ts/end_source
 *  - permanent providers refuse hide/delete
 * Includes fault injection + injectable clock offset for tests.
 */
export class StubAdapter implements BackendAdapter {
  readonly kind = 'stub' as const;

  private events = new Map<string, ServerEvent>();
  private tombstones = new Map<string, Tombstone>();
  private sessions = new Map<string, Session>();
  private providers = new Map<string, Provider>();

  private clockOffsetMs = 0;
  private faultsRemaining = 0;
  private failAfterAcceptNext = false;

  constructor() {
    for (const p of SEED_PROVIDERS) this.providers.set(p.id, { ...p });
  }

  // ---- test / agent hooks -------------------------------------------------

  /** Make the next n adapter calls fail before doing any work. */
  injectFaults(n: number): void {
    this.faultsRemaining = n;
  }

  clearFaults(): void {
    this.faultsRemaining = 0;
    this.failAfterAcceptNext = false;
  }

  /** Next insertEvents call APPLIES the writes, then throws (lost-ack). */
  failAfterAcceptOnce(): void {
    this.failAfterAcceptNext = true;
  }

  /** Shift the stub server clock (ms) relative to the device clock. */
  setClockOffset(ms: number): void {
    this.clockOffsetMs = ms;
  }

  /** Bulk-load synthetic data (rows stored as-is, received_at trusted). */
  seed(data: StubSeedData): void {
    if (data.providers) {
      this.providers.clear();
      for (const p of data.providers) this.providers.set(p.id, { ...p });
    }
    for (const e of data.events ?? []) this.events.set(e.id, { ...e });
    for (const s of data.sessions ?? []) this.sessions.set(s.id, { ...s });
    for (const t of data.tombstones ?? []) this.tombstones.set(t.event_id, { ...t });
  }

  private maybeFault(): void {
    if (this.faultsRemaining > 0) {
      this.faultsRemaining--;
      throw new Error('stub: injected fault');
    }
  }

  private serverNow(): number {
    return Date.now() + this.clockOffsetMs;
  }

  // ---- events (append-only) ----------------------------------------------

  async insertEvents(events: TapEvent[]): Promise<void> {
    this.maybeFault();
    const receivedAt = new Date(this.serverNow()).toISOString();
    for (const e of events) {
      if (this.events.has(e.id)) continue; // PK dedup — idempotent re-send
      this.events.set(e.id, { ...e, received_at: receivedAt });
    }
    if (this.failAfterAcceptNext) {
      this.failAfterAcceptNext = false;
      throw new Error('stub: accepted but ack lost');
    }
  }

  async listEvents(): Promise<ServerEvent[]> {
    return [...this.events.values()].map((e) => ({ ...e }));
  }

  // ---- tombstones (append-only undo markers) ------------------------------

  async insertTombstones(tombstones: Tombstone[]): Promise<void> {
    this.maybeFault();
    for (const t of tombstones) {
      if (this.tombstones.has(t.event_id)) continue; // idempotent
      this.tombstones.set(t.event_id, { ...t });
    }
  }

  async listTombstones(): Promise<Tombstone[]> {
    return [...this.tombstones.values()].map((t) => ({ ...t }));
  }

  // ---- sessions ------------------------------------------------------------

  async upsertSession(session: Session): Promise<void> {
    this.maybeFault();
    const existing = this.sessions.get(session.id);
    if (!existing) {
      this.sessions.set(session.id, { ...session });
      return;
    }
    // Existing rows only ever gain end_ts / end_source.
    if (session.end_ts != null) {
      existing.end_ts = session.end_ts;
      existing.end_source = session.end_source ?? existing.end_source;
    }
  }

  async listSessions(): Promise<Session[]> {
    return [...this.sessions.values()].map((s) => ({ ...s }));
  }

  // ---- providers -----------------------------------------------------------

  async listProviders(): Promise<Provider[]> {
    return [...this.providers.values()]
      .map((p) => ({ ...p }))
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  }

  async addProvider(provider: Provider): Promise<void> {
    this.maybeFault();
    if (this.providers.has(provider.id)) return; // idempotent
    this.providers.set(provider.id, { ...provider });
  }

  async renameProvider(id: string, name: string): Promise<void> {
    this.maybeFault();
    const p = this.providers.get(id);
    if (!p) throw new Error(`stub: no provider ${id}`);
    p.name = name;
  }

  async setProviderHidden(id: string, hidden: boolean): Promise<void> {
    this.maybeFault();
    const p = this.providers.get(id);
    if (!p) throw new Error(`stub: no provider ${id}`);
    if (p.is_permanent && hidden) throw new Error('stub: cannot hide a permanent provider');
    p.hidden = hidden;
  }

  async reorderProviders(orderedIds: string[]): Promise<void> {
    this.maybeFault();
    let order = 1;
    for (const id of orderedIds) {
      const p = this.providers.get(id);
      if (p) p.sort_order = order++;
    }
    // Providers not mentioned keep relative order after the listed ones.
    const rest = [...this.providers.values()]
      .filter((p) => !orderedIds.includes(p.id))
      .sort((a, b) => a.sort_order - b.sort_order);
    for (const p of rest) p.sort_order = order++;
  }

  async deleteProvider(id: string): Promise<void> {
    this.maybeFault();
    const p = this.providers.get(id);
    if (!p) return;
    if (p.is_permanent) throw new Error('stub: cannot delete a permanent provider');
    this.providers.delete(id);
  }

  // ---- clock ----------------------------------------------------------------

  async getServerTime(): Promise<number> {
    this.maybeFault();
    return this.serverNow();
  }
}
