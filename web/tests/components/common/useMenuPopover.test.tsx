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
