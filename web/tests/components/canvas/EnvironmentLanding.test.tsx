// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { EnvironmentLanding } from '../../../src/components/canvas/EnvironmentLanding';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import type { ResultFlight } from '../../../src/services/flight/simulations';

const flight = {
  id: 's1',
  name: 'Sim',
  result: { series: { time: [0, 1], Px: [0, 300], Py: [0, 400] } },
  launch: { latitudeDeg: 39.7392, longitudeDeg: -104.9903 },
} as unknown as ResultFlight;

/**
 * The landing distance reads in the flight's distance unit, the one Ground Track
 * shows the same landing in (the 'sim.apogee' scope). The Environment tab read
 * the plain distance unit instead, so once the reader set that chip to feet the
 * two views of one flight disagreed on the unit.
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
