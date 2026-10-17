// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import {
  forgetLandingEstimator,
  LandingEstimator,
  minutesSeconds,
} from '../../../src/components/tools/LandingEstimator';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import { answer } from '../../testing/openMeteoFixture';
import { resetWeatherState, setWeatherTransport } from '../../../src/services/weather/openMeteo';

/** The site each landing map was drawn over, newest last. */
const mapSites = vi.hoisted(() => [] as { lat: number; lon: number }[]);
vi.mock('../../../src/components/tools/LandingMap', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/components/tools/LandingMap')>();
  return {
    LandingMap: (p: Parameters<typeof real.LandingMap>[0]) => {
      mapSites.push({ lat: p.latitudeDeg, lon: p.longitudeDeg });
      return real.LandingMap(p);
    },
  };
});

beforeEach(() => {
  mapSites.length = 0;
  resetWeatherState();
  forgetLandingEstimator();
  setWeatherTransport(((url: string) => {
    const u = new URL(url);
    const body =
      u.pathname === '/v1/elevation'
        ? {
            elevation: u.searchParams
              .get('longitude')!
              .split(',')
              .map(() => 3),
          }
        : answer(Number(u.searchParams.get('elevation') ?? 0), {
            start: Math.floor(Date.now() / 3_600_000) * 3600 - 86_400,
            hours: 96,
          });
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch);
});
afterEach(() => {
  setWeatherTransport(null);
  localStorage.clear();
});

describe('LandingEstimator', () => {
  it('starts from a single chute, and gives a drogue its own faster rate', () => {
    renderWithProviders(<LandingEstimator />);
    expect((screen.getByLabelText('Descent rate') as HTMLInputElement).value).toBe('6');
    fireEvent.click(screen.getByRole('radio', { name: 'Dual' }));
    expect((screen.getByLabelText('Drogue descent rate') as HTMLInputElement).value).toBe('25');
    expect((screen.getByLabelText('Main descent rate') as HTMLInputElement).value).toBe('6');
    expect(screen.getByLabelText('Main opens above the pad at')).toBeTruthy();
  });

  it('says the main must open below apogee, and will not estimate until it does', () => {
    renderWithProviders(<LandingEstimator />);
    fireEvent.click(screen.getByRole('radio', { name: 'Dual' }));
    fireEvent.change(screen.getByLabelText('Main opens above the pad at'), { target: { value: '400' } });
    expect(screen.getByText('The main has to open below apogee.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Estimate landing' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('estimates, and labels the result an estimate with its credit', async () => {
    renderWithProviders(<LandingEstimator />);
    fireEvent.click(screen.getByRole('button', { name: 'Estimate landing' }));
    await screen.findByText('Lands at');
    expect(
      screen.getByRole('img', { name: /^Landing estimate seen from above, landing .* from the pad$/ }),
    ).toBeTruthy();
    expect(
      screen.getByText(/^An estimate from typed descent rates\. The zone covers 135 descents: 5 forecast hours/),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toBeTruthy();
  });
});

/** The bearing is an angle held in degrees; it prints in the reader's angle unit. */
it('prints the landing bearing in the angle unit', async () => {
  seedSettings({ units: { angle: 'rad' } });
  renderWithProviders(<LandingEstimator />);
  fireEvent.click(screen.getByRole('button', { name: 'Estimate landing' }));
  await screen.findByText('Lands at');
  expect(screen.getByText('Bearing from the pad').nextElementSibling?.textContent).toMatch(/^[\d.,]+ rad$/);
});

const OUTDATED = /have changed since this estimate/;

/**
 * The result belongs to the inputs it was computed from. The map stays over the
 * site the drift was computed for, and the result says so once the form no
 * longer matches it.
 */
describe('a result after its inputs change', () => {
  const estimate = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Estimate landing' }));
    await screen.findByText('Lands at');
  };

  it('stays drawn over the site it was computed for, and says the site moved', async () => {
    renderWithProviders(<LandingEstimator />);
    await estimate();
    const at = mapSites.at(-1)!;
    expect(screen.queryByText(OUTDATED)).toBeNull();

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: String(at.lat + 1) } });

    expect(mapSites.at(-1)).toEqual(at);
    expect(screen.getByText(OUTDATED)).toBeTruthy();
  });

  it('keeps a real site under the map when a coordinate is cleared', async () => {
    renderWithProviders(<LandingEstimator />);
    await estimate();
    const at = mapSites.at(-1)!;

    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '' } });

    expect(mapSites.at(-1)).toEqual(at);
    expect(Number.isFinite(mapSites.at(-1)!.lon)).toBe(true);
    expect(screen.getByText(OUTDATED)).toBeTruthy();
  });

  it('says so when the apogee or a descent rate changes, and not when it is put back', async () => {
    renderWithProviders(<LandingEstimator />);
    await estimate();
    const apogee = screen.getByLabelText('Apogee above the pad');

    fireEvent.change(apogee, { target: { value: '400' } });
    expect(screen.getByText(OUTDATED)).toBeTruthy();
    fireEvent.change(apogee, { target: { value: '300' } });
    expect(screen.queryByText(OUTDATED)).toBeNull();

    fireEvent.change(screen.getByLabelText('Descent rate'), { target: { value: '7' } });
    expect(screen.getByText(OUTDATED)).toBeTruthy();
  });

  it('clears the mark when estimated again', async () => {
    renderWithProviders(<LandingEstimator />);
    await estimate();
    fireEvent.change(screen.getByLabelText('Descent rate'), { target: { value: '7' } });
    expect(screen.getByText(OUTDATED)).toBeTruthy();

    await estimate();
    expect(screen.queryByText(OUTDATED)).toBeNull();
  });
});

describe('the descent time', () => {
  it('rounds to the second before splitting, so a minute never reads :60', () => {
    expect(minutesSeconds(119.6)).toBe('2:00');
    expect(minutesSeconds(59.5)).toBe('1:00');
    expect(minutesSeconds(65.2)).toBe('1:05');
  });
});
