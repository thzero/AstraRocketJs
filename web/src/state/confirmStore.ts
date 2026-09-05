import { create } from 'zustand';

export interface ConfirmOptions {
  /** Dialog heading; defaults to a generic "Are you sure?" at render. */
  title?: string;
  /** Body text — the question being asked. */
  message: string;
  /** Confirm-button label; defaults to a generic "Confirm". */
  confirmLabel?: string;
  /** Cancel-button label; defaults to "Cancel". */
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
}

interface ConfirmState {
  request: (ConfirmOptions & { resolve: (v: boolean) => void }) | null;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Resolve the open request with the user's choice and close the dialog. */
  settle: (result: boolean) => void;
}

/**
 * Drives the single app-wide {@link ConfirmDialog}. A promise-based, imperative
 * confirm so BOTH React components and non-React callers (the workspace store)
 * can gate a destructive action on a styled in-app dialog — `window.confirm`'s
 * native popup replacement.
 */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      // A new request while one is open cancels the previous (its promise
      // resolves false) so a resolver is never dropped.
      get().request?.resolve(false);
      set({ request: { ...opts, resolve } });
    }),
  settle: (result) => {
    const r = get().request;
    if (!r) return;
    set({ request: null });
    r.resolve(result);
  },
}));

/** Show the app's confirmation dialog and resolve to the user's choice. Usable
 *  from anywhere (components or the store). */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().confirm(opts);
}
