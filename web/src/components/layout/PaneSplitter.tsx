import { useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';

// The window width as a subscription, for the one thing that must RE-RENDER
// when it changes: the announced maximum. `clamp` below reads the live value
// at gesture time and needs no subscription; the aria attribute is rendered
// markup, so without one it went stale after a resize until the next prop
// change, announcing a maximum the separator could no longer reach.
const subscribeResize = (cb: () => void) => {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
};
const readInnerWidth = () => window.innerWidth;

/** How far one arrow press moves the split, and one Shift+arrow press. */
const STEP = 16;
const COARSE_STEP = 64;

/**
 * The draggable divider between two panes, sized in pixels.
 *
 * It reports the width the PANE should take, not a delta, and it derives that
 * from the pointer's position against the pane's own outer edge rather than by
 * accumulating movement. Deltas drift: the moment a clamp bites (or the window
 * is narrower than the stored width), the running total and what is on screen
 * stop agreeing and the divider slides out from under the cursor.
 *
 * `side` says which side of the divider the sized pane is on, which flips both
 * the measurement and the arrow keys: on a right-hand pane, dragging LEFT makes
 * it wider.
 *
 * `onDrag` fires continuously and `onCommit` once on release, because the caller
 * persists the result — writing localStorage on every pointermove would be
 * dozens of writes a second for one gesture.
 *
 * It is a real `separator` widget, so it is reachable and usable from the
 * keyboard: arrows nudge, Shift+arrows move in bigger steps, Home and End go to
 * the extremes, and a double-click puts it back where it started.
 */
export function PaneSplitter({
  paneRef,
  side = 'left',
  width,
  min,
  max,
  reserve,
  fallback,
  label,
  onDrag,
  onCommit,
}: {
  /** The pane being sized. Its outer edge is the origin the drag measures from. */
  paneRef: RefObject<HTMLElement | null>;
  /** Which side of the divider that pane is on. */
  side?: 'left' | 'right';
  width: number;
  min: number;
  /** Upper bound, before the "leave room for the rest of the window" cap. */
  max: number;
  /** Pixels the REST of the window needs, which caps the width on a narrow one. */
  reserve: number;
  /** The width a double-click restores. */
  fallback: number;
  label: string;
  onDrag: (w: number) => void;
  onCommit: (w: number) => void;
}) {
  const dragging = useRef(false);
  // Whether this gesture moved at all. A press that does not move is a CLICK,
  // and a click must not resize: the pointer sits a pixel or two off the stored
  // split, so committing its position nudged the pane every time it was clicked
  // - and the second click of a double-click did that before the reset landed,
  // which made the reset look like it did nothing.
  const moved = useRef(false);

  // The cap depends on the window, so it is read at the moment of the gesture
  // rather than tracked: no resize listener, and it cannot go stale.
  const innerWidth = useSyncExternalStore(subscribeResize, readInnerWidth, readInnerWidth);
  const clamp = (w: number) => {
    const room = Math.max(min, Math.min(max, window.innerWidth - reserve));
    return Math.round(Math.min(room, Math.max(min, w)));
  };

  // Width = where the pointer is, measured from the pane's OUTER edge - the one
  // the divider is not on, and so the one that does not move as you drag.
  const widthAt = (clientX: number): number => {
    const box = paneRef.current?.getBoundingClientRect();
    return clamp(side === 'left' ? clientX - (box?.left ?? 0) : (box?.right ?? 0) - clientX);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Primary button only, so a right-click cannot start a drag that then has
    // no matching pointerup.
    if (e.button !== 0) return;
    dragging.current = true;
    moved.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    e.preventDefault(); // no text selection in the panes either side
    moved.current = true;
    onDrag(widthAt(e.clientX));
  };

  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!moved.current) return;
    moved.current = false;
    onCommit(widthAt(e.clientX));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Arrows move the DIVIDER, so which one grows the pane depends on the side
    // it is on. Both read as "push the divider that way".
    const step = (e.shiftKey ? COARSE_STEP : STEP) * (side === 'left' ? 1 : -1);
    const next =
      e.key === 'ArrowLeft'
        ? width - step
        : e.key === 'ArrowRight'
          ? width + step
          : e.key === 'Home'
            ? min
            : e.key === 'End'
              ? max
              : null;
    if (next === null) return;
    e.preventDefault();
    // One keystroke is one whole gesture, so it commits immediately.
    onCommit(clamp(next));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      // The EFFECTIVE maximum, which is what `clamp` enforces. Announcing
      // the static prop meant a narrow window advertised a range the
      // separator could not reach, and End landed somewhere other than the
      // announced maximum. Derived from the SUBSCRIBED width so a resize
      // re-renders it; `clamp` reads the same number live.
      aria-valuemax={Math.round(Math.max(min, Math.min(max, innerWidth - reserve)))}
      tabIndex={0}
      title={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onCommit(clamp(fallback))}
      // A 5px grab strip that LOOKS like the 1px rule it replaces: the border it
      // stands in for was never a target, and a divider you have to hunt for is
      // worse than no divider. `group` drives the inner line, so the whole strip
      // lights up on hover rather than just the pixel under the cursor.
      // `touch-none` keeps a touch drag from scrolling the pane instead.
      className="group hidden w-[5px] shrink-0 cursor-col-resize touch-none justify-center bg-transparent focus:outline-none lg:flex"
    >
      <div className="h-full w-px bg-white/10 transition-colors group-hover:w-[3px] group-hover:bg-sky-500/70 group-focus:w-[3px] group-focus:bg-sky-500" />
    </div>
  );
}
