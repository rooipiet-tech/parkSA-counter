import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { createAdapter } from './adapters/index.ts';
import { StubAdapter } from './adapters/stub.ts';
import { generateMonth } from './seed/month.ts';
import { countPendingEvents, deleteParkSaDb } from './queue/db.ts';
import { createAppCtx } from './app-context.ts';
import { installAgentApi } from './agent-api.ts';
import { App } from './views/app.tsx';
import { BootError, ErrorBoundary } from './views/boot-error.tsx';
import './style.css';

/**
 * Minimal placeholder rendered SYNCHRONOUSLY into #root before boot() runs, so
 * the user sees something immediately instead of a blank page during the async
 * boot (which on iOS can spend up to the IDB open timeout before degrading).
 * boot() then replaces it with the app, the degraded in-memory app, the insecure
 * warning, or the BootError surface. Styled inline (dark bg, centred) so it
 * shows even if the stylesheet has not loaded yet.
 */
function LoadingPlaceholder() {
  return (
    <div
      data-testid="loading-placeholder"
      role="status"
      aria-live="polite"
      style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#101418;color:#8a97a5;font-family:system-ui,sans-serif;font-size:1rem;"
    >
      Loading…
    </div>
  );
}

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
      try {
        await deleteParkSaDb();
      } catch {
        /* ignore: never let a storage wipe failure blank the app */
      }
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

  render(
    <ErrorBoundary>
      <App ctx={ctx} />
    </ErrorBoundary>,
    root
  );
  ctx.engine.start();

  registerSW({ immediate: true });
}

// Show SOMETHING immediately: render the placeholder synchronously before the
// async boot starts, so #root is never blank while boot() awaits IndexedDB.
try {
  const root = document.getElementById('root');
  if (root) render(<LoadingPlaceholder />, root);
} catch {
  /* ignore: boot() below still renders the real UI or an error surface */
}

// Never blank on boot failure: any pre-render rejection renders a visible,
// self-diagnosing error surface into #root instead of leaving it empty (the
// iOS Safari symptom).
boot().catch((err) => {
  console.error('Boot failed:', err);
  try {
    const root = document.getElementById('root');
    if (root) render(<BootError error={err} />, root);
  } catch (renderErr) {
    // Absolute last resort: never throw out of the boot handler.
    console.error('Failed to render boot error surface:', renderErr);
  }
});
