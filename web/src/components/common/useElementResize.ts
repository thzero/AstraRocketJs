import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Call `onResize` whenever the element behind `ref` changes size, with its
 * content box and the element itself. Each caller keeps its own clamp; what is
 * shared is the observer, its disconnect, and the guard for an environment with
 * no ResizeObserver at all (three of six hand-written copies lacked it, and one
 * missing guard is a crash on that browser).
 */
export function useElementResize<T extends Element>(
  ref: RefObject<T | null>,
  onResize: (rect: DOMRectReadOnly, el: T) => void,
): void {
  // The latest callback, so a caller can pass an inline function without
  // re-subscribing the observer on every render.
  const latest = useRef(onResize);
  useLayoutEffect(() => {
    latest.current = onResize;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) latest.current(entry.contentRect, el);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}
