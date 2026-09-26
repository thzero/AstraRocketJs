// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createRef } from 'react';
import { PaneSplitter } from '../../../src/components/layout/PaneSplitter';

/**
 * The separator's announced range, which had nothing checking it.
 *
 * `aria-valuemax` used to carry the static `max` prop while `clamp` enforced
 * `min(max, innerWidth - reserve)`. On any window narrow enough for the cap to
 * bite, the separator advertised a range it could not reach: a screen reader
 * read "maximum 2000" and End - which announces itself as going to the
 * maximum - landed at 224 with no explanation. The value a widget reports and
 * the value it can actually take have to be the same number.
 */

const props = (over: Partial<Parameters<typeof PaneSplitter>[0]> = {}) => ({
  paneRef: createRef<HTMLElement>(),
  width: 300,
  min: 200,
  max: 2000,
  reserve: 800,
  fallback: 320,
  label: 'Resize tree pane',
  onDrag: vi.fn(),
  onCommit: vi.fn(),
  ...over,
});

/** jsdom's window is 1024 wide unless a test says otherwise. */
const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });

beforeEach(() => {
  cleanup();
  setWidth(1024);
});

const sep = () => screen.getByRole('separator', { name: 'Resize tree pane' });

describe('the announced range is the range it can reach', () => {
  it('announces the window cap, not the static max, on a narrow window', () => {
    render(<PaneSplitter {...props()} />);
    // 1024 - 800 reserved = 224, well under the 2000 the prop declares.
    expect(sep().getAttribute('aria-valuemax')).toBe('224');
  });

  it('announces the static max when the window is wide enough for it', () => {
    setWidth(4000); // 4000 - 800 = 3200, so `max` is the binding limit
    render(<PaneSplitter {...props()} />);
    expect(sep().getAttribute('aria-valuemax')).toBe('2000');
  });

  it('re-announces the maximum after the window is resized', () => {
    render(<PaneSplitter {...props()} />);
    expect(sep().getAttribute('aria-valuemax')).toBe('224');
    setWidth(1400); // 1400 - 800 = 600
    fireEvent(window, new Event('resize'));
    expect(sep().getAttribute('aria-valuemax')).toBe('600');
  });

  it('never announces a maximum below the minimum', () => {
    setWidth(400); // 400 - 800 is negative
    render(<PaneSplitter {...props()} />);
    expect(Number(sep().getAttribute('aria-valuemax'))).toBe(200);
    expect(Number(sep().getAttribute('aria-valuemin'))).toBe(200);
  });

  it('carries the current width and the minimum too', () => {
    render(<PaneSplitter {...props({ width: 260 })} />);
    expect(sep().getAttribute('aria-valuenow')).toBe('260');
    expect(sep().getAttribute('aria-valuemin')).toBe('200');
    expect(sep().getAttribute('aria-orientation')).toBe('vertical');
  });
});

describe('End actually lands on the announced maximum', () => {
  it('commits the same number it advertises', () => {
    // The pairing is the point: a key that says "go to the maximum" and an
    // attribute that says what the maximum is must not disagree.
    const p = props();
    render(<PaneSplitter {...p} />);
    fireEvent.keyDown(sep(), { key: 'End' });
    expect(p.onCommit).toHaveBeenCalledWith(Number(sep().getAttribute('aria-valuemax')));
    expect(p.onCommit).toHaveBeenCalledWith(224);
  });

  it('Home lands on the announced minimum', () => {
    const p = props();
    render(<PaneSplitter {...p} />);
    fireEvent.keyDown(sep(), { key: 'Home' });
    expect(p.onCommit).toHaveBeenCalledWith(200);
  });

  it('is reachable from the keyboard at all', () => {
    render(<PaneSplitter {...props()} />);
    expect(sep().getAttribute('tabindex')).toBe('0');
  });
});
