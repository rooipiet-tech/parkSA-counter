/**
 * Foreground-only sync engine (DC-09). Triggers:
 *  - init/launch
 *  - window 'online'
 *  - visibilitychange -> visible
 *  - a ~30s periodic timer while the app is open
 *  - session end (the session manager calls trigger('session-end'))
 *
 * There is NO reliance on the Background Sync API. Failures never block the
 * UI: retries use capped exponential backoff on a single retry timer.
 */

interface Listenable {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

export interface SyncEngineOptions {
  flush: () => Promise<void>;
  isOffline: () => boolean;
  intervalMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
  win?: Listenable | null;
  doc?: (Listenable & { visibilityState?: string }) | null;
  onSyncOk?: (ts: number) => void;
  /** Test hook: observe scheduled retry delays. */
  onRetryScheduled?: (delayMs: number) => void;
}

export class SyncEngine {
  private o: SyncEngineOptions;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = false;
  private onOnline = () => void this.trigger('online');
  private onVisibility = () => {
    if ((this.o.doc?.visibilityState ?? 'visible') === 'visible') void this.trigger('visible');
  };

  lastSyncAt: number | null = null;

  constructor(options: SyncEngineOptions) {
    this.o = options;
  }

  start(): void {
    this.stopped = false;
    this.o.win?.addEventListener('online', this.onOnline);
    this.o.doc?.addEventListener('visibilitychange', this.onVisibility);
    this.intervalTimer = setInterval(() => void this.trigger('timer'), this.o.intervalMs ?? 30_000);
    void this.trigger('init');
  }

  stop(): void {
    this.stopped = true;
    this.o.win?.removeEventListener('online', this.onOnline);
    this.o.doc?.removeEventListener('visibilitychange', this.onVisibility);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.intervalTimer = null;
    this.retryTimer = null;
  }

  /**
   * Attempt a flush now (fire-and-forget; never throws). Returns a promise
   * resolving true when a flush ran and succeeded.
   */
  trigger(_reason: string): Promise<boolean> {
    if (this.stopped || this.o.isOffline()) return Promise.resolve(false);
    if (this.inFlight) return this.inFlight.then(() => true).catch(() => false);
    const run = this.o
      .flush()
      .then(() => {
        this.markOk();
        return true;
      })
      .catch(() => {
        this.scheduleRetry();
        return false;
      })
      .finally(() => {
        this.inFlight = null;
      });
    this.inFlight = run.then(() => undefined).catch(() => undefined);
    return run;
  }

  /** Awaitable flush that rethrows failures (used by __PARKSA__.flush()). */
  async flushNow(): Promise<void> {
    await this.o.flush();
    this.markOk();
  }

  private markOk(): void {
    this.failures = 0;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.lastSyncAt = (this.o.now ?? Date.now)();
    this.o.onSyncOk?.(this.lastSyncAt);
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    this.failures++;
    const base = this.o.baseDelayMs ?? 1_000;
    const max = this.o.maxDelayMs ?? 60_000;
    const delay = Math.min(base * 2 ** (this.failures - 1), max);
    this.o.onRetryScheduled?.(delay);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.trigger('retry');
    }, delay);
  }
}
