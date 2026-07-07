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
