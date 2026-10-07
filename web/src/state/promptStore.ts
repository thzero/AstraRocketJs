import { createRequestStore } from './requestStore';

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

/**
 * Drives the single app-wide {@link PromptDialog}: the name dialog as a
 * promise, so the workspace store can ask for a name mid-action.
 *
 * The sibling of {@link confirmStore}, and for the same reason: the import path
 * needs a name BEFORE it hands a rocket to the library, and it lives in the store,
 * so naming cannot be reachable only through the header's dialog host. Letting the
 * import land first and naming it afterwards is the race that fills the library
 * with copies.
 */
export const usePromptStore = createRequestStore<PromptOptions, string | null>(null);

/** Ask for a name and resolve to it, or to null if the user canceled. Usable
 *  from anywhere (components or the store). */
export function prompt(opts: PromptOptions): Promise<string | null> {
  return usePromptStore.getState().open(opts);
}
