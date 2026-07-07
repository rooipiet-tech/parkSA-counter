import { useRef } from 'preact/hooks';
import type { Provider } from '../lib/types.ts';

/**
 * Tap capture happens on pointerdown ONLY — there is deliberately NO click
 * handler, so the pointerdown+click double-fire of a physical tap records
 * exactly one event. Per-tile active-pointerId tracking: while one pointer
 * is down on this tile, a second pointerdown on the SAME tile is ignored;
 * different tiles track independently, so simultaneous taps on two tiles
 * count one each.
 *
 * Visual feedback (pressed class + count text) is applied synchronously in
 * the same tick as the pointerdown handler (<200ms guarantee).
 */
export function Tile({
  provider,
  count,
  onTap
}: {
  provider: Provider;
  count: number;
  onTap: (providerId: string) => number;
}) {
  const activePointer = useRef<number | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);

  const down = (e: PointerEvent) => {
    e.preventDefault();
    if (activePointer.current !== null) return; // same-tile second pointer: ignore
    activePointer.current = e.pointerId;
    const n = onTap(provider.id); // synchronous enqueue
    btnRef.current?.classList.add('pressed');
    if (countRef.current) countRef.current.textContent = String(n);
  };

  const release = (e: PointerEvent) => {
    if (e.pointerId !== activePointer.current) return;
    activePointer.current = null;
    btnRef.current?.classList.remove('pressed');
  };

  return (
    <button
      ref={btnRef}
      class="tile"
      data-testid={`tile-${provider.id}`}
      onPointerDown={down}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
    >
      <span class="tile-name">{provider.name}</span>
      <span class="tile-count" ref={countRef} data-testid={`count-${provider.id}`}>
        {count}
      </span>
    </button>
  );
}
