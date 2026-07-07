import { useState } from 'preact/hooks';
import type { AppCtx } from '../app-context.ts';

export function PinView({ ctx }: { ctx: AppCtx }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  const submit = () => {
    if (!ctx.actions.unlock(value)) {
      setError(true);
      setValue('');
    }
  };

  return (
    <div class="pin-screen">
      <h1>ParkSA Counter</h1>
      <p>Enter the shared PIN to unlock this device.</p>
      <input
        data-testid="pin-input"
        type="password"
        inputMode="numeric"
        autocomplete="off"
        value={value}
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <button data-testid="pin-submit" onClick={submit}>
        Unlock
      </button>
      {error && (
        <p class="error" data-testid="pin-error">
          Wrong PIN. Try again.
        </p>
      )}
    </div>
  );
}
