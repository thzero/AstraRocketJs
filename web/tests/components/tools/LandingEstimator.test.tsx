// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import {
  forgetLandingEstimator,
  LandingEstimator,
  minutesSeconds,
} from '../../../src/components/tools/LandingEstimator';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { answer } from '../../testing/openMeteoFixture';
import { resetWeatherState, setWeatherTransport } from '../../../src/services/weather/openMeteo';

beforeEach(() => {
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
afterEach(() => setWeatherTransport(null));

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

describe('the descent time', () => {
  it('rounds to the second before splitting, so a minute never reads :60', () => {
    expect(minutesSeconds(119.6)).toBe('2:00');
    expect(minutesSeconds(59.5)).toBe('1:00');
    expect(minutesSeconds(65.2)).toBe('1:05');
  });
});
