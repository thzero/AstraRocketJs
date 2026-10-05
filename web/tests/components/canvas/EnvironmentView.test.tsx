// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { EnvironmentView } from '../../../src/components/canvas/EnvironmentView';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { ResultFlight } from '../../../src/services/flight/simulations';

const n = 61;
const altitude = Array.from({ length: n }, (_, i) => 250 * Math.sin((Math.PI * i) / (n - 1)));
const col = (f: (a: number) => number) => altitude.map(f);

const flight = (series: Record<string, number[]>): ResultFlight =>
  ({
    id: 's1',
    name: 'Sim',
    result: { series },
    launch: { launchAltitudeM: 1609 },
  }) as unknown as ResultFlight;

const AIR = {
  altitude,
  Vw: col((a) => 4 + a / 100),
  // Across north, so the direction line has to break rather than sweep the chart.
  θw: col((a) => ((350 + a / 10) * Math.PI) / 180),
  T: col((a) => 295.65 - 0.0065 * a),
  P: col((a) => 84730 * Math.exp(-a / 8434)),
  ρ: col((a) => 0.9985 * Math.exp(-a / 10400)),
  Vs: col((a) => 344.7 - 0.004 * a),
};

describe('EnvironmentView', () => {
  it('shows the air at the pad, the site elevation among it', () => {
    renderWithProviders(<EnvironmentView flight={flight(AIR)} />);
    const pad = within(document.querySelector('dl')!);
    expect(pad.getByText('Site elevation').nextSibling?.textContent).toBe('1,609 m');
    expect(pad.getByText('Air temperature').nextSibling?.textContent).toMatch(/^22\.50 °C$/);
    // Four significant figures in the user's unit (g/cm³ by default), not a rounded 0.00.
    expect(pad.getByText('Air density').nextSibling?.textContent).toBe('0.0009985 g/cm³');
    expect(pad.getByText('Wind direction').nextSibling?.textContent).toBe('350°');
  });

  it('draws four profiles from the ground to apogee, each named for a screen reader', () => {
    renderWithProviders(<EnvironmentView flight={flight(AIR)} />);
    const charts = screen.getAllByRole('img');
    expect(charts.map((c) => c.getAttribute('aria-label')!.split(':')[0])).toEqual([
      'Wind speed',
      'Wind direction',
      'Air temperature',
      'Air pressure',
    ]);
    for (const c of charts) expect(c.getAttribute('aria-label')).toMatch(/ground to 250 m$/);
  });

  it('breaks the wind direction line where it crosses north', () => {
    renderWithProviders(<EnvironmentView flight={flight(AIR)} />);
    const direction = screen.getAllByRole('img')[1]!;
    const ascent = direction.querySelectorAll('path')[1]!.getAttribute('d')!;
    expect(ascent.match(/M /g)!.length).toBeGreaterThan(1);
  });

  it('gives still air no direction, and prints zeros plainly', () => {
    renderWithProviders(
      <EnvironmentView
        flight={{ ...flight({ ...AIR, Vw: col(() => 0), θw: col(() => 0) }), launch: { launchAltitudeM: 0 } } as never}
      />,
    );
    const pad = within(document.querySelector('dl')!);
    expect(pad.getByText('Wind direction').nextSibling?.textContent).toBe('—');
    expect(pad.getByText('Wind speed').nextSibling?.textContent).toBe('0 m/s');
    expect(pad.getByText('Site elevation').nextSibling?.textContent).toBe('0 m');
  });

  it('names the site, and credits a forecast with its hour and place', () => {
    const weatherSource = {
      provider: 'open-meteo' as const,
      endpoint: 'forecast' as const,
      date: '2026-10-05',
      hour: 12,
      timezone: 'America/Denver',
      latitudeDeg: 39.7392,
      longitudeDeg: -104.9903,
      elevationM: 1609,
      validAt: '2026-10-05T18:00:00.000Z',
      fetchedAt: '2026-10-04T15:14:00.000Z',
      groups: ['temperature' as const],
      elevationApplied: false,
    };
    renderWithProviders(
      <EnvironmentView
        flight={
          {
            ...flight(AIR),
            launch: { launchAltitudeM: 1609, latitudeDeg: 39.7392, longitudeDeg: -104.9903, weatherSource },
          } as never
        }
      />,
    );
    const pad = within(document.querySelector('dl')!);
    expect(pad.getByText('Latitude').nextSibling?.textContent).toBe('39.7392°');
    expect(pad.getByText('Longitude').nextSibling?.textContent).toBe('-104.9903°');
    expect(pad.getByText('Date / time').nextSibling?.textContent).toMatch(/^Oct 5, 2026, 12:00 PM MDT$/);
    // The row carries the date, time and place, so the sentence repeating them is left out.
    expect(screen.queryByText(/^Open-Meteo forecast for /)).toBeNull();
    expect(screen.getByRole('link', { name: 'Weather data by Open-Meteo.com' }).getAttribute('href')).toBe(
      'https://open-meteo.com/',
    );
    expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toBeTruthy();
    // No Weather dialog on the Results tab, so nothing to refresh from here.
    expect(screen.queryByRole('button', { name: 'Refresh…' })).toBeNull();
  });

  it('shows no credit for weather that did not come from Open-Meteo', () => {
    renderWithProviders(<EnvironmentView flight={flight(AIR)} />);
    // No forecast, no date: the run itself has none.
    expect(screen.queryByText('Date / time')).toBeNull();
    expect(screen.queryByRole('link', { name: 'CC BY 4.0' })).toBeNull();
  });

  it('says so when the result has no air series', () => {
    renderWithProviders(<EnvironmentView flight={flight({ altitude })} />);
    expect(screen.getByText('This result has no atmosphere data. Run the simulation again.')).toBeTruthy();
  });
});
