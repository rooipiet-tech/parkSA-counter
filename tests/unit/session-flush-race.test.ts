import { describe, expect, it } from 'vitest';
import { StubAdapter } from '../../src/adapters/stub.ts';
import type { BackendAdapter } from '../../src/adapters/types.ts';
import type { Provider, Session, TapEvent, Tombstone } from '../../src/lib/types.ts';
import { openTestQueue } from './helpers.ts';

/**
 * Adapter that lets a test run arbitrary work AFTER a session upsert is
 * accepted by the (stub) server but BEFORE the queue's local delete-if-unchanged
 * step — the exact window of the OR-F1 lost-update race.
 */
class RacingAdapter implements BackendAdapter {
  readonly kind = 'stub' as const;
  private inner = new StubAdapter();
  onOpenUpsert: (() => Promise<void>) | null = null;

  async upsertSession(s: Session): Promise<void> {
    await this.inner.upsertSession(s);
    if (s.end_ts == null && this.onOpenUpsert) {
      const fn = this.onOpenUpsert;
      this.onOpenUpsert = null;
      await fn(); // e.g. endSession() fires HERE, between ack and local delete
    }
  }

  insertEvents(e: TapEvent[]): Promise<void> {
    return this.inner.insertEvents(e);
  }
  listEvents() {
    return this.inner.listEvents();
  }
  insertTombstones(t: Tombstone[]): Promise<void> {
    return this.inner.insertTombstones(t);
  }
  listTombstones() {
    return this.inner.listTombstones();
  }
  listSessions() {
    return this.inner.listSessions();
  }
  listProviders() {
    return this.inner.listProviders();
  }
  addProvider(p: Provider): Promise<void> {
    return this.inner.addProvider(p);
  }
  renameProvider(id: string, name: string): Promise<void> {
    return this.inner.renameProvider(id, name);
  }
  setProviderHidden(id: string, hidden: boolean): Promise<void> {
    return this.inner.setProviderHidden(id, hidden);
  }
  reorderProviders(ids: string[]): Promise<void> {
    return this.inner.reorderProviders(ids);
  }
  deleteProvider(id: string): Promise<void> {
    return this.inner.deleteProvider(id);
  }
  getServerTime() {
    return this.inner.getServerTime();
  }
}

describe('pendingSessions lost-update race (OR-F1 / AC-10)', () => {
  it('an endSession racing the in-flight open-session upsert still syncs end_ts', async () => {
    const { queue, session } = await openTestQueue();
    const adapter = new RacingAdapter();

    // While the OPEN session row is being acked, end the session — this updates
    // the pendingSessions row to carry end_ts/end_source.
    adapter.onOpenUpsert = () => queue.endSession();

    // First flush: upserts the open row, the race ends the session, and the
    // delete-if-unchanged guard must NOT drop the newly-ended row.
    await queue.flush(adapter);

    let rows = await adapter.listSessions();
    expect(rows).toHaveLength(1);
    // The open row still exists locally (was not deleted), so a second flush
    // delivers the end_ts to the server.
    await queue.flush(adapter);

    rows = await adapter.listSessions();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(session!.id);
    expect(rows[0].end_ts).toBeTruthy(); // end_ts survived the race
    expect(rows[0].end_source).toBe('normal');
  });
});
