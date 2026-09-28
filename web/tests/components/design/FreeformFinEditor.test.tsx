// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { FreeformFinEditor } from '../../../src/components/design/FreeformFinEditor';
import { renderWithProviders } from '../../testing/renderWithProviders';

type Pt = [number, number];

/**
 * The freeform outline was pointer-only.
 *
 * Vertices and edge midpoints had no role, tabIndex or key handler, and the X/Y
 * inputs render ONLY once a point is selected — which only `startDrag` and
 * `insertAfter` could do, both pointer-driven. So a keyboard or screen-reader
 * user could not select a vertex, and therefore could not edit a freeform fin
 * at all.
 */
const PTS: Pt[] = [
  [0, 0],
  [0.02, 0.03],
  [0.06, 0],
];

const show = (points: Pt[] = PTS) => {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  renderWithProviders(<FreeformFinEditor points={points} onChange={onChange} onCommit={onCommit} />);
  return { onChange, onCommit };
};

const vertex = (n: number) => screen.getByLabelText(`Outline point ${n}`);

describe('keyboard editing', () => {
  it('exposes every vertex as a focusable control', () => {
    show();
    for (let i = 1; i <= PTS.length; i++) {
      const v = vertex(i);
      expect(v.getAttribute('tabindex')).toBe('0');
      expect(v.getAttribute('role')).toBe('button');
    }
  });

  it('selects a vertex on focus, which is what reveals the X/Y inputs', () => {
    show();
    // Pointer-only selection meant these never appeared for a keyboard user.
    expect(screen.queryByLabelText('X')).toBeNull();
    fireEvent.focus(vertex(2));
    expect(screen.getByLabelText('X')).toBeTruthy();
    expect(screen.getByLabelText('Y')).toBeTruthy();
  });

  it.each([
    ['ArrowRight', 0.021, 0.03],
    ['ArrowLeft', 0.019, 0.03],
    ['ArrowUp', 0.02, 0.031],
    ['ArrowDown', 0.02, 0.029],
  ])('nudges by 1 mm on %s', (key, x, y) => {
    const { onChange, onCommit } = show();
    fireEvent.keyDown(vertex(2), { key });
    const moved = (onChange.mock.calls[0]![0] as Pt[])[1]!;
    expect(moved[0]).toBeCloseTo(x, 9);
    expect(moved[1]).toBeCloseTo(y, 9);
    // A nudge is a discrete edit, so it closes its own undo entry — unlike a
    // drag, which closes one on release.
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('nudges by 10 mm with Shift held', () => {
    const { onChange } = show();
    fireEvent.keyDown(vertex(2), { key: 'ArrowRight', shiftKey: true });
    expect((onChange.mock.calls[0]![0] as Pt[])[1]![0]).toBeCloseTo(0.03, 9);
  });

  it('keeps the fin above the body and forward of the origin', () => {
    // The same clamp the drag path applies: x >= 0, y >= 0.
    const { onChange } = show();
    fireEvent.keyDown(vertex(1), { key: 'ArrowLeft' });
    const moved = (onChange.mock.calls[0]![0] as Pt[])[0]!;
    expect(moved[0]).toBe(0);
    expect(moved[1]).toBe(0);
  });

  it('deletes the focused vertex, but never below three points', () => {
    const { onChange } = show();
    fireEvent.keyDown(vertex(2), { key: 'Delete' });
    // Three points is the minimum for an outline, so this one is refused.
    expect(onChange).not.toHaveBeenCalled();

    const four: Pt[] = [...PTS, [0.08, 0.01]];
    const second = show(four);
    fireEvent.keyDown(screen.getAllByLabelText('Outline point 2')[1]!, { key: 'Delete' });
    expect((second.onChange.mock.calls[0]![0] as Pt[]).length).toBe(3);
  });

  it('inserts a point from an edge midpoint with Enter or Space', () => {
    const { onChange } = show();
    fireEvent.keyDown(screen.getByLabelText('Insert a point after 1'), { key: 'Enter' });
    const next = onChange.mock.calls[0]![0] as Pt[];
    expect(next).toHaveLength(4);
    // Midway between points 1 and 2.
    expect(next[1]![0]).toBeCloseTo(0.01, 9);
    expect(next[1]![1]).toBeCloseTo(0.015, 9);
  });

  it('labels the drawing itself for a screen reader', () => {
    show();
    expect(screen.getByRole('group', { name: 'Fin outline' })).toBeTruthy();
  });
});

/**
 * A drag ended only on pointerup. A touch drag the browser takes over for
 * scrolling, or a pen lifted out of range, sends pointercancel instead, so
 * the vertex stayed "held": the next move anywhere on the outline dragged it
 * and the drag's undo entry was never closed.
 */
describe('drag cancellation', () => {
  it('ends the drag and closes its undo entry on pointercancel', () => {
    const { onCommit } = show();
    fireEvent.pointerDown(vertex(2), { pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerCancel(screen.getByRole('group', { name: 'Fin outline' }), { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    // Nothing is held any more: a later release commits nothing further.
    fireEvent.pointerUp(screen.getByRole('group', { name: 'Fin outline' }), { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
