// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { ExportDialog } from './FlightPathExport';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { FlightResult } from '../../engine/openRocketEngine';
import type { LaunchConditions } from '../../services/orkTree';

const series = {
  time: [0, 1, 2],
  altitude: [0, 100, 0],
  velocity: [0, 50, 10],
  acceleration: [20, 5, -9.8],
  Px: [0, 50, 100],
  Py: [0, 100, 200],
};
const events = [{ type: 'APOGEE', time: 1 }];

const flight = (branches?: unknown[]) =>
  ({
    summary: { maxAltitude: 100, maxVelocity: 50, maxAcceleration: 20 },
    series,
    events,
    ...(branches ? { branches } : {}),
  }) as unknown as FlightResult;

const launch = { latitudeDeg: 40, longitudeDeg: -105, launchAltitudeM: 1600 } as LaunchConditions;

const show = (result: FlightResult) =>
  renderWithProviders(
    <ExportDialog
      onClose={() => {}}
      meta={{ simName: 'Sim', rocketName: 'R', motorName: 'C6' }}
      launch={launch}
      result={result}
    />,
  );

const altRef = () => screen.getByLabelText('Altitude measured from') as HTMLSelectElement;

/**
 * The placement options decide how the exported KML sits on the map. The button
 * that opens this dialog lives in the 3D path view, which needs WebGL and
 * crashes headless Chromium — so the wiring is checked here instead of in an
 * end-to-end test.
 */
describe('flight-path export dialog', () => {
  it('starts on the desktop defaults', () => {
    show(flight());
    expect(altRef().value).toBe('automatic');
    expect(screen.getByRole('checkbox', { name: 'Draw waypoint names on the map' })).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Colour waypoint pins per stage' }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('offers all three altitude references', () => {
    show(flight());
    expect([...altRef().options].map((o) => o.value)).toEqual(['automatic', 'ground', 'sealevel']);
    fireEvent.change(altRef(), { target: { value: 'sealevel' } });
    expect(altRef().value).toBe('sealevel');
  });

  it('hides the stage-track control for a single-stage flight', () => {
    // It asks where each stage's track begins, which means nothing when there
    // is one — and an option that cannot matter is noise in a busy dialog.
    show(flight());
    expect(screen.queryByLabelText("Each stage's track starts")).toBeNull();
  });

  it('shows the stage-track control once the flight staged', () => {
    show(
      flight([
        { name: 'Sustainer', events, series },
        { name: 'Booster', events, series },
      ]),
    );
    const select = screen.getByLabelText("Each stage's track starts") as HTMLSelectElement;
    expect(select.value).toBe('separation');
    expect([...select.options].map((o) => o.value)).toEqual(['separation', 'pad']);
  });

  it('toggles the waypoint display options', () => {
    show(flight());
    const pins = screen.getByRole('checkbox', { name: 'Colour waypoint pins per stage' }) as HTMLInputElement;
    fireEvent.click(pins);
    expect(pins.checked).toBe(false);
  });
});
