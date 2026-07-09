import { useRef, useState } from 'preact/hooks';
import { useStore } from '../lib/store.ts';
import { formatSast } from '../lib/sast.ts';
import { isIphoneUa, isStandalone } from '../lib/display-mode.ts';
import { PinView } from './pin.tsx';
import { CountView } from './count.tsx';
import { SessionStartView } from './session.tsx';
import { SettingsView } from './settings.tsx';
import { DashboardView } from './dashboard.tsx';
import type { AppCtx } from '../app-context.ts';

/**
 * Settings can only be opened through a deliberate >=500ms long-press —
 * a plain click/tap does nothing, so a stray mid-count tap can't land here.
 */
function SettingsOpenButton({ onOpen }: { onOpen: () => void }) {
  const timer = useRef<number | null>(null);
  const down = () => {
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onOpen();
    }, 500);
  };
  const cancel = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  return (
    <button
      data-testid="settings-open"
      title="Long-press (hold 0.5s) to open settings"
      onPointerDown={down}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
    >
      Settings (hold)
    </button>
  );
}

function Header({ ctx }: { ctx: AppCtx }) {
  const pending = useStore(ctx.stores.pending);
  const lastSync = useStore(ctx.stores.lastSync);
  const view = useStore(ctx.stores.view);
  return (
    <header class="app-header">
      <span class="badge" data-testid="unsynced-badge" title="Unsynced taps">
        {pending}
      </span>
      <span
        data-testid="last-sync"
        data-iso={lastSync ? new Date(lastSync).toISOString() : ''}
        title="Last successful sync (SAST)"
      >
        {lastSync ? formatSast(lastSync) : 'Never synced'}
      </span>
      <nav>
        <button data-testid="nav-count" onClick={() => ctx.actions.navigate('count')} disabled={view === 'count'}>
          Count
        </button>
        <button
          data-testid="nav-dashboard"
          onClick={() => ctx.actions.navigate('dashboard')}
          disabled={view === 'dashboard'}
        >
          Dashboard
        </button>
        <SettingsOpenButton onOpen={() => ctx.actions.navigate('settings')} />
      </nav>
    </header>
  );
}

const IOS_HINT_DISMISSED = 'parksa:iosHintDismissed';

export function App({ ctx }: { ctx: AppCtx }) {
  const unlocked = useStore(ctx.stores.unlocked);
  const view = useStore(ctx.stores.view);
  const session = useStore(ctx.stores.session);
  const pending = useStore(ctx.stores.pending);

  const [iosHintDismissed, setIosHintDismissed] = useState(() => {
    try {
      return localStorage.getItem(IOS_HINT_DISMISSED) === '1';
    } catch {
      return false;
    }
  });
  const dismissIosHint = () => {
    try {
      localStorage.setItem(IOS_HINT_DISMISSED, '1');
    } catch {
      /* ignore */
    }
    setIosHintDismissed(true);
  };

  // POL-07: compact + dismissable (persisted), but visible on first load for a
  // non-standalone iPhone UA (AC-16). `?fresh=1` clears the dismissal so tests
  // never leak it between runs.
  const showIosHint = isIphoneUa() && !isStandalone() && !iosHintDismissed;

  return (
    <div class="app">
      {!ctx.storageAvailable && (
        <div class="warning" data-testid="storage-unavailable" role="alert">
          Offline storage is unavailable on this device or browser. Taps are kept in memory for
          this session only and will be lost if you reload or close the app. Stay online so taps
          sync to the server.
        </div>
      )}
      {showIosHint && (
        <div class="hint hint-compact" data-testid="ios-install-hint">
          <span>
            iPhone: for reliable offline storage, add to Home Screen (Share → Add to Home Screen).
          </span>
          <button
            class="hint-dismiss"
            data-testid="ios-install-hint-dismiss"
            aria-label="Dismiss install hint"
            onClick={dismissIosHint}
          >
            ✕
          </button>
        </div>
      )}
      {ctx.bootHadPending && pending > 0 && (
        <div class="warning" data-testid="unsynced-banner" role="alert">
          There are unsynced taps from a previous run on this device. Stay online with the app open
          until the unsynced badge reads 0.
        </div>
      )}
      {!unlocked ? (
        <PinView ctx={ctx} />
      ) : (
        <>
          <Header ctx={ctx} />
          {view === 'settings' ? (
            <SettingsView ctx={ctx} />
          ) : view === 'dashboard' ? (
            <DashboardView ctx={ctx} />
          ) : session ? (
            <CountView ctx={ctx} />
          ) : (
            <SessionStartView ctx={ctx} />
          )}
        </>
      )}
    </div>
  );
}
