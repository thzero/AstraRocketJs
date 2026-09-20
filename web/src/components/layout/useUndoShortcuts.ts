import { useEffect } from 'react';
import { useWorkspaceStore } from '../../state/store';

/**
 * Keyboard: Ctrl/Cmd+Z undoes, Ctrl+Shift+Z / Ctrl+Y redoes, globally. The
 * store actions flush any in-flight edit and no-op on an empty stack, so this
 * is safe to call unconditionally; it goes through getState to stay
 * independent of render timing.
 *
 * Not while a text field has focus. The argument for firing anyway was that
 * edits commit on blur, but Ctrl+Z mid-edit in the Save As name box, a
 * component Name, the motor search or a custom material's name then discarded
 * the last ROCKET GEOMETRY edit instead of the characters just typed, and
 * preventDefault stopped the browser's own field undo from ever running.
 * MotorDashboard's arrow-key handler makes exactly this check.
 */
export function useUndoShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      ) {
        return;
      }
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
