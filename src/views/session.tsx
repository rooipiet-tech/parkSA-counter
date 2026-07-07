import { useState } from 'preact/hooks';
import { useStore } from '../lib/store.ts';
import { OBSERVER_HELPER_TEXT } from '../lib/validate.ts';
import { DEFAULT_LOCATION } from '../lib/types.ts';
import type { AppCtx } from '../app-context.ts';

/** Session start form, shown after unlock while no session is active. */
export function SessionStartView({ ctx }: { ctx: AppCtx }) {
  const [observer, setObserver] = useState('');
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [error, setError] = useState<string | null>(null);
  const endWarning = useStore(ctx.stores.endWarning);
  useStore(ctx.stores.pending);

  const start = () => {
    const res = ctx.actions.startSession(observer.trim(), location.trim() || DEFAULT_LOCATION);
    if (!res.ok) setError(res.error ?? 'Invalid observer code');
    else setError(null);
  };

  return (
    <div class="session-start">
      <h2>Start an observation session</h2>
      {endWarning && (
        <div class="warning" data-testid="unsynced-warning" role="alert">
          Session ended with unsynced taps still queued. Keep this device online and the app open
          until the unsynced badge reads 0.
        </div>
      )}
      <label>
        Observer code
        <input
          data-testid="observer-input"
          type="text"
          maxLength={12}
          placeholder="OBS-1"
          value={observer}
          onInput={(e) => setObserver((e.target as HTMLInputElement).value)}
        />
      </label>
      <p class="helper" data-testid="observer-helper">
        {OBSERVER_HELPER_TEXT}
      </p>
      {error && (
        <p class="error" data-testid="observer-error" role="alert">
          {error}
        </p>
      )}
      <label>
        Location label
        <input
          data-testid="location-input"
          type="text"
          maxLength={40}
          value={location}
          onInput={(e) => setLocation((e.target as HTMLInputElement).value)}
        />
      </label>
      <button data-testid="session-start" onClick={start}>
        Start session
      </button>
    </div>
  );
}
