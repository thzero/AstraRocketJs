import { create } from 'zustand';

interface HelpState {
  /**
   * The docs page the Help dialog is open ON, or null while it is closed.
   * `''` is the docs index, so null and '' are different states.
   */
  page: string | null;
  /** Open Help on a docs page (slug, optionally with `#anchor`). */
  openHelp: (page?: string) => void;
  closeHelp: () => void;
}

/**
 * Which docs page the in-app Help dialog is showing.
 *
 * A store of its own rather than another flag in AppHeader's dialog host
 * (HeaderDialogs) because the point of in-app help is opening it ON the thing
 * you are looking at. The Safety card wants the Safety page and lives in the
 * results panel; a component that needs help for its own field is nowhere near
 * the header either. Threading an opener down to each of them is the prop
 * drilling this store exists to avoid, and the dialog is app-wide anyway: only
 * one can be open, the same shape as the confirm store.
 */
export const useHelpStore = create<HelpState>((set) => ({
  page: null,
  openHelp: (page = '') => set({ page }),
  closeHelp: () => set({ page: null }),
}));
