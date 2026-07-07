import type { BackendAdapter } from './adapters/types.ts';
import { TapQueue } from './queue/queue.ts';
import { SyncEngine } from './sync/engine.ts';
import { createStore, type Store } from './lib/store.ts';
import { exportCsv, exportCoverageCsv } from './lib/csv.ts';
import { newId } from './lib/ids.ts';
import { isValidObserverCode } from './lib/validate.ts';
import type { Provider, Session } from './lib/types.ts';
import type { DateRange } from './lib/aggregate.ts';

export type View = 'count' | 'settings' | 'dashboard';

const LS_FORCE_OFFLINE = 'parksa:forceOffline';
const LS_UNLOCKED = 'parksa:unlocked';
const LS_LAST_SYNC = 'parksa:lastSyncAt';

export function getForceOffline(): boolean {
  try {
    return localStorage.getItem(LS_FORCE_OFFLINE) === '1';
  } catch {
    return false;
  }
}

/** synced_offline rule (DC-06): computed at enqueue time, client-side. */
export function isOffline(): boolean {
  const online = typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true;
  return !(online && !getForceOffline());
}

export interface AppStores {
  providers: Store<Provider[]>;
  session: Store<Session | null>;
  pending: Store<number>;
  lastSync: Store<number | null>;
  unlocked: Store<boolean>;
  view: Store<View>;
  endWarning: Store<boolean>;
  queueTick: Store<number>;
}

export interface AppCtx {
  adapter: BackendAdapter;
  queue: TapQueue;
  engine: SyncEngine;
  stores: AppStores;
  bootHadPending: boolean;
  pin: string;
  actions: {
    unlock(pin: string): boolean;
    startSession(observer: string, location: string): { ok: boolean; error?: string };
    endSession(): Promise<void>;
    closeSessionRetroactively(sessionId: string, endTs?: string): Promise<void>;
    listOpenSessions(): Promise<Session[]>;
    tap(providerId: string): number;
    undo(): void;
    refreshProviders(): Promise<void>;
    setForceOffline(v: boolean): void;
    exportRawCsv(range: DateRange): Promise<string>;
    exportCoverageCsv(range: DateRange): Promise<string>;
    navigate(view: View): void;
  };
}

function viewFromHash(): View {
  const h = typeof location !== 'undefined' ? location.hash : '';
  if (h.startsWith('#/settings')) return 'settings';
  if (h.startsWith('#/dashboard')) return 'dashboard';
  return 'count';
}

