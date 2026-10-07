import { useWorkspaceStore } from './store';
import { errorMessage } from '../services/app/errorMessage';

/**
 * Fire an async store action from an event handler, and report a rejection it
 * forgot to catch.
 *
 * Every async action in the store catches its own failures and reports them
 * through `err`, and that convention is the only reason a bare `onSave()` in a
 * click handler was ever safe. It was convention ONLY: an action that forgets
 * leaves a click that silently does nothing, with every gate green, which is why
 * `no-floating-promises` was worth enabling rather than silencing.
 *
 * `void onSave()` would satisfy the rule and keep the hazard exactly as it was.
 * This attaches the handler the action should have had, so a forgotten catch
 * surfaces in the same banner a remembered one uses, and a click can no longer
 * fail in silence.
 *
 * Takes `void` as well as a promise, so a caller does not have to know which
 * actions are async - the ones that are not simply pass through.
 */
export function fireAction(result: Promise<unknown> | void): void {
  if (!result) return;
  result.catch((e: unknown) => {
    useWorkspaceStore.getState().setErr(errorMessage(e));
  });
}
