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

export function openParkSaDb(name: string = DB_NAME): Promise<IDBPDatabase<ParkSaDb>> {
  return openDB<ParkSaDb>(name, 1, {
    upgrade(db) {
      db.createObjectStore('pendingEvents', { keyPath: 'id' });
      db.createObjectStore('pendingTombstones', { keyPath: 'event_id' });
      db.createObjectStore('pendingSessions', { keyPath: 'id' });
      const log = db.createObjectStore('sessionLog', { keyPath: 'id' });
      log.createIndex('by-session', 'session_id');
      db.createObjectStore('meta');
    }
  });
}

/**
 * Count pending (unsynced) events without disturbing anything else. Used by
 * the `?fresh=1` guard (RS-02) to refuse a destructive wipe that would drop
 * unsynced taps. Returns 0 if the database does not yet exist.
 */
export async function countPendingEvents(name: string = DB_NAME): Promise<number> {
  try {
    const db = await openParkSaDb(name);
    const n = await db.count('pendingEvents');
    db.close();
    return n;
  } catch {
    return 0;
  }
}

export function deleteParkSaDb(name: string = DB_NAME): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
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
