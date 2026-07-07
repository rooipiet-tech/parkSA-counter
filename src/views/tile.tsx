import { useRef } from 'preact/hooks';
import type { Provider, TapDirection } from '../lib/types.ts';

/** Squared movement slop (px^2): a pointer that travels more than ~10px from
 *  its pointerdown position is treated as a scroll/drag, NOT a tap. */
const TAP_SLOP_SQ = 10 * 10;

/**
 * One independently-tappable half of a provider tile (AD-2). Each half owns the
 * SAME phantom-tap-safe capture the single tile used to have (POL-01/AC-05):
 *  - pointerdown gives IMMEDIATE visual feedback (the `pressed` class) so the
 *    <200ms acknowledgement of AC-04 holds; it does NOT commit the event yet.
 *  - the event is COMMITTED on pointerup, and only if the pointer stayed within
 *    ~10px of its start AND was not cancelled. A touch-drag-to-scroll that
 *    begins on a half fires pointercancel (or a large move) and records nothing.
 * There is deliberately NO click handler. Per-half active-pointerId tracking:
 * while one pointer is down on this half, a second pointerdown on the SAME half
 * is ignored; the two halves (and different tiles) track independently, so two
 * fingers on the two halves each record exactly one event.
 */
function TileHalf({
  provider,
  direction,
  label,
  count,
  onTap
}: {
  provider: Provider;
  direction: TapDirection;
  label: string;
  count: number;
  onTap: (providerId: string, direction: TapDirection) => number;
}) {
  const activePointer = useRef<number | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const aborted = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);

  const down = (e: PointerEvent) => {
    e.preventDefault();
    if (activePointer.current !== null) return; // same-half second pointer: ignore
    activePointer.current = e.pointerId;
    aborted.current = false;
    startX.current = e.clientX;
    startY.current = e.clientY;
    btnRef.current?.classList.add('pressed'); // instant feedback (<200ms)
  };

  const move = (e: PointerEvent) => {
    if (e.pointerId !== activePointer.current || aborted.current) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (dx * dx + dy * dy > TAP_SLOP_SQ) {
      // Turned into a scroll/drag — revoke the pending tap.
      aborted.current = true;
      btnRef.current?.classList.remove('pressed');
    }
  };

  const up = (e: PointerEvent) => {
    if (e.pointerId !== activePointer.current) return;
    activePointer.current = null;
    btnRef.current?.classList.remove('pressed');
    if (aborted.current) {
      aborted.current = false;
      return; // was a scroll/drag — commit nothing
    }
    const n = onTap(provider.id, direction); // COMMIT the tap
    // Mutate the existing text node's value (never replace the node itself —
    // Preact keeps a reference to it and must stay in control of the DOM).
    const textNode = countRef.current?.firstChild;
    if (textNode) textNode.nodeValue = String(n);
  };

  const cancel = (e: PointerEvent) => {
    if (e.pointerId !== activePointer.current) return;
    activePointer.current = null;
    aborted.current = false;
    btnRef.current?.classList.remove('pressed');
  };

  return (
    <button
      ref={btnRef}
      class={`tile-half tile-half-${direction}`}
      data-testid={`tile-${provider.id}-${direction}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
    >
      <span class="tile-half-label">{label}</span>
      <span
        class="tile-half-count"
        ref={countRef}
        data-testid={`count-${provider.id}-${direction}`}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * A provider tile split into two independently-tappable coloured halves: TOP =
 * Drop-off (amber), BOTTOM = Pick-up (teal), each with its own live per-session
 * count (AD-2).
 */
export function Tile({
  provider,
  dropoffCount,
  pickupCount,
  onTap
}: {
  provider: Provider;
  dropoffCount: number;
  pickupCount: number;
  onTap: (providerId: string, direction: TapDirection) => number;
}) {
  return (
    <div class="tile" data-testid={`provider-tile-${provider.id}`}>
      <span class="tile-name">{provider.name}</span>
      <TileHalf
        provider={provider}
        direction="dropoff"
        label="Drop-off"
        count={dropoffCount}
        onTap={onTap}
      />
      <TileHalf
        provider={provider}
        direction="pickup"
        label="Pick-up"
        count={pickupCount}
        onTap={onTap}
      />
    </div>
  );
}
