import { useWorkspaceStore } from './store';
import { errorMessage } from '../services/app/errorMessage';

/**
 * Fire an async store action from an event handler, and report a rejection it
 * forgot to catch.
 *
 * Every async action in the store is meant to catch its own failures and report
 * them through `err`, but that is only a convention: an action that forgets
 * leaves a click that silently does nothing, with every gate green. That is the
 * hazard `no-floating-promises` flags.
 *
 * `void onSave()` would satisfy the rule and keep the hazard.
 * This attaches the handler the action should have had, so a forgotten catch
 * surfaces in the same banner a remembered one uses, and a click cannot fail
 * in silence.
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
