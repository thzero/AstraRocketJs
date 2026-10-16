// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUndoShortcuts } from '../../../src/components/layout/useUndoShortcuts';
import { useWorkspaceStore } from '../../../src/state/store';

/**
 * Ctrl+Z and Ctrl+Y reach the design only when nothing modal is over it: the
 * design behind an open dialog is not what the user is looking at.
 */
describe('useUndoShortcuts', () => {
  const undo = vi.fn();
  const redo = vi.fn();
  let real: { undo: () => void; redo: () => void };

  beforeEach(() => {
    real = { undo: useWorkspaceStore.getState().undo, redo: useWorkspaceStore.getState().redo };
    useWorkspaceStore.setState({ undo, redo });
    undo.mockClear();
    redo.mockClear();
  });
  afterEach(() => {
    useWorkspaceStore.setState(real);
    document.body.innerHTML = '';
  });

  const press = (key: string) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }));

  it('undoes and redoes with no dialog open', () => {
    renderHook(() => useUndoShortcuts());
    press('z');
    press('y');
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it('does nothing while a modal surface is open, even with focus on a button', () => {
    renderHook(() => useUndoShortcuts());
    const dialog = document.createElement('div');
    dialog.setAttribute('data-modal-surface', '');
    const button = document.createElement('button');
    dialog.appendChild(button);
    document.body.appendChild(dialog);
    button.focus();
    press('z');
    press('y');
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });
});
