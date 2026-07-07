import type { TapQueue } from './queue.ts';
import type { LogRow } from '../lib/types.ts';

/**
 * Undo the last tap of the current session. Append-only: this enqueues a
 * tombstone row — the event itself is NEVER updated or deleted, whether it
 * has synced already or not. Safe no-op when nothing remains to undo.
 */
export function undoLast(queue: TapQueue): LogRow | null {
  return queue.undoLast();
}
