import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { LogRow, Session, TapEvent, Tombstone } from '../lib/types.ts';

export interface ParkSaDb extends DBSchema {
  /** Events awaiting server ack. Removed ONLY after the adapter acks. */
  pendingEvents: { key: string; value: TapEvent };
  /** Tombstones awaiting server ack. */
  pendingTombstones: { key: string; value: Tombstone };
  /** Session rows awaiting server ack (create / end / retroactive end). */
  pendingSessions: { key: string; value: Session };
  /**
   * Full local event log (survives sync AND reload): full event rows plus
   * tombstoned/synced flags, in tap order (seq).
   */
  sessionLog: { key: string; value: LogRow; indexes: { 'by-session': string } };
  /** Small key-value mirror: current session, seq counter. */
  meta: { key: string; value: unknown };
}

export const DB_NAME = 'parksa';

/**
 * Max time to wait for an IndexedDB open (or any boot-path IDB call) before we
 * treat it as a failure. iOS Safari / WebKit (notably Private Browsing) has a
 * long-standing bug where `indexedDB.open()` HANGS: it fires neither `success`
 * nor `error`, so a plain `await openDB(...)` never settles and boot() blanks
 * the page. Racing every boot-path IDB call against this timeout turns a hang
 * into a rejection, so the existing in-memory fallback engages.
 */
export const IDB_OPEN_TIMEOUT_MS = 3000;

/**
 * Race a promise-producing IDB call against a timeout. On timeout we reject so
 * the caller can fall back. A late settlement (the real open eventually
 * resolves AFTER we gave up — common on iOS once the tab regains focus) is
 * swallowed via `onLateResolve` so it neither throws an unhandled rejection nor
 * clobbers the in-memory state we already committed to.
 */
