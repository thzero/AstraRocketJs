// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { SimEditor } from '../../../src/components/sim/SimEditor';
import { SimTab } from '../../../src/components/layout/SettingsTabs';
import { SIM_BOUNDS } from '../../../src/services/storage/settings';
import { renderWithProviders } from '../../testing/renderWithProviders';

// jsdom has no matchMedia; the editor asks for the desktop width.
window.matchMedia = ((query: string) => ({
  matches: true,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
})) as unknown as typeof window.matchMedia;

afterEach(cleanup);

/** The `min` and `max` each solver box renders, by its label. */
function bounds(): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const name of ['Time step', 'Max sim time', 'Max angle step']) {
    const box = screen.getByRole('spinbutton', { name });
    out[name] = [Number(box.getAttribute('min')), Number(box.getAttribute('max'))];
  }
  return out;
}

/**
 * `maxTime / timeStep` is the RK4 iteration count, so the global Settings row
 * and the per-simulation override must both stop at SIM_BOUNDS. An override
 * without a ceiling lets one simulation ask for tens of millions of steps.
 */
describe('the solver boxes', () => {
  it('cap the global row and the per-simulation override at the same bounds', () => {
    renderWithProviders(<SimTab />);
    const global = bounds();
    cleanup();
    renderWithProviders(<SimEditor />);
    const override = bounds();

    expect(override).toEqual(global);
    expect(global['Time step']).toEqual([SIM_BOUNDS.timeStep.min, SIM_BOUNDS.timeStep.max]);
    expect(global['Max sim time']).toEqual([SIM_BOUNDS.maxTime.min, SIM_BOUNDS.maxTime.max]);
    // Shown in the angle unit (degrees by default), stored in radians.
    expect(global['Max angle step']![1]).toBeCloseTo((SIM_BOUNDS.maxAngleStep.max * 180) / Math.PI, 6);
  });
});
