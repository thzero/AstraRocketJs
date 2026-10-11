// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import type { AeroSweep } from '../../../src/engine/openRocketEngine';

/**
 * The aero pane's header agrees with its tables, and its flight-condition boxes
 * read in the user's angle and roll rate units.
 *
 * The sweep is stubbed: these are facts about the pane, not the kernel. Its grid
 * is the real one (0.05 then every 0.02), on which the 0.3 default is not a
 * sample.
 */
const machs = Array.from({ length: 48 }, (_, i) => 0.05 + 0.02 * i);
const flat = (v: number) => machs.map(() => v);
const curve = { total: flat(0.5), friction: flat(0.3), pressure: flat(0.1), base: flat(0.1) };
const sweep = {
  machs,
  hasNozzle: false,
  cp: flat(0.4),
  cna: flat(10),
  powerOff: curve,
  powerOn: curve,
  components: [{ key: 'n', name: 'Nose cone', cd: flat(0.1), cna: flat(2), cp: flat(0.05) }],
} as unknown as AeroSweep;

vi.mock('../../../src/components/canvas/useAeroSweep', () => ({
  useAeroSweep: () => ({ sweep, pending: false }),
}));

const { AeroAnalysis } = await import('../../../src/components/canvas/AeroAnalysis');

afterEach(() => localStorage.clear());

describe('the Mach the pane reports at', () => {
  it('is the same sample in the header and every table', () => {
    renderWithProviders(<AeroAnalysis />);
    fireEvent.click(screen.getByRole('button', { name: 'Per component' }));
    const readouts = screen.getAllByText(/^at Mach /).map((el) => el.textContent);
    // The header and the tables beside it: one Mach between them.
    expect(readouts.length).toBeGreaterThan(1);
    expect(new Set(readouts).size).toBe(1);
  });
});

describe('the flight conditions follow the unit preferences', () => {
  it('reads angles in radians and roll rate in rpm when those are chosen', () => {
    seedSettings({ units: { angle: 'rad', rollRate: 'rpm' } });
    renderWithProviders(<AeroAnalysis />);
    const unitBeside = (label: string) => screen.getByLabelText(label).closest('label')!.lastElementChild!.textContent;
    expect(unitBeside('AoA')).toBe('rad');
    expect(unitBeside('Wind dir')).toBe('rad');
    expect(unitBeside('Roll rate')).toBe('rpm');
  });

  it('stores a typed angle back in the degrees the sweep takes', () => {
    seedSettings({ units: { angle: 'rad' } });
    renderWithProviders(<AeroAnalysis />);
    const box = screen.getByLabelText('AoA') as HTMLInputElement;
    fireEvent.change(box, { target: { value: String(Math.PI / 36) } });
    fireEvent.blur(box);
    // 5 degrees, shown back in radians.
    expect(Number((screen.getByLabelText('AoA') as HTMLInputElement).value)).toBeCloseTo(Math.PI / 36, 3);
  });
});
