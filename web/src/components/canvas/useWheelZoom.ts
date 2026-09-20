import { useEffect, useRef, type RefObject } from 'react';
import { zoomAbout, type ZoomState } from './schematicGeometry';

/**
 * Wheel-zoom about the pointer for an SVG drawing. TreeSchematic and AftView
 * each carried a copy of this effect; the copies had already drifted (one
 * re-registered its listener on every layout change, the other read the
 * layout through a ref written during render).
 *
 * A native, non-passive listener: React's onWheel is passive, so the
 * preventDefault that keeps the page from scrolling has to be attached here.
 * Registered ONCE per element; the pointer-to-viewBox mapping is read through
 * a ref so a layout change never re-attaches the listener.
 *
 * @param toView maps a wheel event's client point to viewBox coordinates,
 *   given the svg's current bounding rect; null when the view is not zoomable.
 */
export function useWheelZoom(
  ref: RefObject<SVGSVGElement | null>,
  setZoom: (f: (z: ZoomState) => ZoomState) => void,
  toView: ((e: WheelEvent, rect: DOMRect) => { px: number; py: number }) | null,
  opts: { factor: number; max: number },
): void {
  const latest = useRef({ toView, opts });
  useEffect(() => {
    latest.current = { toView, opts };
  });
  const enabled = toView !== null;
  useEffect(() => {
    const svg = ref.current;
    if (!svg || !enabled) return;
    const onWheel = (e: WheelEvent) => {
      const { toView, opts } = latest.current;
      if (!toView) return;
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const { px, py } = toView(e, rect);
      const step = e.deltaY < 0 ? opts.factor : 1 / opts.factor;
      setZoom((z) => zoomAbout(z, px, py, Math.min(opts.max, Math.max(1, z.k * step))));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [ref, setZoom, enabled]);
}
