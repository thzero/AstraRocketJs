// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useHoverCursor } from './useHoverCursor';

afterEach(() => {
  cleanup();
  document.body.style.cursor = '';
});

/** Exposes the hook's setter, so a test can drive it like a mesh would. */
let set!: (on: boolean) => void;
function Mesh() {
  set = useHoverCursor();
  return null;
}
const cursor = () => document.body.style.cursor;

describe('useHoverCursor', () => {
  it('paints the pointer on hover and clears it on leave', () => {
    render(<Mesh />);
    set(true);
    expect(cursor()).toBe('pointer');
    set(false);
    expect(cursor()).toBe('');
  });

  /**
   * The bug. Only a matching pointer-out cleared the cursor, and an R3F mesh
   * unmounts without firing one: switching views, or an edit that rebuilds the
   * piece list, left the whole app stuck showing a hand until the user happened
   * to hover and leave something else.
   */
  it('clears the cursor when the canvas unmounts mid-hover', () => {
    const { unmount } = render(<Mesh />);
    set(true);
    expect(cursor()).toBe('pointer');
    unmount();
    expect(cursor()).toBe('');
  });

  it('clears unconditionally on unmount, even a cursor it did not set', () => {
    document.body.style.cursor = 'wait'; // something else owns it
    const { unmount } = render(<Mesh />);
    unmount();
    // The canvas only ever clears; it does not restore a cursor it never saw.
    expect(cursor()).toBe('');
  });

  it('returns the same setter across re-renders', () => {
    const { rerender } = render(<Mesh />);
    const first = set;
    rerender(<Mesh />);
    // Stable, so the mesh handlers using it are not re-created every frame.
    expect(set).toBe(first);
  });
});
