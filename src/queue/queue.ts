import type { IDBPDatabase } from 'idb';
import { openParkSaDb, DB_NAME, type ParkSaDb } from './db.ts';
import { newId } from '../lib/ids.ts';
import type { BackendAdapter } from '../adapters/types.ts';
import type { LogRow, QueueState, Session, TapDirection, TapEvent } from '../lib/types.ts';

export interface TapQueueOptions {
  dbName?: string;
  /** True when taps must be flagged synced_offline (computed at enqueue). */
  isOffline: () => boolean;
  now?: () => number;
}

const CLOCK_SKEW_LIMIT_MS = 120_000; // DC-08: |skew| > 120s => clock_suspect

/**
 * Offline-first tap queue over IndexedDB.
 *
 * - enqueueTap appends synchronously to an in-memory mirror of the current
 *   session's log (so the UI can update in the same tick) and writes BOTH the
 *   pendingEvents row and the sessionLog row in one transaction issued in
 *   that same synchronous tick.
 * - pending rows are removed ONLY after the adapter acks (idempotent
 *   re-sends are safe: the client UUID is the PK).
 * - undo appends a tombstone; events are never updated or deleted.
 */
export class TapQueue {
  private db: IDBPDatabase<ParkSaDb>;
  private opts: Required<Pick<TapQueueOptions, 'isOffline' | 'now'>>;
  private mirror: LogRow[] = [];
  private seq = 0;
  private session: Session | null = null;
  private listeners = new Set<() => void>();
  private flushing: Promise<void> | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();

  private constructor(db: IDBPDatabase<ParkSaDb>, opts: TapQueueOptions) {
    this.db = db;
    this.opts = { isOffline: opts.isOffline, now: opts.now ?? (() => Date.now()) };
  }

  static async open(opts: TapQueueOptions): Promise<TapQueue> {
    const db = await openParkSaDb(opts.dbName ?? DB_NAME);
    const q = new TapQueue(db, opts);
    const session = (await db.get('meta', 'currentSession')) as Session | undefined;
    const seq = (await db.get('meta', 'seq')) as number | undefined;
    q.seq = seq ?? 0;
    if (session && session.end_ts == null) {
      // F10: reload RESUMES the mirrored current session.
      q.session = session;
      const rows = await db.getAllFromIndex('sessionLog', 'by-session', session.id);
      q.mirror = rows.sort((a, b) => a.seq - b.seq);
    }
    return q;
  }

  // ---- change notification --------------------------------------------------

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  /** Serialise IDB writes so read-backs always observe prior writes. */
  private chain<T>(work: () => Promise<T>): Promise<T> {
    const p = this.writeChain.then(work, work);
    this.writeChain = p.catch(() => undefined);
    return p;
  }

  // ---- session --------------------------------------------------------------

  currentSession(): Session | null {
    return this.session;
  }

  /** Start a new session: queues the session row + mirrors it for reload. */
  startSession(session: Session): Promise<void> {
    this.session = session;
    this.mirror = [];
    const p = this.chain(async () => {
      const tx = this.db.transaction(['pendingSessions', 'meta'], 'readwrite');
      await tx.objectStore('pendingSessions').put({ ...session });
      await tx.objectStore('meta').put({ ...session }, 'currentSession');
      await tx.done;
    });
    this.notify();
    return p;
  }

  /** End the current session (end_source='normal'). */
  endSession(): Promise<void> {
    const session = this.session;
    if (!session) return Promise.resolve();
    const ended: Session = {
      ...session,
      end_ts: new Date(this.opts.now()).toISOString(),
      end_source: 'normal'
    };
    this.session = null;
    const p = this.chain(async () => {
      const tx = this.db.transaction(['pendingSessions', 'meta'], 'readwrite');
      await tx.objectStore('pendingSessions').put(ended);
      await tx.objectStore('meta').delete('currentSession');
      await tx.done;
    });
    this.notify();
    return p;
  }

  /**
   * Retroactively close a stale session that was never ended. This is the
   * ONLY path that produces end_source='retroactive'; it never runs
   * automatically against the session being resumed on reload (F10).
   */
  closeSessionRetroactively(session: Session, endTs?: string): Promise<void> {
    const ended: Session = {
      ...session,
      end_ts: endTs ?? new Date(this.opts.now()).toISOString(),
      end_source: 'retroactive'
    };
    if (this.session?.id === session.id) this.session = null;
    const p = this.chain(async () => {
      const tx = this.db.transaction(['pendingSessions', 'meta'], 'readwrite');
      await tx.objectStore('pendingSessions').put(ended);
      const cur = (await tx.objectStore('meta').get('currentSession')) as Session | undefined;
      if (cur?.id === session.id) await tx.objectStore('meta').delete('currentSession');
      await tx.done;
    });
    this.notify();
    return p;
  }

  // ---- taps -------------------------------------------------------------------

  /**
   * Record a tap. Synchronous from the caller's point of view: the mirror is
   * updated and listeners fire before this returns; the IDB writes for BOTH
   * pendingEvents and sessionLog are issued in this same tick (one tx).
   */
  enqueueTap(providerId: string, direction: TapDirection): LogRow {
    const session = this.session;
    if (!session) throw new Error('no active session');
    const row: LogRow = {
      id: newId(),
      provider_id: providerId,
      direction,
      device_ts: new Date(this.opts.now()).toISOString(),
      session_id: session.id,
      observer_label: session.observer_label,
      location_label: session.location_label,
      synced_offline: this.opts.isOffline(),
      clock_suspect: false,
      seq: ++this.seq,
      tombstoned: false,
      synced: false
    };
    this.mirror.push(row);
    this.chain(async () => {
      const tx = this.db.transaction(['pendingEvents', 'sessionLog', 'meta'], 'readwrite');
      const { seq: _s, tombstoned: _t, synced: _y, ...event } = row;
      await tx.objectStore('pendingEvents').put(event);
      await tx.objectStore('sessionLog').put({ ...row });
      await tx.objectStore('meta').put(this.seq, 'seq');
      await tx.done;
    });
    this.notify();
    return row;
  }

