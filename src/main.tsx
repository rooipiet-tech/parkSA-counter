import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { createAdapter } from './adapters/index.ts';
import { StubAdapter } from './adapters/stub.ts';
import { generateMonth } from './seed/month.ts';
import { countPendingEvents, deleteParkSaDb } from './queue/db.ts';
import { createAppCtx } from './app-context.ts';
import { installAgentApi } from './agent-api.ts';
import { App } from './views/app.tsx';
import './style.css';

function InsecureWarning() {
  return (
    <div class="insecure" data-testid="insecure-context-warning" role="alert">
      <h1>Insecure context</h1>
      <p>
        ParkSA Counter only runs in a secure context (HTTPS, or localhost during development).
        Offline storage and the service worker are unavailable over plain HTTP — data could be
        lost. Please use the HTTPS deployment.
      </p>
    </div>
  );
}

async function boot() {
  const root = document.getElementById('root')!;
  const params = new URLSearchParams(location.search);

  // Test/agent hook: '?fresh=1' clears all local state BEFORE the app boots,
  // then strips itself from the URL so an in-test reload keeps state.
  // RS-02: refuse the destructive wipe when unsynced taps exist, UNLESS an
  // explicit '&force=1' is also present — this keeps the zero-loss guarantee
  // in production while leaving test/agent fresh contexts (pending=0) unchanged.
  if (params.get('fresh') === '1') {
    const forced = params.get('force') === '1';
    const pending = forced ? 0 : await countPendingEvents();
    if (pending === 0 || forced) {
      try {
        localStorage.clear();
      } catch {
        /* ignore */
      }
      await deleteParkSaDb();
    } else {
      console.warn(
        `?fresh=1 ignored: ${pending} unsynced tap(s) would be lost. Add &force=1 to wipe anyway.`
      );
    }
    params.delete('fresh');
    params.delete('force');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
  }

  if (!window.isSecureContext) {
    render(<InsecureWarning />, root);
    return;
  }

  const adapter = createAdapter();
  // Stub self-seed with the deterministic synthetic month.
  if (params.get('seed') === 'month' && adapter instanceof StubAdapter) {
    adapter.seed(generateMonth());
  }

  const ctx = await createAppCtx(adapter);
  installAgentApi(ctx);

  // DC-10: ask for durable storage on load (best-effort).
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }

  render(<App ctx={ctx} />, root);
  ctx.engine.start();

  registerSW({ immediate: true });
}

void boot();
