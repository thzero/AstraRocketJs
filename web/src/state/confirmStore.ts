import { createRequestStore } from './requestStore';

export interface ConfirmOptions {
  /** Dialog heading; defaults to a generic "Are you sure?" at render. */
  title?: string;
  /** Body text: the question being asked. */
  message: string;
  /** Confirm-button label; defaults to a generic "Confirm". */
  confirmLabel?: string;
  /** Cancel-button label; defaults to "Cancel". */
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
}

/**
 * Drives the single app-wide {@link ConfirmDialog}. A promise-based, imperative
 * confirm so both React components and non-React callers (the workspace store)
 * can gate a destructive action on a styled in-app dialog instead of
 * `window.confirm`'s native popup.
 */
export const useConfirmStore = createRequestStore<ConfirmOptions, boolean>(false);

/** Show the app's confirmation dialog and resolve to the user's choice. Usable
 *  from anywhere (components or the store). */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().open(opts);
}
