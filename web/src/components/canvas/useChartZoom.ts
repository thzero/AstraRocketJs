import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { HOST_INSET, PAD_L, clampWindow, resolveWindow, zoomWindow, type TimeWindow } from './flightChartAxis';

/**
 * Owns the flight chart's x-axis interaction: the zoom window state, the
 * time-to-pixel maps, the zoom buttons' entry point, the ctrl/pinch-wheel
 * listener (native, non-passive, registered once and reading the latest
 * handler through a ref) and the drag-to-pan pointer handlers. The hover
 * crosshair is not here; FlightChart decides what a pointer does when it is
 * not panning.
 */
export function useChartZoom(hostRef: RefObject<HTMLDivElement | null>, maxT: number, iw: number) {
  // Visible time window (null = full flight). The x-axis zooms/pans within it.
  const [zoom, setZoom] = useState<TimeWindow | null>(null);
  const { t0, t1, zoomed } = resolveWindow(zoom, maxT);
  // Memoized so the per-panel path memo can key on it: a fresh arrow every
  // render made that memo useless, and hovering re-renders the chart on every
  // pointer move.
  const X = useCallback((tt: number) => PAD_L + ((tt - t0) / (t1 - t0)) * iw, [t0, t1, iw]);
  const invX = (px: number) => t0 + ((px - PAD_L) / iw) * (t1 - t0);
  /** Pointer x relative to the plot's left edge (host inset added back). */
  const localX = (clientX: number) => {
    const host = hostRef.current;
    return host ? clientX - host.getBoundingClientRect().left - HOST_INSET : 0;
  };

  // Zoom by `factor` (<1 = in), keeping `anchorT` under the same screen x.
  const zoomAt = (factor: number, anchorT: number) => setZoom(zoomWindow(t0, t1, factor, anchorT, maxT));
  const reset = () => setZoom(null);

  // Ctrl/pinch-wheel zooms about the cursor (plain wheel still scrolls the
  // panel list). Native non-passive listener so we can preventDefault. The
  // listener is attached ONCE and reads the latest handler through a ref: it
  // used to re-attach on every zoom, pan and resize (each changes the window
  // it closes over), which is a remove/add pair per wheel notch.
  const onWheelRef = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    onWheelRef.current = (e: WheelEvent) => {
      const el = hostRef.current;
      if (!el || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const px = e.clientX - el.getBoundingClientRect().left - HOST_INSET;
      zoomAt(e.deltaY > 0 ? 1.2 : 1 / 1.2, invX(px));
    };
  });
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => onWheelRef.current(e);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hostRef]);

  // Pointer: drag pans (only when zoomed in). Each handler reports whether it
  // took the event, so the caller can hand the rest to the hover crosshair.
  const drag = useRef<{ x: number; t0: number; t1: number } | null>(null);
  const startPan = (e: ReactPointerEvent): boolean => {
    if (!zoomed) return false; // nothing to pan at full view — keep hover behavior
    drag.current = { x: e.clientX, t0, t1 };
    hostRef.current?.setPointerCapture?.(e.pointerId);
    return true;
  };
  const pan = (e: ReactPointerEvent): boolean => {
    if (!drag.current) return false;
    const span = drag.current.t1 - drag.current.t0;
    const dt = ((e.clientX - drag.current.x) / iw) * span;
    setZoom(clampWindow(drag.current.t0 - dt, drag.current.t1 - dt, maxT));
    return true;
  };
  const endPan = (e: ReactPointerEvent) => {
    if (drag.current) {
      drag.current = null;
      hostRef.current?.releasePointerCapture?.(e.pointerId);
    }
  };
  const isPanning = () => drag.current !== null;

  return { t0, t1, zoomed, X, invX, localX, zoomAt, reset, startPan, pan, endPan, isPanning };
}
