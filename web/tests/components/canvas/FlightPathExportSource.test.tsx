// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { FlightResult } from '../../../src/engine/openRocketEngine';
import type { ResultFlight } from '../../../src/services/flight/simulations';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';

const saved = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock('../../../src/services/files/saveFile', async (orig) => ({
  ...(await orig<typeof import('../../../src/services/files/saveFile')>()),
  download: (name: string) => saved.names.push(name),
}));

const { FlightPathExport } = await import('../../../src/components/canvas/FlightPathExport');

/**
 * The export overlaid on the 3D path writes the flight that view shows, which
 * the Results picker can take from a row other than the active one.
 */
const result = {
  summary: { maxAltitude: 100 },
  series: {
    time: [0, 1, 2],
    altitude: [0, 100, 0],
    velocity: [0, 50, 10],
    acceleration: [20, 5, -9.8],
    Px: [0, 50, 100],
    Py: [0, 100, 200],
  },
  events: [{ type: 'APOGEE', time: 1 }],
} as unknown as FlightResult;

const shown = {
  id: 'sim-b',
  name: 'Picked flight',
  result,
  launch: { latitudeDeg: 40, longitudeDeg: -105, launchAltitudeM: 1600 },
} as unknown as ResultFlight;

beforeEach(() => {
  localStorage.clear();
  saved.names.length = 0;
  // The active row has no result of its own.
  const st = useWorkspaceStore.getState();
  useWorkspaceStore.setState({ sims: [{ ...st.sims[0]!, name: 'Active row', result: null }] });
});
afterEach(cleanup);

describe('flight-path export source', () => {
  it('offers the export for the flight on screen when the active row has no result', () => {
    renderWithProviders(<FlightPathExport variant="overlay" flight={shown} />);
    expect(screen.getByRole('button', { name: /Export/ })).toBeTruthy();
  });

  it('writes the shown flight under its own name', () => {
    renderWithProviders(<FlightPathExport variant="overlay" flight={shown} />);
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(saved.names).toHaveLength(1);
    expect(saved.names[0]).toContain('Picked');
    expect(saved.names[0]).not.toContain('Active');
  });
});
