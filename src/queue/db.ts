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

export function deleteParkSaDb(name: string = DB_NAME): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
