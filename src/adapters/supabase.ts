import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { BackendAdapter } from './types.ts';
import type { Provider, Session, ServerEvent, TapEvent, Tombstone } from '../lib/types.ts';

/**
 * Real Supabase adapter. Thin mirror of the contract-tested stub semantics.
 *
 * Hard rules (enforced server-side by RLS + column grants, respected here):
 *  - events: INSERT only (upsert with ignoreDuplicates for idempotent
 *    re-sends). NEVER updated, NEVER deleted.
 *  - tombstones: idempotent INSERT on event_id (append-only undo).
 *  - sessions: insert once; updates touch ONLY end_ts/end_source (the anon
 *    role's UPDATE grant is limited to exactly those two columns).
 *  - permanent providers refuse hide/delete (also enforced by a DB trigger).
 */
export class SupabaseAdapter implements BackendAdapter {
  readonly kind = 'supabase' as const;
  private client: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey);
  }

  /**
   * PERF-01/RS-03: PostgREST caps a single response at ~1000 rows, silently
   * truncating large reads. Page through with .range() until a short page is
   * returned so dashboards/CSV over a seeded month (>1000 events) are complete.
   */
  private async selectAll<T>(table: string, orderBy?: string): Promise<T[]> {
    const PAGE = 1000;
    const out: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      let q = this.client.from(table).select('*').range(offset, offset + PAGE - 1);
      if (orderBy) q = q.order(orderBy, { ascending: true });
      const { data, error } = await q;
      if (error) throw new Error(`supabase ${table} read: ${error.message}`);
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  }

  async insertEvents(events: TapEvent[]): Promise<void> {
    if (events.length === 0) return;
    // received_at is stamped by the DB (DEFAULT now()); never sent by the client.
    const rows = events.map(({ received_at: _omit, ...e }) => e);
    const { error } = await this.client
      .from('events')
      .upsert(rows, { ignoreDuplicates: true });
    if (error) throw new Error(`supabase insertEvents: ${error.message}`);
  }

  async listEvents(): Promise<ServerEvent[]> {
    return this.selectAll<ServerEvent>('events');
  }

  async insertTombstones(tombstones: Tombstone[]): Promise<void> {
    if (tombstones.length === 0) return;
    const { error } = await this.client
      .from('tombstones')
      .upsert(tombstones, { ignoreDuplicates: true });
    if (error) throw new Error(`supabase insertTombstones: ${error.message}`);
  }

  async listTombstones(): Promise<Tombstone[]> {
    return this.selectAll<Tombstone>('tombstones');
  }

  async upsertSession(session: Session): Promise<void> {
    // Insert-if-absent (idempotent re-send is a no-op)...
    const insertRow: Session = {
      id: session.id,
      start_ts: session.start_ts,
      observer_label: session.observer_label,
      location_label: session.location_label
    };
    const { error: insertError } = await this.client
      .from('sessions')
      .upsert(insertRow, { ignoreDuplicates: true });
    if (insertError) throw new Error(`supabase upsertSession insert: ${insertError.message}`);
    // ...then, if ended, update ONLY end_ts/end_source (matches the
    // column-level GRANT UPDATE (end_ts, end_source) in the migration).
    if (session.end_ts != null) {
      const { error: updateError } = await this.client
        .from('sessions')
        .update({ end_ts: session.end_ts, end_source: session.end_source ?? 'normal' })
        .eq('id', session.id);
      if (updateError) throw new Error(`supabase upsertSession end: ${updateError.message}`);
    }
  }

  async listSessions(): Promise<Session[]> {
    return this.selectAll<Session>('sessions');
  }

  async listProviders(): Promise<Provider[]> {
    const { data, error } = await this.client
      .from('providers')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw new Error(`supabase listProviders: ${error.message}`);
    return (data ?? []) as Provider[];
  }

  async addProvider(provider: Provider): Promise<void> {
    const { error } = await this.client
      .from('providers')
      .upsert(provider, { ignoreDuplicates: true });
    if (error) throw new Error(`supabase addProvider: ${error.message}`);
  }

  async renameProvider(id: string, name: string): Promise<void> {
    const { error } = await this.client.from('providers').update({ name }).eq('id', id);
    if (error) throw new Error(`supabase renameProvider: ${error.message}`);
  }

  async setProviderHidden(id: string, hidden: boolean): Promise<void> {
    const providers = await this.listProviders();
    const p = providers.find((x) => x.id === id);
    if (p?.is_permanent && hidden) throw new Error('cannot hide a permanent provider');
    const { error } = await this.client.from('providers').update({ hidden }).eq('id', id);
    if (error) throw new Error(`supabase setProviderHidden: ${error.message}`);
  }

  async reorderProviders(orderedIds: string[]): Promise<void> {
    // OR-F4: mirror the stub — renumber the FULL list contiguously (listed ids
    // first in the given order, then any unlisted providers keeping their prior
    // relative order) so partial-list reorders behave identically both sides.
    const all = await this.listProviders();
    const listed = orderedIds.filter((id) => all.some((p) => p.id === id));
    const rest = all.filter((p) => !listed.includes(p.id)).map((p) => p.id);
    let order = 1;
    for (const id of [...listed, ...rest]) {
      const { error } = await this.client
        .from('providers')
        .update({ sort_order: order++ })
        .eq('id', id);
      if (error) throw new Error(`supabase reorderProviders: ${error.message}`);
    }
  }

  async deleteProvider(_id: string): Promise<void> {
    // The anon role has no DELETE policy on providers; refuse client-side too.
    throw new Error('deleting providers is not supported (hide them instead)');
  }

  async getServerTime(): Promise<number> {
    const { data, error } = await this.client.rpc('server_now');
    if (error) throw new Error(`supabase getServerTime: ${error.message}`);
    return new Date(data as string).getTime();
  }
}

export function createSupabaseAdapter(url: string, anonKey: string): BackendAdapter {
  return new SupabaseAdapter(url, anonKey);
}
