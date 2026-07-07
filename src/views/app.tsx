import { useRef } from 'preact/hooks';
import { useStore } from '../lib/store.ts';
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
      <span data-testid="last-sync" title="Last successful sync">
        {lastSync ? new Date(lastSync).toISOString() : 'never'}
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

export function App({ ctx }: { ctx: AppCtx }) {
  const unlocked = useStore(ctx.stores.unlocked);
  const view = useStore(ctx.stores.view);
  const session = useStore(ctx.stores.session);
  const pending = useStore(ctx.stores.pending);

  const showIosHint = isIphoneUa() && !isStandalone();

  return (
    <div class="app">
      {showIosHint && (
        <div class="hint" data-testid="ios-install-hint">
          For reliable offline storage on iPhone, add this app to your Home Screen: Share → Add to
          Home Screen, then launch it from the icon.
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
