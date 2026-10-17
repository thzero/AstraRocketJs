// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

const flyForecastHours = vi.hoisted(() => vi.fn(async () => []));
vi.mock('../../../src/services/flight/forecastHours', async (orig) => ({
  ...(await orig<typeof import('../../../src/services/flight/forecastHours')>()),
  flyForecastHours,
}));

import { EnvironmentLanding } from '../../../src/components/canvas/EnvironmentLanding';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import { resultKey, type ResultFlight } from '../../../src/services/flight/simulations';
import { configOf, useWorkspaceStore } from '../../../src/state/store';
import { NO_VALUE } from '../../../src/i18n/noValue';

const flight = {
  id: 's1',
  name: 'Sim',
  result: { series: { time: [0, 1], Px: [0, 300], Py: [0, 400] } },
  launch: { latitudeDeg: 39.7392, longitudeDeg: -104.9903 },
} as unknown as ResultFlight;

/**
 * The landing distance reads in the Downrange tile's unit (the 'sim.downrange'
 * scope), the one Ground Track shows the same landing in. Any other scope would
 * make two views of one flight disagree once that chip is set to feet.
 */
describe('EnvironmentLanding', () => {
  beforeEach(() => localStorage.clear());

  it('reads the landing distance in the Downrange unit', () => {
    seedSettings({ unitOverrides: { 'sim.downrange': 'ft' } });
    renderWithProviders(<EnvironmentLanding flight={flight} />);
    // 500 m from the pad is 1,640 ft, at 0 decimals past 100.
    expect(screen.getByText(/^1,640 ft, /)).toBeTruthy();
  });
});

/** The landing bearing is an angle held in degrees; it prints in the reader's angle unit. */
describe('EnvironmentLanding bearing', () => {
  beforeEach(() => localStorage.clear());

  it('prints the landing bearing in the angle unit', () => {
    seedSettings({ units: { angle: 'rad' } });
    renderWithProviders(<EnvironmentLanding flight={flight} />);
    // 300 m east and 400 m north of the pad: 36.87 degrees.
    expect(screen.getByText(/^500 m, 0.64 rad/)).toBeTruthy();
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

  it('shows no coordinate for a result that carries no kernel latitude and longitude', () => {
    // `flight` has the east/north offset only. A coordinate projected from it
    // here would read as the kernel's, so the row shows the no-value glyph and
    // keeps the distance and bearing, which the offset does give.
    renderWithProviders(<EnvironmentLanding flight={flight} />);
    const row = screen.getByText('Lands at').parentElement!;
    const [value, detail] = Array.from(row.querySelectorAll('dd')).map((dd) => dd.textContent);
    expect(value).toBe(NO_VALUE);
    expect(detail).toMatch(/^500 m, /);
    expect(screen.queryByText(/° [NS], .*° [EW]/)).toBeNull();
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

/**
 * The hours fly with the preferences a run reads, the length unit among them:
 * the worker decides airframe-step warnings in it.
 */
describe('EnvironmentLanding forecast hours preferences', () => {
  beforeEach(() => localStorage.clear());

  it('flies with the length unit a run uses', async () => {
    flyForecastHours.mockClear();
    const st = useWorkspaceStore.getState();
    const simPrefs = { ...st.simPrefs, lengthUnit: 'in' };
    const weatherSource = { endpoint: 'forecast', timezone: 'UTC' };
    const sim = { ...st.sims[0]!, id: 's1', launch: { ...st.sims[0]!.launch, weatherSource } } as never;
    const key = resultKey(st.tree, configOf(st.configs, sim), sim, simPrefs);
    useWorkspaceStore.setState({ simPrefs, sims: [{ ...(sim as object), result: {}, resultKey: key } as never] });
    const forecast = {
      ...flight,
      launch: { ...flight.launch, weatherSource },
    } as unknown as ResultFlight;
    renderWithProviders(<EnvironmentLanding flight={forecast} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fly the hours around this forecast' }));
    await waitFor(() => expect(flyForecastHours).toHaveBeenCalledTimes(1));
    const [q] = flyForecastHours.mock.calls[0] as unknown as [{ prefs: { lengthUnit?: string } }];
    expect(q.prefs.lengthUnit).toBe('in');
  });
});

/** The flown hour is marked in words in the hour table, not by its color alone. */
describe('EnvironmentLanding flown hour', () => {
  beforeEach(() => localStorage.clear());

  it('names the hour this flight used', async () => {
    flyForecastHours.mockClear();
    const hour = (offset: number) => ({ offset, validMs: Date.UTC(2026, 9, 10, 12 + offset), landings: [null] });
    flyForecastHours.mockResolvedValueOnce([hour(-1), hour(0), hour(1)] as never);
    const st = useWorkspaceStore.getState();
    const weatherSource = { endpoint: 'forecast', timezone: 'UTC' };
    const sim = { ...st.sims[0]!, id: 's1', launch: { ...st.sims[0]!.launch, weatherSource } } as never;
    const key = resultKey(st.tree, configOf(st.configs, sim), sim, st.simPrefs);
    useWorkspaceStore.setState({ sims: [{ ...(sim as object), result: {}, resultKey: key } as never] });
    const forecast = { ...flight, launch: { ...flight.launch, weatherSource } } as unknown as ResultFlight;
    renderWithProviders(<EnvironmentLanding flight={forecast} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fly the hours around this forecast' }));
    const marks = await screen.findAllByText('(this flight)');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.closest('tr')!.className).toContain('text-accent-300');
  });

  it('lists each safety code an hour breaks as a reason of its own', async () => {
    flyForecastHours.mockClear();
    const outsideLimits = [
      { field: 'windSpeed', value: 12, limit: 9, powerClass: 'model' },
      { field: 'rodAngle', value: 0.6, limit: 0.52, powerClass: 'model' },
    ];
    flyForecastHours.mockResolvedValueOnce([
      { offset: 0, validMs: Date.UTC(2026, 9, 10, 12), landings: [], outsideLimits },
    ] as never);
    const st = useWorkspaceStore.getState();
    const weatherSource = { endpoint: 'forecast', timezone: 'UTC' };
    const sim = { ...st.sims[0]!, id: 's1', launch: { ...st.sims[0]!.launch, weatherSource } } as never;
    const key = resultKey(st.tree, configOf(st.configs, sim), sim, st.simPrefs);
    useWorkspaceStore.setState({ sims: [{ ...(sim as object), result: {}, resultKey: key } as never] });
    const forecast = { ...flight, launch: { ...flight.launch, weatherSource } } as unknown as ResultFlight;
    renderWithProviders(<EnvironmentLanding flight={forecast} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fly the hours around this forecast' }));
    const wind = await screen.findByText('Not flown: wind over the safety limit');
    const angle = screen.getByText('Not flown: launch angle over the safety limit');
    expect(wind).not.toBe(angle);
    expect(wind.closest('td')!.textContent).not.toContain(';');
  });
});