  /**
   * Session tally for one half of a provider tile: non-tombstoned taps of the
   * given (provider, direction) in the current session.
   */
  getCountFor(providerId: string, direction: TapDirection): number {
    return this.mirror.filter(
      (r) => r.provider_id === providerId && r.direction === direction && !r.tombstoned
    ).length;
  }

  /** Per-(provider, direction) tallies keyed `${provider_id}|${direction}`. */
  getCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const r of this.mirror) {
      if (r.tombstoned) continue;
      const key = `${r.provider_id}|${r.direction}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  // ---- undo (append-only tombstones) -------------------------------------------

  /**
   * Undo the last non-tombstoned tap of the current session by APPENDING a
   * tombstone. The event row is never removed. Safe no-op when empty.
   */
  undoLast(): LogRow | null {
    let target: LogRow | null = null;
    for (let i = this.mirror.length - 1; i >= 0; i--) {
      if (!this.mirror[i].tombstoned) {
        target = this.mirror[i];
        break;
      }
    }
    if (!target) return null;
    target.tombstoned = true;
    const tombstone = { event_id: target.id, created_at: new Date(this.opts.now()).toISOString() };
    const targetId = target.id;
    this.chain(async () => {
      const tx = this.db.transaction(['pendingTombstones', 'sessionLog'], 'readwrite');
      await tx.objectStore('pendingTombstones').put(tombstone);
      // OR-F5: re-read the stored row and merge ONLY the tombstoned flag, so a
      // concurrent flush ack that set synced=true on this row is not clobbered
      // back to a stale copy (post-reload agent reads stay correct).
      const stored = await tx.objectStore('sessionLog').get(targetId);
      if (stored) await tx.objectStore('sessionLog').put({ ...stored, tombstoned: true });
      await tx.done;
    });
    this.notify();
    return target;
  }

  // ---- inspection ---------------------------------------------------------------

  async getQueueState(): Promise<QueueState> {
    await this.writeChain.catch(() => undefined);
    const pendingCount = await this.db.count('pendingEvents');
    return {
      events: this.mirror.map(({ seq: _s, ...rest }) => ({ ...rest })),
      pendingCount
    };
  }

  async pendingCount(): Promise<number> {
    await this.writeChain.catch(() => undefined);
    return this.db.count('pendingEvents');
  }

  // ---- flush -----------------------------------------------------------------------

  /**
   * Flush order (load-bearing, see plan F4): (1) sessions, (2) skew
   * measurement, (3) events, (4) tombstones. Pending rows are deleted only
   * after the adapter acks; sessionLog rows are then marked synced=true.
   * Throws on failure so the sync engine can back off.
   */
  flush(adapter: BackendAdapter): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.doFlush(adapter).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(adapter: BackendAdapter): Promise<void> {
    await this.writeChain.catch(() => undefined);

    // (1) sessions first: best-effort ordering so events usually find their
    // session row on the server (no FK though — see migration).
    const sessions = await this.db.getAll('pendingSessions');
    for (const s of sessions) {
      await adapter.upsertSession(s);
      // OR-F1: an endSession/retroactive-close can update this row while the
      // upsert above is in-flight. Delete ONLY if the row is byte-for-byte the
      // copy we just acked; otherwise leave it queued so the newer end_ts/
      // end_source syncs on the next flush (never a lost update).
      const tx = this.db.transaction('pendingSessions', 'readwrite');
      const current = (await tx.store.get(s.id)) as Session | undefined;
      const unchanged =
        current != null &&
        (current.end_ts ?? null) === (s.end_ts ?? null) &&
        (current.end_source ?? null) === (s.end_source ?? null);
      if (unchanged) await tx.store.delete(s.id);
      await tx.done;
    }

    // (2) clock-skew measurement for this batch (DC-08).
    const serverTime = await adapter.getServerTime();
    const skew = this.opts.now() - serverTime;
    const suspect = Math.abs(skew) > CLOCK_SKEW_LIMIT_MS;

    // (3) events.
    const pending = await this.db.getAll('pendingEvents');
    if (pending.length > 0) {
      const batch: TapEvent[] = pending.map((e) => ({
        ...e,
        clock_suspect: e.clock_suspect || suspect
      }));
      await adapter.insertEvents(batch);
      // Ack received: now (and only now) drop from pending + mark synced.
      const tx = this.db.transaction(['pendingEvents', 'sessionLog'], 'readwrite');
      for (const e of batch) {
        await tx.objectStore('pendingEvents').delete(e.id);
        const logRow = await tx.objectStore('sessionLog').get(e.id);
        if (logRow) {
          await tx.objectStore('sessionLog').put({ ...logRow, synced: true, clock_suspect: e.clock_suspect });
        }
      }
      await tx.done;
      for (const row of this.mirror) {
        if (batch.some((e) => e.id === row.id)) row.synced = true;
      }
    }

    // (4) tombstones.
    const tombstones = await this.db.getAll('pendingTombstones');
    if (tombstones.length > 0) {
      await adapter.insertTombstones(tombstones);
      const tx = this.db.transaction('pendingTombstones', 'readwrite');
      for (const t of tombstones) await tx.store.delete(t.event_id);
      await tx.done;
    }

    this.notify();
  }

  close(): void {
    this.db.close();
  }
}
