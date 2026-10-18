// @vitest-environment jsdom
// cspell:ignore ширина
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { ImageExportMenu } from '../../../src/components/canvas/ImageExportMenu';
import { IMAGE_WIDTHS } from '../../../src/services/exports/schematicExport.js';

/**
 * The menu-button contract this popover declares.
 *
 * The trigger carries `aria-haspopup="menu"` and the popover `role="menu"`, so
 * its children must be `menuitem`s: a `menu` with plain button children is an
 * invalid structure that screen readers announce as "menu, 0 items", with the
 * width buttons unreachable by menu navigation. Escape and focus-return are the
 * rest of the contract; with only an outside pointerdown to close it, a keyboard
 * user who opened it would be stuck inside.
 */

const open = (onPick = vi.fn(), fitOption = false) => {
  renderWithProviders(<ImageExportMenu label="Image" title="Export image" onPick={onPick} fitOption={fitOption} />);
  const trigger = screen.getByRole('button', { name: 'Image' });
  fireEvent.click(trigger);
  return { trigger, onPick };
};

describe('the popover is a real menu', () => {
  it('advertises itself on the trigger, and tracks open state', () => {
    renderWithProviders(<ImageExportMenu label="Image" title="Export image" onPick={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Image' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('exposes every width choice as a menuitem, not "menu, 0 items"', () => {
    open();
    screen.getByRole('menu');
    // One row per format (PNG, JPG) times the width presets.
    expect(screen.getAllByRole('menuitem')).toHaveLength(2 * IMAGE_WIDTHS.length);
  });

  it('names each item with its format, so the two rows do not read the same', () => {
    open();
    const names = screen.getAllByRole('menuitem').map((el) => el.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((n) => n?.startsWith('PNG '))).toHaveLength(IMAGE_WIDTHS.length);
    expect(names.filter((n) => n?.startsWith('JPG '))).toHaveLength(IMAGE_WIDTHS.length);
    expect(names[0]).toContain(`${IMAGE_WIDTHS[0]} px`);
  });

  it('builds each item name from one key, so the words follow the UI language', async () => {
    const i18n = (await import('../../../src/i18n')).default;
    await i18n.changeLanguage('ru');
    try {
      open();
      const first = screen.getAllByRole('menuitem')[0]!.getAttribute('aria-label');
      expect(first).toContain(`ширина ${IMAGE_WIDTHS[0]}`);
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('offers the fit setting as a checked menu item, a valid child of the menu', () => {
    open(vi.fn(), true);
    expect(screen.getByRole('menuitemcheckbox').getAttribute('aria-checked')).toBe('true');
  });

  it('still picks the format and width it was clicked for', () => {
    const { onPick } = open();
    const items = screen.getAllByRole('menuitem');
    fireEvent.click(items[0]!); // first PNG width
    expect(onPick).toHaveBeenCalledWith('png', IMAGE_WIDTHS[0], { fit: false });
  });

  it('carries the fit toggle through when the caller offers one', () => {
    const onPick = vi.fn();
    open(onPick, true);
    fireEvent.click(screen.getAllByRole('menuitem')[0]!);
    expect(onPick).toHaveBeenCalledWith('png', IMAGE_WIDTHS[0], { fit: true }); // defaults on
  });
});

describe('a keyboard user can get back out', () => {
  it('closes on Escape', () => {
    open();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('returns focus to the trigger, rather than dropping it on the body', () => {
    // Focus left on <body> is the failure mode that makes a popover feel like
    // a dead end: Tab restarts from the top of the document.
    const { trigger } = open();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('stays open on a key other than Escape', () => {
    open();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'a' });
    expect(screen.queryByRole('menu')).not.toBeNull();
  });
});

/**
 * Choosing a width closes the menu and unmounts the focused item. Focus goes
 * back to the trigger, or a keyboard export ends on `<body>`.
 */
describe('focus after a choice', () => {
  it('returns to the trigger', () => {
    const { trigger, onPick } = open();
    const item = screen.getAllByRole('menuitem')[0]!;
    item.focus();
    fireEvent.click(item);
    expect(onPick).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('the menu keyboard model', () => {
  it('opens onto the first width and walks the rest with the arrows', () => {
    open(vi.fn(), true);
    const items = [...screen.getAllByRole('menuitem'), screen.getByRole('menuitemcheckbox')];
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('keeps a decorative icon out of the trigger’s name', () => {
    renderWithProviders(<ImageExportMenu icon="📷" label="Image" title="Export image" onPick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Image' }).textContent).toBe('📷 Image');
  });
});
