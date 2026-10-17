// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, screen } from '@testing-library/react';
import { useUndoShortcuts } from '../../../src/components/layout/useUndoShortcuts';
import { ComponentDialog } from '../../../src/components/design/ComponentDialog';
import { Dialog } from '../../../src/components/common/Dialog';
import { useWorkspaceStore } from '../../../src/state/store';
import { renderWithProviders } from '../../testing/renderWithProviders';

/**
 * Ctrl+Z and Ctrl+Y reach the design only when nothing modal is over it: the
 * design behind an open dialog is not what the user is looking at. The
 * component editor is the exception while it is on top, since it shows the
 * part being edited.
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
    cleanup();
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

  it('undoes with a checkbox, radio, range, color input or select focused, which have no undo of their own', () => {
    renderHook(() => useUndoShortcuts());
    const controls: HTMLElement[] = ['checkbox', 'radio', 'range', 'color'].map((type) => {
      const el = document.createElement('input');
      el.type = type;
      return el;
    });
    controls.push(document.createElement('select'));
    for (const el of controls) {
      document.body.appendChild(el);
      el.focus();
      press('z');
      press('y');
      el.remove();
    }
    expect(undo).toHaveBeenCalledTimes(controls.length);
    expect(redo).toHaveBeenCalledTimes(controls.length);
  });

  it('leaves Ctrl+Z to a focused text field', () => {
    renderHook(() => useUndoShortcuts());
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    press('z');
    expect(undo).not.toHaveBeenCalled();
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

  it('does nothing while any other dialog is open', () => {
    renderHook(() => useUndoShortcuts());
    for (const id of ['settings', 'library', 'test']) {
      const { unmount } = renderWithProviders(
        <Dialog id={id} title="Other" onClose={() => {}}>
          <p>body</p>
        </Dialog>,
      );
      press('z');
      press('y');
      unmount();
    }
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  /** The editor as it is mounted below the widest layout, opened by selecting a part. */
  const openEditor = () => {
    renderWithProviders(<ComponentDialog />);
    const { tree, setSelectedId } = useWorkspaceStore.getState();
    act(() => setSelectedId(tree.components[0]!.id!));
    return screen.getByRole('dialog');
  };

  it('undoes and redoes while the component editor is the dialog on top', () => {
    renderHook(() => useUndoShortcuts());
    const editor = openEditor();
    editor.querySelector<HTMLElement>('button')!.focus();
    press('z');
    press('y');
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it('still leaves Ctrl+Z to a text field in the component editor', () => {
    renderHook(() => useUndoShortcuts());
    const editor = openEditor();
    editor.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!.focus();
    press('z');
    expect(undo).not.toHaveBeenCalled();
  });

  it('does nothing while a dialog is open over the component editor', () => {
    renderHook(() => useUndoShortcuts());
    openEditor();
    renderWithProviders(
      <Dialog id="confirm" title="Over" onClose={() => {}}>
        <button>ok</button>
      </Dialog>,
    );
    screen.getByRole('button', { name: 'ok' }).focus();
    press('z');
    press('y');
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });
});
