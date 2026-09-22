import { create } from 'zustand';

export interface PromptOptions {
  /** Dialog heading. */
  title: string;
  /** Confirm-button label. */
  confirmLabel: string;
  /** Value the field opens with, selected so typing replaces it. */
  initialName: string;
  /** Names already in use, to warn about a duplicate (not to forbid it). */
  takenNames?: string[];
}

interface PromptState {
  request: (PromptOptions & { resolve: (v: string | null) => void }) | null;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  /** Resolve the open request with the typed name, or null if canceled. */
  settle: (result: string | null) => void;
}

/**
 * Drives the single app-wide {@link PromptDialog}: the name dialog as a
 * promise, so the workspace store can ask for a name mid-action.
 *
 * The sibling of {@link confirmStore}, and for the same reason. Naming used to
 * be reachable only through the header's dialog host, which means only a React
 * component could raise it — but the import path needs an answer BEFORE it
 * hands a rocket to the library, and it lives in the store. The alternative
 * was letting the import land first and naming it afterwards, which is exactly
 * the race that fills the library with copies.
 */
export const usePromptStore = create<PromptState>((set, get) => ({
  request: null,
  prompt: (opts) =>
    new Promise<string | null>((resolve) => {
      // A new request while one is open cancels the previous (its promise
      // resolves null) so a resolver is never dropped.
      get().request?.resolve(null);
      set({ request: { ...opts, resolve } });
    }),
  settle: (result) => {
    const r = get().request;
    if (!r) return;
    set({ request: null });
    r.resolve(result);
  },
}));

/** Ask for a name and resolve to it, or to null if the user canceled. Usable
 *  from anywhere (components or the store). */
export function prompt(opts: PromptOptions): Promise<string | null> {
  return usePromptStore.getState().prompt(opts);
}
