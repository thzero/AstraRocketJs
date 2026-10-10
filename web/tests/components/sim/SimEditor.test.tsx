// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { SimEditor } from '../../../src/components/sim/SimEditor';
import { selectActive, useWorkspaceStore } from '../../../src/state/store';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { seedFromInput } from '../../../src/services/flight/simulations';

const st = () => useWorkspaceStore.getState();

// jsdom has no matchMedia; the editor asks for the desktop width.
window.matchMedia = ((query: string) => ({
  matches: true,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
})) as unknown as typeof window.matchMedia;

afterEach(() => act(() => st().clearSimPrefs()));

/**
 * The bridge casts the seed with Java's `(int)`, so the field has to hold the
 * seed that will actually fly, not a number the cast will change.
 */
describe('the random seed', () => {
  it('truncates and saturates the way the bridge does', () => {
    expect(seedFromInput(3.7)).toBe(3);
    expect(seedFromInput(-3.7)).toBe(-3);
    expect(seedFromInput(1e12)).toBe(2 ** 31 - 1);
    expect(seedFromInput(-1e12)).toBe(-(2 ** 31));
    expect(seedFromInput(null)).toBeNull();
  });

  it('stores the seed the run flies when one is typed', () => {
    renderWithProviders(<SimEditor />);
    fireEvent.change(screen.getByLabelText('Random seed'), { target: { value: '3.7' } });
    expect(selectActive(st()).prefs?.randomSeed).toBe(3);
  });
});

/** A touch drag sends no mouseup, so the slider has to close its undo entry on pointerup. */
describe('the time-step slider', () => {
  it('closes its undo entry when a pointer lets go', () => {
    const real = st().commitEdit;
    const commitEdit = vi.fn();
    act(() => useWorkspaceStore.setState({ commitEdit }));
    try {
      renderWithProviders(<SimEditor />);
      fireEvent.pointerUp(screen.getByRole('slider'));
      expect(commitEdit).toHaveBeenCalled();
    } finally {
      act(() => useWorkspaceStore.setState({ commitEdit: real }));
    }
  });
});
