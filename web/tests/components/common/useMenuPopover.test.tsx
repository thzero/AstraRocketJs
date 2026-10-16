// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useMenuPopover } from '../../../src/components/common/useMenuPopover';

function Menu() {
  const { open, toggle, wrapRef, triggerRef } = useMenuPopover();
  return (
    <div>
      <div ref={wrapRef}>
        <button ref={triggerRef} onClick={toggle}>
          Open
        </button>
        {open && (
          <div role="menu">
            <button role="menuitem">Item</button>
          </div>
        )}
      </div>
      <p>Outside</p>
    </div>
  );
}

afterEach(cleanup);

describe('useMenuPopover', () => {
  it('opens and closes from the trigger', () => {
    render(<Menu />);
    fireEvent.click(screen.getByText('Open'));
    expect(screen.queryByRole('menu')).not.toBeNull();
    fireEvent.click(screen.getByText('Open'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on a press outside, not on one inside', () => {
    render(<Menu />);
    fireEvent.click(screen.getByText('Open'));
    fireEvent.pointerDown(screen.getByRole('menuitem'));
    expect(screen.queryByRole('menu')).not.toBeNull();
    fireEvent.pointerDown(screen.getByText('Outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape, returns focus to the trigger and marks the key spent', () => {
    render(<Menu />);
    fireEvent.click(screen.getByText('Open'));
    let spent = false;
    const late = (e: KeyboardEvent) => (spent = e.defaultPrevented);
    window.addEventListener('keydown', late);
    fireEvent.keyDown(screen.getByRole('menuitem'), { key: 'Escape' });
    window.removeEventListener('keydown', late);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByText('Open'));
    // A window listener such as the maximized canvas's can tell Escape closed the menu.
    expect(spent).toBe(true);
  });

  it('leaves Escape alone while closed', () => {
    render(<Menu />);
    let spent = true;
    const late = (e: KeyboardEvent) => (spent = e.defaultPrevented);
    window.addEventListener('keydown', late);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    window.removeEventListener('keydown', late);
    expect(spent).toBe(false);
  });
});

/** The ARIA menu keyboard model a `role="menu"` promises. */
describe('useMenuPopover menu keys', () => {
  function KeyMenu({ onHostKey }: { onHostKey?: () => void }) {
    const { open, toggle, wrapRef, triggerRef, menuRef, onMenuKeyDown } = useMenuPopover();
    return (
      <div onKeyDown={onHostKey}>
        <div ref={wrapRef}>
          <button ref={triggerRef} onClick={toggle}>
            Open
          </button>
          {open && (
            <div role="menu" ref={menuRef} onKeyDown={onMenuKeyDown}>
              <button role="menuitem" tabIndex={-1}>
                One
              </button>
              <button role="menuitemradio" aria-checked tabIndex={-1}>
                Two
              </button>
              <button role="menuitem" tabIndex={-1}>
                Three
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
  const item = (name: string) => screen.getByText(name);

  it('moves focus to the first item on open', () => {
    render(<KeyMenu />);
    fireEvent.click(screen.getByText('Open'));
    expect(document.activeElement).toBe(item('One'));
  });

  it('walks the items with the arrows, wrapping, and jumps with Home and End', () => {
    render(<KeyMenu />);
    fireEvent.click(screen.getByText('Open'));
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('Two'));
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(item('Three'));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('One'));
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(item('Three'));
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(item('One'));
  });

  it('keeps the keys it handles from the host around it', () => {
    let hostSaw = 0;
    render(<KeyMenu onHostKey={() => hostSaw++} />);
    fireEvent.click(screen.getByText('Open'));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(hostSaw).toBe(0);
  });

  it('closes on Tab and lets focus move on', () => {
    render(<KeyMenu />);
    fireEvent.click(screen.getByText('Open'));
    expect(fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' })).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
