import { useState } from 'preact/hooks';
import { useStore } from '../lib/store.ts';
import { newId } from '../lib/ids.ts';
import type { AppCtx } from '../app-context.ts';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `provider-${newId().slice(0, 8)}`;
}

/**
 * Settings: provider management (add / rename / hide / reorder), effective
 * immediately, no redeploy. Only reachable through the >=500ms long-press on
 * [data-testid=settings-open], behind the same PIN gate as everything else.
 * The permanent 'Unknown' provider renders no hide control; the adapter
 * refuses hide/delete for it as well.
 */
export function SettingsView({ ctx }: { ctx: AppCtx }) {
  const providers = useStore(ctx.stores.providers);
  const [newName, setNewName] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = () => void ctx.actions.refreshProviders();

  const act = (fn: () => Promise<void>) => {
    fn()
      .then(() => setError(null))
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(refresh);
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    const existing = new Set(providers.map((p) => p.id));
    let id = slugify(name);
    while (existing.has(id)) id = `${slugify(name)}-${newId().slice(0, 4)}`;
    const maxOrder = providers.reduce((m, p) => Math.max(m, p.sort_order), 0);
    act(() =>
      ctx.adapter.addProvider({
        id,
        name,
        sort_order: maxOrder + 1,
        hidden: false,
        is_permanent: false
      })
    );
    setNewName('');
  };

  const moveToTop = (id: string) => {
    const ordered = [id, ...providers.filter((p) => p.id !== id).map((p) => p.id)];
    act(() => ctx.adapter.reorderProviders(ordered));
  };

  const move = (id: string, dir: -1 | 1) => {
    const ids = providers.map((p) => p.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    act(() => ctx.adapter.reorderProviders(ids));
  };

  return (
    <div class="settings-view">
      <h2>Settings — providers</h2>
      {error && (
        <p class="error" data-testid="settings-error" role="alert">
          {error}
        </p>
      )}
      <ul class="provider-list">
        {providers.map((p) => (
          <li key={p.id} data-testid={`provider-row-${p.id}`} class={p.hidden ? 'hidden-provider' : ''}>
            <input
              data-testid={`provider-name-${p.id}`}
              value={names[p.id] ?? p.name}
              onInput={(e) => setNames({ ...names, [p.id]: (e.target as HTMLInputElement).value })}
            />
            <button
              data-testid={`provider-rename-${p.id}`}
              onClick={() => act(() => ctx.adapter.renameProvider(p.id, (names[p.id] ?? p.name).trim() || p.name))}
            >
              Rename
            </button>
            <button data-testid={`provider-top-${p.id}`} onClick={() => moveToTop(p.id)}>
              To top
            </button>
            <button data-testid={`provider-up-${p.id}`} onClick={() => move(p.id, -1)}>
              Up
            </button>
            <button data-testid={`provider-down-${p.id}`} onClick={() => move(p.id, 1)}>
              Down
            </button>
            {!p.is_permanent && (
              <button
                data-testid={`provider-hide-${p.id}`}
                onClick={() => act(() => ctx.adapter.setProviderHidden(p.id, !p.hidden))}
              >
                {p.hidden ? 'Unhide' : 'Hide'}
              </button>
            )}
            {p.is_permanent && <span class="permanent-note">permanent</span>}
          </li>
        ))}
      </ul>
      <div class="add-provider">
        <input
          data-testid="provider-add-name"
          placeholder="New provider name"
          value={newName}
          onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
        />
        <button data-testid="provider-add" onClick={add}>
          Add provider
        </button>
      </div>
      <button data-testid="settings-back" onClick={() => ctx.actions.navigate('count')}>
        Back to counting
      </button>
    </div>
  );
}
