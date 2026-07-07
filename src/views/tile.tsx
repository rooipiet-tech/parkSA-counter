import { useRef } from 'preact/hooks';
import type { Provider } from '../lib/types.ts';

/** Squared movement slop (px^2): a pointer that travels more than ~10px from
 *  its pointerdown position is treated as a scroll/drag, NOT a tap. */
const TAP_SLOP_SQ = 10 * 10;

/**
 * Tap capture (POL-01/AC-05):
 *  - pointerdown gives IMMEDIATE visual feedback (the `pressed` class) so the
 *    <200ms acknowledgement of AC-04 holds — the tap-latency probe observes
 *    this attribute mutation. It does NOT commit the event yet.
 *  - the event is COMMITTED on pointerup, and only if the pointer stayed
 *    within ~10px of its start AND was not cancelled. A touch-drag-to-scroll
 *    that begins on a tile therefore fires pointercancel (or a large move) and
 *    records nothing — no phantom taps.
 * There is deliberately NO click handler, so the pointerdown+click double-fire
 * of a physical tap still records exactly one event. Per-tile active-pointerId
 * tracking: while one pointer is down on this tile, a second pointerdown on the
 * SAME tile is ignored; different tiles track independently.
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
  const startX = useRef(0);
  const startY = useRef(0);
  const aborted = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);

  const down = (e: PointerEvent) => {
    e.preventDefault();
    if (activePointer.current !== null) return; // same-tile second pointer: ignore
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
    const n = onTap(provider.id); // COMMIT the tap
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
      class="tile"
      data-testid={`tile-${provider.id}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
    >
      <span class="tile-name">{provider.name}</span>
      <span class="tile-count" ref={countRef} data-testid={`count-${provider.id}`}>
        {count}
      </span>
    </button>
  );
}
