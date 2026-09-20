// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { ImageExportMenu } from './ImageExportMenu';
import { IMAGE_WIDTHS } from '../../services/schematicExport.js';

/**
 * The menu-button contract, which this popover declared and did not keep.
 *
 * The trigger carries `aria-haspopup="menu"` and the popover `role="menu"`,
 * but its children were plain buttons - and a `menu` whose children are not
 * `menuitem` is an invalid structure that screen readers announce as "menu, 0
 * items", with the width buttons unreachable by menu navigation. Escape and
 * focus-return are the rest of the contract; only an outside pointerdown used
 * to close it, so a keyboard user who opened it was stuck inside. `AppHeader`
 * implements all of this and `e2e/a11y.spec.ts` covers it there, which is
 * exactly why this one going without was easy to miss.
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

  it('does not swallow Escape keys that were not meant for it', () => {
    open();
    // A key other than Escape leaves the menu alone.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'a' });
    expect(screen.queryByRole('menu')).not.toBeNull();
  });
});
