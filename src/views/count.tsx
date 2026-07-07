import { useState } from 'preact/hooks';
import { useStore } from '../lib/store.ts';
import { Tile } from './tile.tsx';
import type { AppCtx } from '../app-context.ts';

export function CountView({ ctx }: { ctx: AppCtx }) {
  useStore(ctx.stores.queueTick); // re-render on queue changes
  const providers = useStore(ctx.stores.providers);
  const session = useStore(ctx.stores.session);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  if (!session) return null;

  const visible = providers.filter((p) => !p.hidden);

  return (
    <div class="count-view">
      <div class="session-bar">
        <span data-testid="session-info">
          {session.observer_label} @ {session.location_label}
        </span>
        <button class="session-undo" data-testid="undo-btn" onClick={() => ctx.actions.undo()}>
          Undo last tap
        </button>
        {/* POL-03: End session sits apart from Undo and requires a deliberate
            two-step confirm, so a one-thumbed mis-aim can't end a count. */}
        <span class="session-end-group">
          {confirmingEnd ? (
            <>
              <button
                class="session-end-confirm"
                data-testid="session-end-confirm"
                onClick={() => {
                  setConfirmingEnd(false);
                  void ctx.actions.endSession();
                }}
              >
                Confirm end
              </button>
              <button
                data-testid="session-end-cancel"
                onClick={() => setConfirmingEnd(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              class="session-end"
              data-testid="session-end"
              onClick={() => setConfirmingEnd(true)}
            >
              End session
            </button>
          )}
        </span>
      </div>
      <div class="tile-grid">
        {visible.map((p) => (
          <Tile
            key={p.id}
            provider={p}
            dropoffCount={ctx.queue.getCountFor(p.id, 'dropoff')}
            pickupCount={ctx.queue.getCountFor(p.id, 'pickup')}
            onTap={ctx.actions.tap}
          />
        ))}
      </div>
    </div>
  );
}
