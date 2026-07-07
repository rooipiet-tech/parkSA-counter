import type { BackendAdapter } from './types.ts';
import type { Provider, Session, ServerEvent, TapEvent, Tombstone } from '../lib/types.ts';

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export interface RestAdapterOptions {
  baseUrl: string;
  pin: string;
  fetchImpl?: FetchImpl;
}

/**
 * Cloudflare Worker + D1 backend adapter. Thin, faithful mirror of the
 * contract-tested stub semantics — all logic lives server-side in
 * worker/handlers.ts; this class only marshals HTTP.
 *
 * Hard rules (enforced by the Worker, respected here):
 *  - events: INSERT OR IGNORE server-side (idempotent re-sends, L-0004);
 *    received_at is stamped by the server, NEVER sent by the client.
 *  - tombstones: idempotent INSERT on event_id (append-only undo).
 *  - sessions: insert-if-absent, then end touches ONLY end_ts/end_source.
 *  - permanent providers refuse hide/delete (server returns an error we throw).
 *  - list reads paginate (loop until a short page) so >1000 rows round-trip
 *    without silent truncation (L-0006).
 * The shared bearer PIN is sent on every request; the Worker validates it.
 */
export class RestAdapter implements BackendAdapter {
  readonly kind = 'rest' as const;

  private readonly baseUrl: string;
  private readonly pin: string;
  private readonly fetchImpl: FetchImpl;

  private static readonly PAGE = 1000;

  constructor(opts: RestAdapterOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.pin = opts.pin;
    const injected = opts.fetchImpl;
    if (injected) {
      this.fetchImpl = injected;
    } else {
      const g = globalThis as { fetch?: FetchImpl };
      if (!g.fetch) throw new Error('RestAdapter: no fetch implementation available');
      this.fetchImpl = (input, init) => g.fetch!(input, init);
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.pin}`
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let payload: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!res.ok) {
      const msg =
        (payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error: unknown }).error)
          : null) ?? `rest ${method} ${path}: HTTP ${res.status}`;
      throw new Error(msg);
    }
    return payload as T;
  }

  /** Page through a list endpoint until a short page is returned (L-0006). */
  private async listAll<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += RestAdapter.PAGE) {
      const sep = path.includes('?') ? '&' : '?';
      const { rows } = await this.request<{ rows: T[] }>(
        'GET',
        `${path}${sep}limit=${RestAdapter.PAGE}&offset=${offset}`
      );
      out.push(...rows);
      if (rows.length < RestAdapter.PAGE) break;
    }
    return out;
  }

  async insertEvents(events: TapEvent[]): Promise<void> {
    if (events.length === 0) return;
    // Strip any received_at — the server stamps it.
    const rows = events.map(({ received_at: _omit, ...e }) => e);
    await this.request('POST', '/events', { events: rows });
  }

  async listEvents(): Promise<ServerEvent[]> {
    return this.listAll<ServerEvent>('/events');
  }

  async insertTombstones(tombstones: Tombstone[]): Promise<void> {
    if (tombstones.length === 0) return;
    await this.request('POST', '/tombstones', { tombstones });
  }

  async listTombstones(): Promise<Tombstone[]> {
    return this.listAll<Tombstone>('/tombstones');
  }

  async upsertSession(session: Session): Promise<void> {
    await this.request('POST', '/sessions', { session });
  }

  async listSessions(): Promise<Session[]> {
    return this.listAll<Session>('/sessions');
  }

  async listProviders(): Promise<Provider[]> {
    const { rows } = await this.request<{ rows: Provider[] }>('GET', '/providers');
    return rows;
  }

  async addProvider(provider: Provider): Promise<void> {
    await this.request('POST', '/providers', { provider });
  }

  async renameProvider(id: string, name: string): Promise<void> {
    await this.request('POST', '/providers/rename', { id, name });
  }

  async setProviderHidden(id: string, hidden: boolean): Promise<void> {
    await this.request('POST', '/providers/hide', { id, hidden });
  }

  async reorderProviders(orderedIds: string[]): Promise<void> {
    await this.request('POST', '/providers/reorder', { orderedIds });
  }

  async deleteProvider(id: string): Promise<void> {
    await this.request('POST', '/providers/delete', { id });
  }

  async getServerTime(): Promise<number> {
    const { now } = await this.request<{ now: string }>('GET', '/time');
    return new Date(now).getTime();
  }
}

export function createRestAdapter(opts: RestAdapterOptions): BackendAdapter {
  return new RestAdapter(opts);
}
