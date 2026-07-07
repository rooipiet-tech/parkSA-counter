import { useStore } from '../lib/store.ts';
import { Tile } from './tile.tsx';
import type { AppCtx } from '../app-context.ts';

export function CountView({ ctx }: { ctx: AppCtx }) {
  useStore(ctx.stores.queueTick); // re-render on queue changes
  const providers = useStore(ctx.stores.providers);
  const session = useStore(ctx.stores.session);
  if (!session) return null;

  const visible = providers.filter((p) => !p.hidden);

  return (
    <div class="count-view">
      <div class="session-bar">
        <span data-testid="session-info">
          {session.observer_label} @ {session.location_label}
        </span>
        <button data-testid="undo-btn" onClick={() => ctx.actions.undo()}>
          Undo last tap
        </button>
        <button data-testid="session-end" onClick={() => void ctx.actions.endSession()}>
          End session
        </button>
      </div>
      <div class="tile-grid">
        {visible.map((p) => (
          <Tile key={p.id} provider={p} count={ctx.queue.getCountFor(p.id)} onTap={ctx.actions.tap} />
        ))}
      </div>
    </div>
  );
}
