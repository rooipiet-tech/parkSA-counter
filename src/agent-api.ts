import type { AppCtx } from './app-context.ts';
import { StubAdapter } from './adapters/stub.ts';
import type { DateRange } from './lib/aggregate.ts';
import type { Provider, QueueState, Session, ServerEvent, Tombstone } from './lib/types.ts';

export interface ServerStateSnapshot {
  events: Array<ServerEvent & { tombstoned: boolean }>;
  sessions: Session[];
  providers: Provider[];
  tombstones: Tombstone[];
}

export interface ParkSaAgentApi {
  getQueueState(): Promise<QueueState>;
  getServerState(): Promise<ServerStateSnapshot>;
  setForceOffline(v: boolean): void;
  flush(): Promise<void>;
  exportCsv(range: DateRange): Promise<string>;
  exportCoverageCsv(range: DateRange): Promise<string>;
  /** Close a never-ended session with end_source='retroactive' (AC-10). */
  closeSessionRetroactively(sessionId: string, endTs?: string): Promise<void>;
  /** Open backend sessions excluding the resumed current one (retro-close candidates). */
  listOpenSessions(): Promise<Session[]>;
  /** Stub-only fault injection; console.warn no-op on the Supabase adapter. */
  injectFault(n: number): void;
  clearFault(): void;
}

declare global {
  interface Window {
    __PARKSA__: ParkSaAgentApi;
  }
}

/** Install the window-level agent API. Always installed, even before unlock. */
export function installAgentApi(ctx: AppCtx): void {
  const api: ParkSaAgentApi = {
    getQueueState: () => ctx.queue.getQueueState(),

    async getServerState(): Promise<ServerStateSnapshot> {
      const [events, tombstones, sessions, providers] = await Promise.all([
        ctx.adapter.listEvents(),
        ctx.adapter.listTombstones(),
        ctx.adapter.listSessions(),
        ctx.adapter.listProviders()
      ]);
      const dead = new Set(tombstones.map((t) => t.event_id));
      return {
        events: events.map((e) => ({ ...e, tombstoned: dead.has(e.id) })),
        sessions,
        providers,
        tombstones
      };
    },

    setForceOffline: (v: boolean) => ctx.actions.setForceOffline(v),

    flush: () => ctx.engine.flushNow(),

    exportCsv: (range: DateRange) => ctx.actions.exportRawCsv(range),

    exportCoverageCsv: (range: DateRange) => ctx.actions.exportCoverageCsv(range),

    closeSessionRetroactively: (sessionId: string, endTs?: string) =>
      ctx.actions.closeSessionRetroactively(sessionId, endTs),

    listOpenSessions: () => ctx.actions.listOpenSessions(),

    injectFault(n: number) {
      if (ctx.adapter instanceof StubAdapter) ctx.adapter.injectFaults(n);
      else console.warn('__PARKSA__.injectFault is stub-only; no-op');
    },

    clearFault() {
      if (ctx.adapter instanceof StubAdapter) ctx.adapter.clearFaults();
      else console.warn('__PARKSA__.clearFault is stub-only; no-op');
    }
  };
  window.__PARKSA__ = api;
}
