// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { ConfirmDialog } from '../../../src/components/common/ConfirmDialog';
import { confirm, useConfirmStore } from '../../../src/state/confirmStore';

/**
 * Stock jsdom reports `offsetParent === null` for every element, so
 * useFocusTrap's visibility filter saw no focusable children at all and the
 * behavior under test here (which button ends up focused) was invisible to
 * the suite. A browser gives every laid-out element an offsetParent.
 */
let offsetParent: PropertyDescriptor | undefined;
beforeEach(() => {
  offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return document.body;
    },
  });
});
afterEach(() => {
  cleanup();
  if (offsetParent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParent);
  useConfirmStore.setState({ request: null });
});

describe('ConfirmDialog keyboard behavior', () => {
  /**
   * useFocusTrap moved focus to the first focusable element in DOM order from
   * a passive effect, after React had already honored `autoFocus` in commit.
   * Cancel comes first, so the visibly focused button was Cancel, while a
   * window-level Enter handler called `settle(true)` for every target. A
   * keyboard user saw the focus ring on Cancel, pressed Enter, and the
   * destructive action went ahead.
   */
  it('focus lands on Confirm (the autoFocus target), not on Cancel', async () => {
    render(<ConfirmDialog />);
    let done: Promise<boolean>;
    act(() => {
      done = confirm({ message: 'Delete it?', confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true });
    });
    const confirmBtn = await screen.findByRole('button', { name: 'Delete' });
    expect(document.activeElement).toBe(confirmBtn);
    act(() => useConfirmStore.getState().settle(false));
    expect(await done!).toBe(false);
  });

  it('Enter with Cancel focused does not confirm', async () => {
    render(<ConfirmDialog />);
    let done: Promise<boolean>;
    act(() => {
      done = confirm({ message: 'Delete it?', confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true });
    });
    const cancelBtn = await screen.findByRole('button', { name: 'Keep' });
    act(() => cancelBtn.focus());
    expect(document.activeElement).toBe(cancelBtn);
    // A window-level Enter listener would have settled true here regardless of
    // the target; native activation of the focused button is what should run.
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(useConfirmStore.getState().request).not.toBeNull();
    fireEvent.click(cancelBtn);
    expect(await done!).toBe(false);
  });

  it('Escape cancels', async () => {
    render(<ConfirmDialog />);
    let done: Promise<boolean>;
    act(() => {
      done = confirm({ message: 'Delete it?' });
    });
    await screen.findByRole('alertdialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await done!).toBe(false);
  });
});
