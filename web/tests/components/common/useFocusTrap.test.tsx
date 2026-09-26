// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useFocusTrap } from '../../../src/components/common/useFocusTrap';

/**
 * Stock jsdom reports `offsetParent === null` for every element, so the trap's
 * visibility filter would see no focusable children at all. A browser gives
 * every laid-out element an offsetParent.
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
});

function Panel({ active, onEscape }: { active: boolean; onEscape?: () => void }) {
  const ref = useFocusTrap<HTMLDivElement>(active, { onEscape });
  return (
    <div ref={ref} role="dialog">
      <button>first</button>
      <button>last</button>
    </div>
  );
}

describe('useFocusTrap', () => {
  it('keeps the boolean signature: focuses the first control and wraps Tab', () => {
    render(<Panel active />);
    const first = screen.getByRole('button', { name: 'first' });
    const last = screen.getByRole('button', { name: 'last' });
    expect(document.activeElement).toBe(first);
    last.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  /**
   * Sixteen dialogs each carried their own window keydown listener for Escape.
   * The one copy lives here now, so a regression here is a regression in every
   * modal at once.
   */
  it('calls onEscape on a window-level Escape while active', () => {
    const onEscape = vi.fn();
    render(<Panel active onEscape={onEscape} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while inactive', () => {
    const onEscape = vi.fn();
    render(<Panel active={false} onEscape={onEscape} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('stops listening once unmounted', () => {
    const onEscape = vi.fn();
    const { unmount } = render(<Panel active onEscape={onEscape} />);
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();
  });

  /**
   * The listener has to be on the window, because a dialog is not always the
   * thing focused when Escape is pressed. That meant every open surface heard
   * every Escape, and two of them both closed: dismissing the rename prompt
   * inside the design library shut the library behind it too.
   */
  describe('with more than one surface open', () => {
    it('gives Escape to the one on top, and only that one', () => {
      const under = vi.fn();
      const over = vi.fn();
      render(
        <>
          <Panel active onEscape={under} />
          <Panel active onEscape={over} />
        </>,
      );
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(over).toHaveBeenCalledTimes(1);
      expect(under).not.toHaveBeenCalled();
    });

    it('hands it back once the top one closes', () => {
      const under = vi.fn();
      const over = vi.fn();
      const { rerender } = render(
        <>
          <Panel active onEscape={under} />
          <Panel active onEscape={over} />
        </>,
      );
      rerender(
        <>
          <Panel active onEscape={under} />
        </>,
      );
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(under).toHaveBeenCalledTimes(1);
      expect(over).not.toHaveBeenCalled();
    });

    it('swallows it under a surface that cannot be dismissed', () => {
      // A modal with no onEscape is one that must not close on it
      // (WorkInProgressDialog). While it is on top, Escape does nothing at all
      // rather than closing whatever sits underneath.
      const under = vi.fn();
      render(
        <>
          <Panel active onEscape={under} />
          <Panel active />
        </>,
      );
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(under).not.toHaveBeenCalled();
    });

    it('does not count a surface whose trap is off', () => {
      const under = vi.fn();
      render(
        <>
          <Panel active onEscape={under} />
          <Panel active={false} onEscape={vi.fn()} />
        </>,
      );
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(under).toHaveBeenCalledTimes(1);
    });
  });
});
