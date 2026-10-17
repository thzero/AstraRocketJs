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

function FramePanel() {
  const ref = useFocusTrap<HTMLDivElement>(true);
  return (
    <div ref={ref} role="dialog">
      <button>close</button>
      <iframe title="page" />
    </div>
  );
}

describe('useFocusTrap', () => {
  it('counts an iframe as a stop, so Tab can reach the page inside it', () => {
    render(<FramePanel />);
    const frame = screen.getByTitle('page');
    frame.focus();
    // The frame is the last stop, so Tab from it wraps to the first control.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'close' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(frame);
  });

  it('wraps past a control at tabindex=-1, which the browser never stops on', () => {
    function RovingPanel() {
      const ref = useFocusTrap<HTMLDivElement>(true);
      return (
        <div ref={ref} role="dialog">
          <button tabIndex={-1}>skipped first</button>
          <button>first</button>
          <button>last</button>
          <button tabIndex={-1}>skipped last</button>
        </div>
      );
    }
    render(<RovingPanel />);
    const first = screen.getByRole('button', { name: 'first' });
    const last = screen.getByRole('button', { name: 'last' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  /**
   * Tab inside an iframe is the frame document's keydown, which the panel never
   * hears, so the browser can move focus straight past the panel's edge.
   */
  it('brings focus back when it lands outside the panel', () => {
    render(
      <>
        <Panel active />
        <button>behind</button>
      </>,
    );
    screen.getByRole('button', { name: 'behind' }).focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
  });

  it('leaves focus alone in a surface opened on top of it', () => {
    function Nested() {
      const inner = useFocusTrap<HTMLDivElement>(true);
      return (
        <>
          <Panel active />
          <div ref={inner} role="alertdialog">
            <button>inner</button>
          </div>
        </>
      );
    }
    render(<Nested />);
    const inner = screen.getByRole('button', { name: 'inner' });
    inner.focus();
    expect(document.activeElement).toBe(inner);
  });
  it('focuses the first control and wraps Tab', () => {
    render(<Panel active />);
    const first = screen.getByRole('button', { name: 'first' });
    const last = screen.getByRole('button', { name: 'last' });
    expect(document.activeElement).toBe(first);
    last.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  /**
   * The modals rely on this one window keydown listener for Escape rather than
   * each carrying its own, so a break here breaks every modal at once.
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
   * thing focused when Escape is pressed. So every open surface hears every
   * Escape, and only the top one may act on it: dismissing the rename prompt
   * inside the design library must not shut the library behind it too.
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

    /**
     * Help is mounted early in the header and opens over dialogs rendered after
     * it, so the surface on top is the one opened last, wherever it sits in the
     * document.
     */
    it('gives Escape and focus to the surface opened last, even when it is earlier in the document', () => {
      const earlier = vi.fn();
      const later = vi.fn();
      function Pair({ earlierOpen }: { earlierOpen: boolean }) {
        const first = useFocusTrap<HTMLDivElement>(earlierOpen, { onEscape: earlier });
        const second = useFocusTrap<HTMLDivElement>(true, { onEscape: later });
        return (
          <>
            <div ref={first} role="dialog" aria-label="earlier">
              <button>in earlier</button>
            </div>
            <div ref={second} role="dialog" aria-label="later">
              <button>in later</button>
            </div>
          </>
        );
      }
      const { rerender } = render(<Pair earlierOpen={false} />);
      rerender(<Pair earlierOpen />);

      const inEarlier = screen.getByRole('button', { name: 'in earlier' });
      expect(document.activeElement).toBe(inEarlier);
      // Focus moved by the user inside the surface on top stays there.
      inEarlier.blur();
      inEarlier.focus();
      expect(document.activeElement).toBe(inEarlier);

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(earlier).toHaveBeenCalledTimes(1);
      expect(later).not.toHaveBeenCalled();

      // Closed again, the one underneath is on top once more.
      rerender(<Pair earlierOpen={false} />);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(later).toHaveBeenCalledTimes(1);
      expect(earlier).toHaveBeenCalledTimes(1);
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
