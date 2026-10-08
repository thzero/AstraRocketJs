import type { StateCreator } from 'zustand';
import { isResultView, type Tab, type DesignPane, type ViewMode } from './tabs';
import type { WorkspaceState } from './store';

/**
 * Navigation: which tab and pane are open, which view the center pane shows,
 * and the 2D schematic's own controls. None of it is part of the design, so it
 * is not in undo history and not saved with the design.
 */
export interface ViewSlice {
  tab: Tab;
  /** Which half of the Design tab a phone shows; ignored at lg+, where both do. */
  designPane: DesignPane;
  view: ViewMode;
  twoD: 'side' | 'aft';
  roll: number; // 2D fin-spin, radians, kept in [0, 2π)
  resetKey: number; // bump to remount the 2D schematic

  setTab: (tab: Tab) => void;
  /** Open the Design tab on one of its two phone panes (see {@link DesignPane}). */
  setDesignPane: (pane: DesignPane) => void;
  setView: (view: ViewMode) => void;
  setTwoD: (v: 'side' | 'aft') => void;
  setRoll: (roll: number) => void;
  rollBy: (d: number) => void;
  resetView: () => void;
}

/**
 * A `view` paired with a tab that can actually show it.
 *
 * On a phone the center pane backs two tabs and each owns a family: Sketch the
 * design views, Results the flight ones. Rocket and Simulate show no view at
 * all, so a caller sitting on either is left where it is.
 *
 * Every write of `view` goes through this. Writing the two apart lands you on a
 * Results tab with no result and an empty view switch.
 */
export function showing(s: { tab: Tab; designPane: DesignPane }, view: ViewMode): Partial<WorkspaceState> {
  // The Simulate tab and the phone's Rocket pane show stats and the run, not a
  // view at all, so a caller sitting on either is left where it is.
  if (s.tab === 'sim' || (s.tab === 'design' && s.designPane === 'stats')) return { view };
  return isResultView(view)
    ? { view, tab: 'results' }
    : // Coming back from Results, the drawing is what shows a design view, so a
      // phone lands on the Sketch pane rather than the stats it was never asked for.
      { view, tab: 'design', designPane: 'sketch' };
}

export const createViewSlice: StateCreator<WorkspaceState, [], [], ViewSlice> = (set) => ({
  tab: 'design',
  designPane: 'stats',
  view: '2d',
  twoD: 'side',
  roll: 0,
  resetKey: 0,

  // The three below keep the mobile tab and the center-pane view in step (see
  // {@link showing}). Harmless at desktop widths, where the tab bar is hidden
  // and `tab` only decides what a later resize lands on.
  setTab: (tab) =>
    set((s) => {
      if (tab === 'results') return { tab, view: isResultView(s.view) ? s.view : 'flight' };
      if (tab === 'design') return { tab, view: isResultView(s.view) ? '2d' : s.view };
      return { tab };
    }),
  setDesignPane: (designPane) =>
    set((s) => ({ tab: 'design', designPane, view: isResultView(s.view) ? '2d' : s.view })),
  setView: (view) => set((s) => showing(s, view)),
  setTwoD: (twoD) => set({ twoD }),
  setRoll: (roll) => set({ roll }),
  rollBy: (d) =>
    set((s) => {
      const x = (s.roll + d) % (2 * Math.PI);
      return { roll: x < 0 ? x + 2 * Math.PI : x };
    }),
  resetView: () => set((s) => ({ roll: 0, resetKey: s.resetKey + 1 })),
});
