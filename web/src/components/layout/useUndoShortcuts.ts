import { useEffect } from 'react';
import { useWorkspaceStore } from '../../state/store';
import { isTextEntry } from '../common/isTextEntry';

/**
 * Keyboard: Ctrl/Cmd+Z undoes, Ctrl+Shift+Z / Ctrl+Y redoes, globally. The
 * store actions flush any in-flight edit and no-op on an empty stack, so this
 * is safe to call unconditionally; it goes through getState to stay
 * independent of render timing.
 *
 * Not while a text field has focus. Edits commit on blur, so Ctrl+Z mid-edit in
 * the Save As name box, a component Name, the motor search or a custom
 * material's name would otherwise discard the last rocket geometry edit instead
 * of the characters just typed, and preventDefault would stop the browser's own
 * field undo from running.
 * MotorDashboard's arrow-key handler makes exactly this check.
 */
export function useUndoShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (isTextEntry(document.activeElement)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useWorkspaceStore.getState().undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        useWorkspaceStore.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
