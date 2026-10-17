import { useEffect } from 'react';
import { useWorkspaceStore } from '../../state/store';
import { isTextEntry } from '../common/isTextEntry';
import { topmostSurface } from '../common/useFocusTrap';

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
 * field undo from running. A checkbox, radio, range, color input or select has
 * no undo of its own, so the shortcut still works with one of those focused.
 *
 * Not while a modal surface is open either. The design sits behind it, so an
 * undo there would change what the user cannot see, under a dialog that says
 * it is the only thing taking input. The component editor is the exception
 * while it is on top: it shows the part being edited, and below the widest
 * layout it is where all part editing happens, so its edits undo as they do
 * in the property column. A surface opened over it blocks the shortcut again.
 */
const UNDO_SURFACE = '[data-dialog="component-editor"]';

const blockedBySurface = (): boolean => {
  const top = topmostSurface();
  return top !== null && !top.matches(UNDO_SURFACE);
};

export function useUndoShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (isTextEntry(document.activeElement) || blockedBySurface()) return;
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
