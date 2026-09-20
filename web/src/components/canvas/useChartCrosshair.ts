import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Owns the flight chart's hover crosshair time: the state itself, the
 * keyboard stepping (arrows, Shift for coarse, Home/End, Escape) and the
 * focus/blur seeding that makes the crosshair reachable without a mouse.
 * Pointer moves set it through `setHoverT` from FlightChart, after the zoom
 * hook has declined the event as a pan.
 */
export function useChartCrosshair(t0: number, t1: number) {
  const [hoverT, setHoverT] = useState<number | null>(null);
  const clampT = (v: number) => Math.max(t0, Math.min(t1, v));

  /** Arrow-key crosshair. Time is continuous here, so it steps by span. */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const span = t1 - t0;
    if (!(span > 0)) return;
    const step = (e.shiftKey ? 10 : 1) * (span / 100);
    let next: number;
    if (e.key === 'ArrowRight') next = (hoverT ?? t0) + step;
    else if (e.key === 'ArrowLeft') next = (hoverT ?? t1) - step;
    else if (e.key === 'Home') next = t0;
    else if (e.key === 'End') next = t1;
    else if (e.key === 'Escape') {
      setHoverT(null);
      return;
    } else return;
    e.preventDefault(); // arrows would otherwise scroll the pane
    setHoverT(clampT(next));
  };
  const onFocus = () => setHoverT((h) => h ?? (t0 + t1) / 2);
  const onBlur = () => setHoverT(null);

  return { hoverT, setHoverT, clampT, onKeyDown, onFocus, onBlur };
}
