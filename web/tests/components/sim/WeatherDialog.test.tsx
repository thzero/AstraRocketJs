// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { WeatherDialog } from '../../../src/components/sim/WeatherDialog';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { answer } from '../../testing/openMeteoFixture';
import { resetWeatherState, setWeatherTransport, ymdInZone } from '../../../src/services/weather/openMeteo';
import { writeWeatherKey } from '../../../src/services/weather/weatherKey';
import type { LaunchConditions } from '../../../src/services/design/orkTree';

const SITE = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 0,
  windAverage: 0,
  windStdDev: 0,
  launchAltitudeM: 1500,
  latitudeDeg: 40,
  longitudeDeg: -105,
  temperatureC: null,
  pressureHPa: null,
} as LaunchConditions;

/** Tomorrow on the fixture's calendar, and 72 hours of answer around it. */
const date = ymdInZone(Date.now() + 86_400_000, 'America/Denver');
const start = Date.parse(`${date}T00:00:00Z`) / 1000 - 24 * 3600;

let urls: string[] = [];

beforeEach(() => {
  resetWeatherState();
  urls = [];
  setWeatherTransport(((url: string) => {
    urls.push(url);
    const body = url.includes('/v1/elevation') ? { elevation: [1510] } : answer(1500, { start, hours: 96 });
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch);
});
afterEach(() => {
  setWeatherTransport(null);
  writeWeatherKey('');
});

const open = (launch: LaunchConditions = SITE) => {
  const onChange = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(<WeatherDialog launch={launch} onChange={onChange} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: date } });
  fireEvent.change(screen.getByLabelText('Hour (site time)'), { target: { value: '12' } });
  return { onChange, onClose };
};

const fetchIt = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Fetch' }));
  await screen.findByText('Atmosphere aloft');
};

describe('WeatherDialog', () => {
  it('asks for the site first when it has no coordinates', () => {
    renderWithProviders(
      <WeatherDialog launch={{ ...SITE, latitudeDeg: null }} onChange={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByText('Set the launch site’s latitude and longitude first.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Fetch' })).toBeNull();
  });

  it('fetches from the free service, shows each value with the credit, and changes nothing yet', async () => {
    const { onChange } = open();
    await fetchIt();
    expect(urls.every((u) => u.startsWith('https://api.open-meteo.com/') && !u.includes('apikey'))).toBe(true);
    for (const label of ['Temperature', 'Pressure', 'Humidity', 'Wind', 'Atmosphere aloft']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: 'Weather data by Open-Meteo.com' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('applies only the ticked groups', async () => {
    const { onChange, onClose } = open();
    await fetchIt();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Wind' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const patch = onChange.mock.calls[0]![0] as Partial<LaunchConditions>;
    expect(patch).toMatchObject({ temperatureC: expect.any(Number), pressureHPa: 850, relativeHumidity: 0.4 });
    expect(patch.atmosphereLevels!.length).toBeGreaterThan(0);
    expect(patch.windLevels).toBeUndefined();
    expect(patch.windAverage).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });

  it('stamps what it applied: the date, hour, place, groups and values', async () => {
    const { onChange } = open();
    await fetchIt();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Humidity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const patch = onChange.mock.calls[0]![0] as Partial<LaunchConditions>;
    const { weatherSource, ...values } = patch;
    expect(weatherSource).toMatchObject({
      provider: 'open-meteo',
      endpoint: 'forecast',
      date,
      hour: 12,
      timezone: 'America/Denver',
      latitudeDeg: 40,
      longitudeDeg: -105,
      elevationM: 1500,
      groups: ['temperature', 'pressure', 'wind', 'atmosphere'],
      elevationApplied: false,
    });
    expect(weatherSource!.applied).toEqual(values);
    expect(Date.parse(weatherSource!.validAt)).toBeGreaterThan(0);
  });

  it('on Refresh, starts from the stamp and fetches at once', async () => {
    const stamp = {
      provider: 'open-meteo' as const,
      endpoint: 'forecast' as const,
      date,
      hour: 9,
      timezone: 'America/Denver',
      latitudeDeg: 40,
      longitudeDeg: -105,
      elevationM: 1500,
      validAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      groups: ['wind' as const],
      elevationApplied: false,
    };
    renderWithProviders(
      <WeatherDialog launch={{ ...SITE, weatherSource: stamp }} onChange={() => {}} onClose={() => {}} refresh />,
    );
    await screen.findByText('Atmosphere aloft');
    expect((screen.getByLabelText('Hour (site time)') as HTMLSelectElement).value).toBe('9');
    expect((screen.getByRole('checkbox', { name: 'Wind' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Temperature' }) as HTMLInputElement).checked).toBe(false);
  });

  it('says when an answer is reused, and Fetch fresh asks Open-Meteo again', async () => {
    open();
    await fetchIt();
    expect(screen.getByText(/^Fetched at /)).toBeTruthy();
    const asked = () => urls.filter((u) => u.includes('/v1/forecast')).length;
    expect(asked()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }));
    await screen.findByText(/^Reused from .*Open-Meteo is asked again after 30 minutes.$/);
    expect(asked()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fetch fresh' }));
    await screen.findByText(/^Fetched at /, {}, { timeout: 10_000 });
    expect(asked()).toBe(2);
  }, 15_000);

  it('uses the paid service when a key is set', async () => {
    writeWeatherKey('paid-key');
    open();
    await fetchIt();
    expect(
      urls.every((u) => u.startsWith('https://customer-api.open-meteo.com/') && u.endsWith('apikey=paid-key')),
    ).toBe(true);
  });

  it('says what went wrong, and that nothing changed', async () => {
    setWeatherTransport((() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch);
    const { onChange } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Could not reach Open-Meteo. Your launch conditions are unchanged.',
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
