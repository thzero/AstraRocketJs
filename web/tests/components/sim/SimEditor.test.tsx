// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { SimEditor } from '../../../src/components/sim/SimEditor';
import { selectActive, useWorkspaceStore } from '../../../src/state/store';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
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

  it('has a name of its own, apart from the time step box', () => {
    renderWithProviders(<SimEditor />);
    const slider = screen.getByRole('slider');
    const box = screen.getByRole('spinbutton', { name: 'Time step' });
    expect(slider.getAttribute('aria-label')).not.toBe(box.getAttribute('aria-label') ?? 'Time step');
    expect(screen.getAllByLabelText('Time step')).toEqual([box]);
  });

  it('announces the time step at every stop, not the stop index', () => {
    renderWithProviders(<SimEditor />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    const stops = Number(slider.max) - Number(slider.min) + 1;
    expect(stops).toBeGreaterThan(2);
    for (let i = Number(slider.min); i <= Number(slider.max); i++) {
      fireEvent.change(slider, { target: { value: String(i) } });
      const stored = selectActive(st()).prefs!.timeStep!;
      const text = screen.getByRole('slider').getAttribute('aria-valuetext');
      expect(text).toMatch(/ s$/);
      expect(Number(text!.replace(/ s$/, ''))).toBe(stored);
    }
  });
});

/** The override field offers the range the kernel flies: 1 to 20 degrees. */
describe('the max angle step override', () => {
  it('is bounded to the kernel range', () => {
    renderWithProviders(<SimEditor />);
    const field = screen.getByLabelText('Max angle step') as HTMLInputElement;
    expect(Number(field.min)).toBeCloseTo(1);
    expect(Number(field.max)).toBeCloseTo(20);
  });

  it('shows the unit symbol and bounds in the angle unit when the unit is radians', () => {
    seedSettings({ units: { angle: 'rad' } });
    try {
      renderWithProviders(<SimEditor />);
      const field = screen.getByLabelText('Max angle step') as HTMLInputElement;
      expect(Number(field.min)).toBeCloseTo(Math.PI / 180, 4);
      expect(field.parentElement?.textContent).toContain('rad');
    } finally {
      localStorage.clear();
    }
  });

  it('shows a stored out-of-range override as the step the run flies', () => {
    act(() => st().setSimPref('maxAngleStep', (0.05 * Math.PI) / 180));
    renderWithProviders(<SimEditor />);
    expect(Number((screen.getByLabelText('Max angle step') as HTMLInputElement).value)).toBeCloseTo(1);
  });
});

/**
 * Reset and "Save as default" act on every row the editor targets, so what
 * enables them is read from all of those rows, not from the active one alone.
 */
describe('the option buttons with several rows ticked', () => {
  const tick = (prefsOf: (i: number) => Record<string, number> | undefined) =>
    act(() => {
      st().resetWorkspace();
      st().addSim();
      const sims = st().sims.map((x, i) => ({ ...x, prefs: prefsOf(i) }));
      useWorkspaceStore.setState({
        sims,
        selectedSimIds: sims.map((x) => x.id),
        activeId: sims[0]!.id,
      });
    });

  it('offers Reset when only a row other than the active one has an override', () => {
    tick((i) => (i === 1 ? { timeStep: 0.02 } : undefined));
    renderWithProviders(<SimEditor />);
    const reset = screen.getByRole('button', { name: 'Reset to default' }) as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    fireEvent.click(reset);
    for (const sim of st().sims) expect(sim.prefs).toBeUndefined();
  });

  it('refuses Save as default when the rows run with different options, and says why', () => {
    tick((i) => (i === 1 ? { timeStep: 0.02 } : undefined));
    renderWithProviders(<SimEditor />);
    const save = screen.getByRole('button', { name: 'Save as default' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText(/run with different options/)).toBeTruthy();
  });

  it('offers Save as default when the rows agree', () => {
    tick(() => ({ timeStep: 0.02 }));
    renderWithProviders(<SimEditor />);
    expect((screen.getByRole('button', { name: 'Save as default' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