export async function createAppCtx(adapter: BackendAdapter): Promise<AppCtx> {
  const queue = await TapQueue.open({ isOffline });
  const pendingAtBoot = await queue.pendingCount();

  const stores: AppStores = {
    providers: createStore<Provider[]>([]),
    session: createStore<Session | null>(queue.currentSession()),
    pending: createStore(pendingAtBoot),
    lastSync: createStore<number | null>(
      (() => {
        try {
          const v = localStorage.getItem(LS_LAST_SYNC);
          return v ? Number(v) : null;
        } catch {
          return null;
        }
      })()
    ),
    unlocked: createStore(
      (() => {
        try {
          return localStorage.getItem(LS_UNLOCKED) === '1';
        } catch {
          return false;
        }
      })()
    ),
    view: createStore<View>(viewFromHash()),
    endWarning: createStore(false),
    queueTick: createStore(0)
  };

  const engine = new SyncEngine({
    flush: () => queue.flush(adapter),
    isOffline,
    win: typeof window !== 'undefined' ? window : null,
    doc: typeof document !== 'undefined' ? document : null,
    onSyncOk: (ts) => {
      try {
        localStorage.setItem(LS_LAST_SYNC, String(ts));
      } catch {
        /* ignore */
      }
      stores.lastSync.set(ts);
    }
  });
  engine.lastSyncAt = stores.lastSync.get();

  queue.subscribe(() => {
    stores.queueTick.set(stores.queueTick.get() + 1);
    void queue.pendingCount().then((n) => {
      if (n !== stores.pending.get()) stores.pending.set(n);
    });
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', () => stores.view.set(viewFromHash()));
  }

  const pin = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_APP_PIN || '1234';

  const serverSnapshot = async () => {
    const [events, tombstones, sessions, providers] = await Promise.all([
      adapter.listEvents(),
      adapter.listTombstones(),
      adapter.listSessions(),
      adapter.listProviders()
    ]);
    return { events, tombstones, sessions, providers };
  };

  const ctx: AppCtx = {
    adapter,
    queue,
    engine,
    stores,
    bootHadPending: pendingAtBoot > 0,
    pin,
    actions: {
      unlock(entered: string): boolean {
        if (entered !== pin) return false;
        try {
          localStorage.setItem(LS_UNLOCKED, '1');
        } catch {
          /* ignore */
        }
        stores.unlocked.set(true);
        return true;
      },

      startSession(observer: string, location: string) {
        if (!isValidObserverCode(observer)) {
          return { ok: false, error: 'Invalid observer code: use 1-12 letters/digits/-/_ (no spaces or real names).' };
        }
        const session: Session = {
          id: newId(),
          start_ts: new Date().toISOString(),
          observer_label: observer,
          location_label: location
        };
        void queue.startSession(session);
        stores.session.set(session);
        stores.endWarning.set(false);
        void engine.trigger('session-start');
        return { ok: true };
      },

      async endSession() {
        await queue.endSession();
        stores.session.set(null);
        await engine.trigger('session-end');
        const pending = await queue.pendingCount();
        stores.endWarning.set(pending > 0);
      },

      /**
       * AN-01/OR-F3: close a never-ended (stale) session with
       * end_source='retroactive'. Reachable both from the settings UI and from
       * window.__PARKSA__.closeSessionRetroactively(). Does NOT run
       * automatically against the session being resumed on reload (F10) — the
       * caller must name a specific session id.
       */
      async closeSessionRetroactively(sessionId: string, endTs?: string) {
        const serverSessions = await adapter.listSessions();
        let target = serverSessions.find((s) => s.id === sessionId) ?? null;
        const current = queue.currentSession();
        if (!target && current?.id === sessionId) target = current;
        if (!target) throw new Error(`no session ${sessionId}`);
        await queue.closeSessionRetroactively(target, endTs);
        if (stores.session.get()?.id === sessionId) stores.session.set(null);
        await engine.trigger('retroactive-close');
      },

      /** Open (never-ended) sessions on the backend EXCLUDING the one currently
       *  resumed on this device — the candidates for retroactive close. */
      async listOpenSessions() {
        const currentId = queue.currentSession()?.id ?? null;
        const sessions = await adapter.listSessions();
        return sessions.filter((s) => s.end_ts == null && s.id !== currentId);
      },

      tap(providerId: string): number {
        queue.enqueueTap(providerId);
        return queue.getCountFor(providerId);
      },

      undo() {
        queue.undoLast();
      },

      async refreshProviders() {
        stores.providers.set(await adapter.listProviders());
      },

      setForceOffline(v: boolean) {
        try {
          localStorage.setItem(LS_FORCE_OFFLINE, v ? '1' : '0');
        } catch {
          /* ignore */
        }
        if (!v) void engine.trigger('force-offline-cleared');
      },

      async exportRawCsv(range: DateRange): Promise<string> {
        const { events, tombstones, providers } = await serverSnapshot();
        return exportCsv({ events, tombstones, providers, range });
      },

      async exportCoverageCsv(range: DateRange): Promise<string> {
        const { events, tombstones, sessions } = await serverSnapshot();
        return exportCoverageCsv({ events, tombstones, sessions, range });
      },

      navigate(view: View) {
        if (typeof location !== 'undefined') {
          location.hash = view === 'count' ? '#/count' : `#/${view}`;
        }
        stores.view.set(view);
      }
    }
  };

  await ctx.actions.refreshProviders();
  return ctx;
}
