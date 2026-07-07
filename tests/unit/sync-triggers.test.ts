import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncEngine } from '../../src/sync/engine.ts';

type Handler = () => void;

function fakeTarget() {
  const handlers = new Map<string, Set<Handler>>();
  return {
    addEventListener(type: string, fn: Handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Handler) {
      handlers.get(type)?.delete(fn);
    },
    dispatch(type: string) {
      for (const fn of handlers.get(type) ?? []) fn();
    }
  };
}

/** Let real microtasks/macrotasks (promise chains) settle. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));
}

describe('foreground-only sync triggers (AC-15 / DC-09)', () => {
  beforeEach(() =>
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
  );
  afterEach(() => vi.useRealTimers());

  it('flushes on init, online, visibilitychange->visible, timer tick and session end', async () => {
    const flush = vi.fn(() => Promise.resolve());
    const win = fakeTarget();
    const doc = Object.assign(fakeTarget(), { visibilityState: 'visible' });
    const engine = new SyncEngine({
      flush,
      isOffline: () => false,
      intervalMs: 30_000,
      win,
      doc
    });

    engine.start(); // (1) init / launch
    await settle();
    expect(flush).toHaveBeenCalledTimes(1);

    win.dispatch('online'); // (2) connectivity restored
    await settle();
    expect(flush).toHaveBeenCalledTimes(2);

    doc.dispatch('visibilitychange'); // (3) app became visible
    await settle();
    expect(flush).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(30_000); // (4) periodic timer
    await settle();
    expect(flush).toHaveBeenCalledTimes(4);

    await engine.trigger('session-end'); // (5) session end
    await settle();
    expect(flush).toHaveBeenCalledTimes(5);

    engine.stop();
  });

  it('does not attempt flushes while offline', async () => {
    const flush = vi.fn(() => Promise.resolve());
    const win = fakeTarget();
    const doc = Object.assign(fakeTarget(), { visibilityState: 'visible' });
    let offline = true;
    const engine = new SyncEngine({ flush, isOffline: () => offline, win, doc, intervalMs: 30_000 });
    engine.start();
    vi.advanceTimersByTime(90_000);
    await settle();
    expect(flush).not.toHaveBeenCalled();

    offline = false;
    win.dispatch('online');
    await settle();
    expect(flush).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it('hidden visibilitychange does not trigger a flush', async () => {
    const flush = vi.fn(() => Promise.resolve());
    const doc = Object.assign(fakeTarget(), { visibilityState: 'hidden' });
    const engine = new SyncEngine({
      flush,
      isOffline: () => false,
      win: fakeTarget(),
      doc,
      intervalMs: 60_000
    });
    engine.start();
    await settle();
    flush.mockClear();
    doc.dispatch('visibilitychange');
    await settle();
    expect(flush).not.toHaveBeenCalled();
    engine.stop();
  });
});
