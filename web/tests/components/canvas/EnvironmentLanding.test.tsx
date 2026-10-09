// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { EnvironmentLanding } from '../../../src/components/canvas/EnvironmentLanding';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import type { ResultFlight } from '../../../src/services/flight/simulations';
import { useWorkspaceStore } from '../../../src/state/store';

const flight = {
  id: 's1',
  name: 'Sim',
  result: { series: { time: [0, 1], Px: [0, 300], Py: [0, 400] } },
  launch: { latitudeDeg: 39.7392, longitudeDeg: -104.9903 },
} as unknown as ResultFlight;

/**
 * The landing distance reads in the flight's distance unit, the one Ground Track
 * shows the same landing in (the 'sim.apogee' scope). Reading the plain distance
 * unit instead would make the two views of one flight disagree once that chip is
 * set to feet.
 */
describe('EnvironmentLanding', () => {
  beforeEach(() => localStorage.clear());

  it('reads the landing distance in the unit Ground Track uses', () => {
    seedSettings({ unitOverrides: { 'sim.apogee': 'ft' } });
    renderWithProviders(<EnvironmentLanding flight={flight} />);
    // 500 m from the pad is 1,640 ft, at 0 decimals past 100.
    expect(screen.getByText(/^1,640 ft, /)).toBeTruthy();
  });
});

/**
 * The landing coordinate of a simulated flight is the kernel's own: it records
 * latitude and longitude (φ, λ) at every step with the Earth model the
 * simulation chose. Re-projecting the east/north offset with a formula of the
 * view's own would agree with neither the kernel nor the export.
 */
describe('EnvironmentLanding coordinates', () => {
  beforeEach(() => localStorage.clear());

  it('prints the latitude and longitude the kernel recorded at landing', () => {
    const kernel = {
      ...flight,
      result: {
        series: { time: [0, 1], Px: [0, 300], Py: [0, 400], φ: [39.7392, 39.75], λ: [-104.9903, -104.95] },
      },
    } as unknown as ResultFlight;
    renderWithProviders(<EnvironmentLanding flight={kernel} />);
    expect(screen.getByText('39.75000° N, 104.95000° W')).toBeTruthy();
  });
});

/**
 * "Fly the hours" flies the design and conditions as they are now. Against an
 * outdated result that is another rocket or site than the landing it is shown
 * beside, so the action waits for a fresh run and says why.
 */
describe('EnvironmentLanding forecast hours', () => {
  beforeEach(() => localStorage.clear());

  it('waits for a fresh run when the result is outdated', () => {
    const st = useWorkspaceStore.getState();
    // A result with no resultKey reads as outdated against any design.
    useWorkspaceStore.setState({
      sims: [{ ...st.sims[0]!, id: 's1', result: {} as never, resultKey: undefined }],
    });
    const forecast = {
      ...flight,
      launch: { ...flight.launch, weatherSource: { endpoint: 'forecast', timezone: 'UTC' } },
    } as unknown as ResultFlight;
    renderWithProviders(<EnvironmentLanding flight={forecast} />);
    const btn = screen.getByRole('button', { name: 'Fly the hours around this forecast' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/outdated/i)).toBeTruthy();
  });
});
