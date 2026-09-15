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

const trackRef = () => screen.getByLabelText('Track altitude from') as HTMLSelectElement;
const pinRef = () => screen.getByLabelText('Waypoint altitude from') as HTMLSelectElement;
const shadow = () => screen.getByRole('checkbox', { name: 'Draw shadow down to the ground' }) as HTMLInputElement;

/**
 * The placement options decide how the exported KML sits on the map. The button
 * that opens this dialog lives in the 3D path view, which needs WebGL and
 * crashes headless Chromium — so the wiring is checked here instead of in an
 * end-to-end test.
 */
describe('flight-path export dialog', () => {
  it('starts on the desktop defaults', () => {
    show(flight());
    expect(trackRef().value).toBe('automatic');
    expect(pinRef().value).toBe('automatic');
    expect(shadow().checked).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'Draw waypoint names on the map' })).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Colour waypoint pins per stage' }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('sets the track and the pins independently', () => {
    // The case the split exists for: the flight in the air, the pins flat on the
    // ground so you can read what they sit over.
    show(flight());
    const options = ['automatic', 'ground', 'sealevel', 'clamped'];
    expect([...trackRef().options].map((o) => o.value)).toEqual(options);
    expect([...pinRef().options].map((o) => o.value)).toEqual(options);

    fireEvent.change(trackRef(), { target: { value: 'sealevel' } });
    fireEvent.change(pinRef(), { target: { value: 'clamped' } });
    expect([trackRef().value, pinRef().value]).toEqual(['sealevel', 'clamped']);
  });

  it('disables the shadow only once BOTH halves are on the ground', () => {
    show(flight());
    fireEvent.change(trackRef(), { target: { value: 'clamped' } });
    expect(shadow().disabled).toBe(false); // pins are still in the air

    fireEvent.change(pinRef(), { target: { value: 'clamped' } });
    expect(shadow().disabled).toBe(true); // nothing left to draw a shadow from
  });

  it('presets reach all three sections, and only through the visible controls', () => {
    show(flight());
    const check = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

    fireEvent.click(screen.getByRole('button', { name: 'Drift cast' }));
    expect([trackRef().value, pinRef().value]).toEqual(['clamped', 'clamped']); // placement
    expect(check('Include flight path line').checked).toBe(false); // lines
    expect(check('Include ground track').checked).toBe(true);
    expect(check('Landing').checked).toBe(true); // waypoints untouched by this one

    // Landing plots narrows the waypoints too — the third section.
    fireEvent.click(screen.getByRole('button', { name: 'Landing plots' }));
    expect(check('Landing').checked).toBe(true);
    expect(check('Apogee').checked).toBe(false);
    expect(check('Include ground track').checked).toBe(false);

    // …and a preset is a starting point, not a mode: every control still moves.
    fireEvent.change(trackRef(), { target: { value: 'sealevel' } });
    fireEvent.click(check('Apogee'));
    expect(trackRef().value).toBe('sealevel');
    expect(check('Apogee').checked).toBe(true);
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