export function withIdbTimeout<T>(
  factory: () => Promise<T>,
  timeoutMs: number,
  onLateResolve?: (value: T) => void
): Promise<T> {
  const pending = factory();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`IndexedDB operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.then(
      (value) => {
        if (settled) {
          // We already timed out; swallow the late success (and let the caller
          // release any resource it opened) rather than resolving twice.
          onLateResolve?.(value);
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return; // late rejection after timeout: swallow.
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function openParkSaDb(
  name: string = DB_NAME,
  timeoutMs: number = IDB_OPEN_TIMEOUT_MS
): Promise<IDBPDatabase<ParkSaDb>> {
  return withIdbTimeout(
    () =>
      openDB<ParkSaDb>(name, 1, {
        upgrade(db) {
          db.createObjectStore('pendingEvents', { keyPath: 'id' });
          db.createObjectStore('pendingTombstones', { keyPath: 'event_id' });
          db.createObjectStore('pendingSessions', { keyPath: 'id' });
          const log = db.createObjectStore('sessionLog', { keyPath: 'id' });
          log.createIndex('by-session', 'session_id');
          db.createObjectStore('meta');
        },
        // If another tab holds an older connection, the open stays blocked and
        // its promise never resolves — the timeout above covers that hang.
        blocked() {
          /* covered by timeout */
        },
        // A newer version elsewhere wants to upgrade: close so we don't block it.
        blocking() {
          /* covered by timeout */
        },
        terminated() {
          /* connection lost; a later call will reopen */
        }
      }),
    timeoutMs,
    // Late open after we already fell back to in-memory: close it so the
    // connection does not linger (and can't block a future upgrade).
    (db) => {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  );
}

/**
 * Count pending (unsynced) events without disturbing anything else. Used by
 * the `?fresh=1` guard (RS-02) to refuse a destructive wipe that would drop
 * unsynced taps. Returns 0 if the database does not yet exist.
 */
export async function countPendingEvents(
  name: string = DB_NAME,
  timeoutMs: number = IDB_OPEN_TIMEOUT_MS
): Promise<number> {
  try {
    // Timeout-guard the WHOLE read (open + count): on iOS a hang here must not
    // stall the ?fresh=1 guard. Treat a hang/failure as "no pending" so boot
    // continues (the destructive-wipe guard errs safe elsewhere).
    return await withIdbTimeout(async () => {
      const db = await openParkSaDb(name, timeoutMs);
      const n = await db.count('pendingEvents');
      db.close();
      return n;
    }, timeoutMs);
  } catch {
    return 0;
  }
}

export function deleteParkSaDb(
  name: string = DB_NAME,
  timeoutMs: number = IDB_OPEN_TIMEOUT_MS
): Promise<void> {
  // Timeout-guard the wipe: `deleteDatabase` can stay `blocked` forever if any
  // connection is open (iOS again). On timeout we reject; the ?fresh=1 caller
  // already swallows that and skips the wipe rather than blanking on boot.
  return withIdbTimeout(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
      }),
    timeoutMs
  );
}

/**
 * In-memory fallback that mimics the subset of the `idb` `IDBPDatabase` surface
 * that {@link TapQueue} uses. Used when `openParkSaDb` rejects (e.g. Safari/
 * WebKit blocking IndexedDB under strict storage rules): the app stays usable
 * with taps held in memory for the session instead of blanking on boot. Data is
 * NOT persisted — it is lost on reload — but the UI mounts and taps still sync.
 */
type MemStoreDef = { keyPath: string | null; indexes?: Record<string, string> };

const MEM_STORES: Record<string, MemStoreDef> = {
  pendingEvents: { keyPath: 'id' },
  pendingTombstones: { keyPath: 'event_id' },
  pendingSessions: { keyPath: 'id' },
  sessionLog: { keyPath: 'id', indexes: { 'by-session': 'session_id' } },
  meta: { keyPath: null }
};

class MemStore {
  private map = new Map<unknown, unknown>();
  constructor(private def: MemStoreDef) {}
  put(value: unknown, key?: unknown): Promise<unknown> {
    const k = this.def.keyPath ? (value as Record<string, unknown>)[this.def.keyPath] : key;
    this.map.set(k, value);
    return Promise.resolve(k);
  }
  get(key: unknown): Promise<unknown> {
    return Promise.resolve(this.map.get(key));
  }
  delete(key: unknown): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }
  getAll(): Promise<unknown[]> {
    return Promise.resolve([...this.map.values()]);
  }
  count(): Promise<number> {
    return Promise.resolve(this.map.size);
  }
  getAllFromIndex(indexName: string, value: unknown): Promise<unknown[]> {
    const field = this.def.indexes?.[indexName];
    if (!field) return Promise.resolve([]);
    return Promise.resolve(
      [...this.map.values()].filter((v) => (v as Record<string, unknown>)[field] === value)
    );
  }
}

/** Create an in-memory database shaped like `IDBPDatabase<ParkSaDb>`. */
export function createInMemoryDb(): IDBPDatabase<ParkSaDb> {
  const stores = new Map<string, MemStore>();
  for (const [name, def] of Object.entries(MEM_STORES)) stores.set(name, new MemStore(def));
  const storeFor = (name: string): MemStore => {
    const s = stores.get(name);
    if (!s) throw new Error(`unknown object store: ${name}`);
    return s;
  };
  const db = {
    get: (storeName: string, key: unknown) => storeFor(storeName).get(key),
    getAll: (storeName: string) => storeFor(storeName).getAll(),
    count: (storeName: string) => storeFor(storeName).count(),
    getAllFromIndex: (storeName: string, indexName: string, value: unknown) =>
      storeFor(storeName).getAllFromIndex(indexName, value),
    transaction: (names: string | string[]) => {
      const involved = Array.isArray(names) ? names : [names];
      return {
        objectStore: (name: string) => storeFor(name),
        get store() {
          return storeFor(involved[0]);
        },
        done: Promise.resolve()
      };
    },
    close: () => {}
  };
  return db as unknown as IDBPDatabase<ParkSaDb>;
}
