import { useState } from 'react';
import type { ViewMode } from '../components/canvas/ViewToggle';
import type { Tab } from '../components/layout/TabBar';

/**
 * Ephemeral view/navigation UI state for the workbench: the mobile pane tab, the
 * center view mode, the 2D side/aft toggle + roll angle, and a reset nonce that
 * remounts the 2D schematic (clearing its zoom/pan). Fully self-contained.
 */
export function useViewState() {
  const [tab, setTab] = useState<Tab>('build');
  const [view, setView] = useState<ViewMode>('2d');
  const [twoD, setTwoD] = useState<'side' | 'aft'>('side');
  const [roll, setRoll] = useState(0); // 2D fin-spin, radians — kept in [0, 2π)
  // Drag-to-roll: accumulate the delta but wrap so roll never leaves [0, 360°).
  const rollBy = (d: number) => setRoll((r) => { const x = (r + d) % (2 * Math.PI); return x < 0 ? x + 2 * Math.PI : x; });
  const [resetKey, setResetKey] = useState(0); // bump to remount the 2D schematic
  const resetView = () => { setRoll(0); setResetKey((k) => k + 1); };

  return { tab, setTab, view, setView, twoD, setTwoD, roll, setRoll, rollBy, resetKey, resetView };
}
