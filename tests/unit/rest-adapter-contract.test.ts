import { describe, expect, it } from 'vitest';
import type { BackendAdapter } from '../../src/adapters/types.ts';
import { SEED_PROVIDERS } from '../../src/seed/providers.ts';
import { newId } from '../../src/lib/ids.ts';
import { DEFAULT_LOCATION, type Session, type TapEvent } from '../../src/lib/types.ts';
import { makeRestAdapter } from './worker-d1-shim.ts';

// ---------------------------------------------------------------------------
// Shared fixtures (identical to tests/unit/adapter-contract.test.ts).
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<TapEvent> = {}): TapEvent {
  return {
    id: newId(),
    provider_id: 'mr-parking',
    direction: 'dropoff',
    device_ts: new Date().toISOString(),
    session_id: newId(),
    observer_label: 'OBS-1',
    location_label: DEFAULT_LOCATION,
    synced_offline: false,
    clock_suspect: false,
    ...overrides
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: newId(),
    start_ts: new Date().toISOString(),
    observer_label: 'OBS-1',
    location_label: DEFAULT_LOCATION,
    ...overrides
  };
}

/**
 * The SAME contract as adapter-contract.test.ts, run end-to-end against the
 * RestAdapter -> Worker fetch -> handlers -> better-sqlite3 D1 shim (CB-5).
 */
function contractSuite(name: string, make: () => BackendAdapter) {
  describe(`${name} contract`, () => {
    it('insert-dedup: re-inserting the same event ids never duplicates', async () => {
      const a = make();
      const batch = [makeEvent(), makeEvent(), makeEvent()];
      await a.insertEvents(batch);
      await a.insertEvents(batch);
      await a.insertEvents([batch[0]]);
      expect(await a.listEvents()).toHaveLength(3);
    });

    it('received_at is stamped by the server on accept', async () => {
      const a = make();
      const e = makeEvent();
      expect(e.received_at).toBeUndefined();
      await a.insertEvents([e]);
      const [stored] = await a.listEvents();
      expect(stored.received_at).toBeTruthy();
      expect(Number.isNaN(new Date(stored.received_at).getTime())).toBe(false);
    });

    it('events are accepted before their session row exists (no FK ordering)', async () => {
      const a = make();
      const session = makeSession();
      const e = makeEvent({ session_id: session.id });
      await a.insertEvents([e]); // event first — must NOT be rejected
      expect(await a.listEvents()).toHaveLength(1);
      await a.upsertSession(session); // session arrives later
      expect(await a.listSessions()).toHaveLength(1);
    });

    it('upsertSession is idempotent; existing rows only gain end_ts/end_source', async () => {
      const a = make();
      const s = makeSession();
      await a.upsertSession(s);
      await a.upsertSession(s); // re-send: no-op
      expect(await a.listSessions()).toHaveLength(1);

      const ended: Session = { ...s, end_ts: new Date().toISOString(), end_source: 'normal' };
      await a.upsertSession(ended);
      await a.upsertSession(ended); // idempotent end
      const rows = await a.listSessions();
      expect(rows).toHaveLength(1);
      expect(rows[0].start_ts).toBe(s.start_ts);
      expect(rows[0].end_ts).toBe(ended.end_ts);
      expect(rows[0].end_source).toBe('normal');

      // Retroactive close of another never-ended session.
      const stale = makeSession();
      await a.upsertSession(stale);
      await a.upsertSession({ ...stale, end_ts: new Date().toISOString(), end_source: 'retroactive' });
      const found = (await a.listSessions()).find((x) => x.id === stale.id)!;
      expect(found.end_source).toBe('retroactive');
    });

    it('tombstone insert is idempotent on event_id', async () => {
      const a = make();
      const t = { event_id: newId(), created_at: new Date().toISOString() };
      await a.insertTombstones([t]);
      await a.insertTombstones([t, t]);
      expect(await a.listTombstones()).toHaveLength(1);
    });

    it('provider CRUD: add, rename, hide, reorder', async () => {
      const a = make();
      expect((await a.listProviders()).map((p) => p.name)).toEqual(SEED_PROVIDERS.map((p) => p.name));

      await a.addProvider({ id: 'test-park', name: 'Test Park', sort_order: 99, hidden: false, is_permanent: false });
      expect((await a.listProviders()).some((p) => p.id === 'test-park')).toBe(true);

      await a.renameProvider('mr-parking', 'Mister Parking');
      const renamed = (await a.listProviders()).find((p) => p.id === 'mr-parking')!;
      expect(renamed.name).toBe('Mister Parking');

      await a.setProviderHidden('safe-car', true);
      expect((await a.listProviders()).find((p) => p.id === 'safe-car')!.hidden).toBe(true);

      await a.reorderProviders(['eazypark', 'mr-parking']);
      const ordered = await a.listProviders();
      expect(ordered[0].id).toBe('eazypark');
      expect(ordered[1].id).toBe('mr-parking');
    });

    it('deleteProvider is refused for EVERY id (providers are never deleted) (OR-F4)', async () => {
      const a = make();
      await expect(a.deleteProvider('mr-parking')).rejects.toThrow();
      expect((await a.listProviders()).some((p) => p.id === 'mr-parking')).toBe(true);
      await expect(a.deleteProvider('unknown')).rejects.toThrow();
    });

    it('reorder renumbers the FULL list; unlisted providers follow the listed ones (OR-F4)', async () => {
      const a = make();
      await a.reorderProviders(['eazypark', 'mr-parking']);
      const ordered = await a.listProviders();
      expect(ordered[0].id).toBe('eazypark');
      expect(ordered[1].id).toBe('mr-parking');
      const orders = ordered.map((p) => p.sort_order).sort((x, y) => x - y);
      expect(orders).toEqual(Array.from({ length: ordered.length }, (_, i) => i + 1));
      expect(ordered).toHaveLength(SEED_PROVIDERS.length);
    });

    it('permanent provider (Unknown) refuses hide and delete', async () => {
      const a = make();
      await expect(a.setProviderHidden('unknown', true)).rejects.toThrow();
      await expect(a.deleteProvider('unknown')).rejects.toThrow();
      const unknown = (await a.listProviders()).find((p) => p.id === 'unknown')!;
      expect(unknown.hidden).toBe(false);
      expect(unknown.is_permanent).toBe(true);
      await expect(a.setProviderHidden('unknown', false)).resolves.toBeUndefined();
    });

    it('getServerTime returns an epoch-ms number', async () => {
      const a = make();
      const t = await a.getServerTime();
      expect(typeof t).toBe('number');
      expect(Math.abs(t - Date.now())).toBeLessThan(5_000);
    });

    it('direction round-trips through the Worker + D1 column (AD-1)', async () => {
      const a = make();
      const drop = makeEvent({ direction: 'dropoff' });
      const pick = makeEvent({ direction: 'pickup' });
      await a.insertEvents([drop, pick]);
      const stored = await a.listEvents();
      const byId = new Map(stored.map((e) => [e.id, e.direction]));
      expect(byId.get(drop.id)).toBe('dropoff');
      expect(byId.get(pick.id)).toBe('pickup');
    });

    it('pagination: >1000 events round-trip completely (L-0006)', async () => {
      const a = make();
      const N = 1500;
      const batch = Array.from({ length: N }, () => makeEvent());
      await a.insertEvents(batch);
      const all = await a.listEvents();
      expect(all).toHaveLength(N);
      // Every id present exactly once (no page-boundary drops or dupes).
      expect(new Set(all.map((e) => e.id)).size).toBe(N);
    });
  });
}

contractSuite('RestAdapter', makeRestAdapter);
