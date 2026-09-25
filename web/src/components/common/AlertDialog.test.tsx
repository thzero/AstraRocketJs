// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, within } from '@testing-library/react';
import { AlertDialog } from './AlertDialog';
import { renderWithProviders } from '../../testing/renderWithProviders';

/**
 * The shell behind the confirmation prompt and the work-in-progress notice.
 *
 * They were two copies with the same shape and different details: different
 * backdrop opacities, different heading scales, one naming itself with an
 * `aria-label` that repeated its own visible heading and the other with a
 * hardcoded element id, neither describing its message to a screen reader, and
 * one carrying a window-level Escape listener beside the one useFocusTrap
 * already provides. These are the guarantees that replace all of that.
 */

/**
 * Stock jsdom reports `offsetParent === null` for every element, so
 * useFocusTrap's visibility filter sees no focusable children and the focus
 * behavior under test here is invisible. A browser gives every laid-out element
 * an offsetParent.
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
  if (offsetParent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParent);
});

const open = (props: Partial<Parameters<typeof AlertDialog>[0]> = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const r = renderWithProviders(
    <AlertDialog
      title="Delete it?"
      message="This cannot be undone."
      confirmLabel="Delete"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { ...r, onConfirm, onCancel, dialog: within(r.container).getByRole('alertdialog') };
};

/** The overlay is the panel's parent; it carries no class of its own to find. */
const backdrop = (dialog: HTMLElement) => dialog.parentElement!;

describe('AlertDialog', () => {
  describe('what it announces', () => {
    it('names itself by its visible heading and DESCRIBES itself by its message', () => {
      // The description is the half an alertdialog needs and a plain dialog does
      // not: the message is what should be read out on arrival, and neither copy
      // pointed at it.
      const { dialog } = open();
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.getAttribute('aria-label')).toBeNull();

      const named = dialog.querySelector(`#${CSS.escape(dialog.getAttribute('aria-labelledby')!)}`)!;
      expect(named.tagName).toBe('H2');
      expect(named.textContent).toBe('Delete it?');

      const described = dialog.querySelector(`#${CSS.escape(dialog.getAttribute('aria-describedby')!)}`)!;
      expect(described.textContent).toBe('This cannot be undone.');
    });

    it('gives two prompts on screen at once their own ids', () => {
      // One of these used to hardcode `id="wip-title"`, which is only safe for
      // as long as it is the only one.
      const r = renderWithProviders(
        <>
          <AlertDialog title="First" message="a" confirmLabel="ok" onConfirm={() => {}} />
          <AlertDialog title="Second" message="b" confirmLabel="ok" onConfirm={() => {}} />
        </>,
      );
      const [a, b] = within(r.container).getAllByRole('alertdialog');
      expect(a!.getAttribute('aria-labelledby')).not.toBe(b!.getAttribute('aria-labelledby'));
    });

    it('stays a centered card on a phone instead of filling it', () => {
      // `.dialog-panel` is what opts a surface into the full-bleed rules in
      // index.css. A screen filled with two lines and a button is empty space,
      // and one of these opens over a dialog that IS full-screen there.
      const { dialog } = open();
      expect(dialog.className).not.toContain('dialog-panel');
      expect(backdrop(dialog).className).not.toContain('dialog-overlay');
    });
  });

  describe('the way out', () => {
    it('is the button, Escape and the backdrop, all the same way out', () => {
      const a = open();
      fireEvent.click(within(a.dialog).getByText('Cancel'));
      expect(a.onCancel).toHaveBeenCalledTimes(1);
      a.unmount();

      const b = open();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(b.onCancel).toHaveBeenCalledTimes(1);
      b.unmount();

      const c = open();
      fireEvent.click(backdrop(c.dialog));
      expect(c.onCancel).toHaveBeenCalledTimes(1);
    });

    it('takes its own label when one is given', () => {
      const { dialog } = open({ cancelLabel: 'Keep' });
      expect(within(dialog).getByText('Keep')).toBeTruthy();
      expect(within(dialog).queryByText('Cancel')).toBeNull();
    });

    it('is absent in every form for a prompt that must be acknowledged', () => {
      // One prop decides all three, rather than three things the notice has to
      // remember not to do.
      const { dialog, onConfirm } = open({ onCancel: undefined });
      expect(within(dialog).queryByText('Cancel')).toBeNull();
      fireEvent.keyDown(window, { key: 'Escape' });
      fireEvent.click(backdrop(dialog));
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('swallows Escape rather than passing it to what is underneath', () => {
      // A gate that blocks the app has to block the key too: letting it through
      // would close the dialog behind it while the gate stayed up.
      const under = vi.fn();
      renderWithProviders(
        <>
          <AlertDialog title="Under" message="a" confirmLabel="ok" onConfirm={() => {}} onCancel={under} />
          <AlertDialog title="Gate" message="b" confirmLabel="ok" onConfirm={() => {}} />
        </>,
      );
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(under).not.toHaveBeenCalled();
    });

    it('does not let a click inside it reach the backdrop', () => {
      const { dialog, onCancel } = open();
      fireEvent.click(within(dialog).getByText('This cannot be undone.'));
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe('the buttons', () => {
    it('focuses confirm, though cancel comes first in reading order', () => {
      // The pair it took a bug to get right: the trap moved focus to the first
      // focusable child after React had honored `autoFocus`, so the focus ring
      // sat on Cancel while Enter ran the destructive action.
      const { dialog } = open();
      const buttons = within(dialog).getAllByRole('button');
      expect(buttons.map((b) => b.textContent)).toEqual(['Cancel', 'Delete']);
      expect(document.activeElement).toBe(buttons[1]);
    });

    it('paints a destructive confirm red', () => {
      const plain = open();
      expect(within(plain.dialog).getByText('Delete').className).toContain('bg-sky-600');
      plain.unmount();
      const danger = open({ danger: true });
      expect(within(danger.dialog).getByText('Delete').className).toContain('bg-red-600');
    });

    it('confirms on its own button only', () => {
      const { dialog, onConfirm, onCancel } = open();
      fireEvent.click(within(dialog).getByText('Delete'));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  it('takes a named layer rather than a hand-picked z-index', () => {
    expect(backdrop(open({ layer: 'top' }).dialog).className).toContain('z-[70]');
  });

  it('shows an icon without reading it out as part of the message', () => {
    const { dialog } = open({ icon: '🚧' });
    const icon = within(dialog).getByText('🚧');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    // Not inside the described message, so a screen reader gets the words only.
    expect(dialog.querySelector(`#${CSS.escape(dialog.getAttribute('aria-describedby')!)}`)!.contains(icon)).toBe(
      false,
    );
  });
});
