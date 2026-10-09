// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { FileMenuButton, type FileMenuActions } from '../../../src/components/layout/FileMenu';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useUpdateStore } from '../../../src/state/updateStore';

const actions = () =>
  new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
    get: (target, key: string) => (target[key] ??= vi.fn()),
  }) as unknown as FileMenuActions & Record<string, ReturnType<typeof vi.fn>>;

const openMenu = (canSave: boolean) => {
  const a = actions();
  renderWithProviders(<FileMenuButton canSave={canSave} actions={a} />);
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
  return a;
};

/**
 * The file menu holds only menu items and separators, and a disabled item stays
 * reachable by the arrow keys, so the reason it is disabled can be heard.
 */
describe('FileMenu structure', () => {
  // jsdom has no matchMedia; the menu asks it whether the window can build a
  // design (useCanBuildDesign). Answer "desktop".
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });

  it('marks its dividers as separators', () => {
    openMenu(true);
    const menu = screen.getByRole('menu');
    expect(menu.querySelectorAll('[role="separator"]').length).toBe(4);
    for (const child of Array.from(menu.children))
      expect(['menuitem', 'separator']).toContain(child.getAttribute('role'));
  });

  it('keeps a disabled item focusable, inert and described', () => {
    useUpdateStore.setState({ checker: null } as never);
    const a = openMenu(false);
    const saveAs = screen.getByRole('menuitem', { name: 'Save As…' });
    expect(saveAs.getAttribute('aria-disabled')).toBe('true');
    expect(saveAs.hasAttribute('disabled')).toBe(false);
    fireEvent.click(saveAs);
    expect(a.onSaveAs).not.toHaveBeenCalled();

    const check = screen.getByRole('menuitem', { name: 'Check for updates' });
    expect(check.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(check.getAttribute('aria-describedby')!);
    expect(reason?.textContent).toMatch(/development server/);
  });

  it('moves onto a disabled item with the arrow keys', () => {
    // jsdom lays nothing out, so every element reports no offsetParent, which
    // the menu reads as hidden.
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      return this.parentElement;
    });
    openMenu(false);
    const menu = screen.getByRole('menu');
    const open = screen.getByRole('menuitem', { name: 'Open…' });
    open.focus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Save As…' }));
    spy.mockRestore();
  });
});
