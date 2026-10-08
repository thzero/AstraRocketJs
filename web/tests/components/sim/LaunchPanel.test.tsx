// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { LaunchPanel } from '../../../src/components/sim/LaunchPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { LaunchConditions } from '../../../src/services/design/orkTree';
import { __setEngineForTests } from '../../../src/engine/openRocketEngine';
import { useEngineStore } from '../../../src/state/engineStore';

const LAUNCH: LaunchConditions = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 0,
  windAverage: 0,
  windStdDev: 0,
  launchAltitudeM: 0,
  latitudeDeg: 28.61,
  longitudeDeg: -80.6,
  temperatureC: null,
  pressureHPa: null,
};

/** Stand-in geolocation that refuses, the way a denied permission does. */
function refuseGeolocation() {
  const getCurrentPosition = vi.fn((_ok: PositionCallback, err?: PositionErrorCallback) => {
    err?.({ code: 1, message: 'denied' } as GeolocationPositionError);
  });
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
  return getCurrentPosition;
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation');
});

/**
 * The geolocation refusal is announced.
 *
 * A region that does not exist before its content is inserted is not announced
 * by most screen readers, so mounting the live region together with its text
 * (`{locateErr && <p role="status">...}`) would announce nothing; UpdateToast
 * has the same constraint. The region has to be there, empty, from the first
 * render, and be the same element once the message lands.
 */
describe('the geolocation status region', () => {
  it('is mounted and empty before anything has been said', () => {
    refuseGeolocation();
    renderWithProviders(<LaunchPanel launch={LAUNCH} onChange={() => {}} />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
  });

  it('is the same element once the refusal arrives, carrying the message', () => {
    refuseGeolocation();
    renderWithProviders(<LaunchPanel launch={LAUNCH} onChange={() => {}} />);
    const before = screen.getByRole('status');

    fireEvent.click(screen.getByRole('button', { name: /use my location/i }));

    const after = screen.getByRole('status');
    expect(after).toBe(before);
    expect(after.textContent).toContain('Could not get your location');
  });
});

/**
 * Site altitude, pressure and temperature are all bounded, because they go
 * straight to the kernel's atmosphere model. Bounds are given in SI and shown in the
 * field's unit; the app default is metric, so meters and hPa here.
 */
describe('launch site bounds', () => {
  it('bounds altitude to -500..10000 m', () => {
    renderWithProviders(<LaunchPanel launch={LAUNCH} onChange={() => {}} />);
    const input = screen.getByLabelText('Altitude') as HTMLInputElement;
    expect(input.min).toBe('-500');
    expect(input.max).toBe('10000');
  });

  it('bounds pressure to 300..1100 hPa', () => {
    renderWithProviders(<LaunchPanel launch={LAUNCH} onChange={() => {}} />);
    const input = screen.getByLabelText('Pressure') as HTMLInputElement;
    expect(input.min).toBe('300');
    expect(input.max).toBe('1100');
  });

  it('bounds temperature to -90..70 °C, and keeps an ordinary one as typed', () => {
    const onChange = vi.fn();
    renderWithProviders(<LaunchPanel launch={LAUNCH} onChange={onChange} />);
    const input = screen.getByLabelText('Temperature') as HTMLInputElement;
    // The bounds are SI: written as -90 and 70 in a slot that reads kelvin they
    // would be -363 and -203 degrees C, and every entry above -203 degrees C
    // would be clamped to it.
    expect(Number(input.min)).toBeCloseTo(-90, 9);
    expect(Number(input.max)).toBeCloseTo(70, 9);
    fireEvent.change(input, { target: { value: '30' } });
    expect(onChange).toHaveBeenLastCalledWith({ temperatureC: 30 });
  });

  it('clamps a typed altitude to the range', () => {
    const onChange = vi.fn();
    renderWithProviders(<LaunchPanel launch={LAUNCH} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Altitude'), { target: { value: '99999' } });
    expect(onChange).toHaveBeenLastCalledWith({ launchAltitudeM: 10000 });
  });
});

/**
 * The two direction fields display 90 when unset, so clearing one must not write
 * 0: that is a real heading (north), and would silently replace the east the
 * blank stood for. Like `longitudeDeg`, an emptied box goes back to unset.
 */
describe('direction fields', () => {
  it('clear to unset rather than to 0', () => {
    const onChange = vi.fn();
    renderWithProviders(<LaunchPanel launch={{ ...LAUNCH, windDirectionDeg: 45 }} onChange={onChange} />);
    // Rod direction and wind direction share the visible label; wind is last.
    fireEvent.change(screen.getAllByRole('spinbutton', { name: 'Direction' }).at(-1)!, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ windDirectionDeg: undefined });
    expect(onChange).not.toHaveBeenCalledWith({ windDirectionDeg: 0 });
  });
});

describe('weather and the forecast atmosphere', () => {
  it('offers the Weather dialog only where asked (the simulation editor, not the Settings defaults)', () => {
    const { unmount } = renderWithProviders(<LaunchPanel launch={LAUNCH} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Get weather…' })).toBeNull();
    unmount();
    renderWithProviders(<LaunchPanel launch={LAUNCH} onChange={() => {}} weather />);
    fireEvent.click(screen.getByRole('button', { name: 'Get weather…' }));
    expect(screen.getByRole('dialog', { name: 'Weather from Open-Meteo' })).toBeTruthy();
  });

  it('shows a forecast atmosphere that will fly, and clears it', () => {
    const onChange = vi.fn();
    const launch = {
      ...LAUNCH,
      atmosphereLevels: [
        { altitudeM: 1949, temperatureC: 2, pressureHPa: 800, relativeHumidity: 0.3 },
        { altitudeM: 3012, temperatureC: -5, pressureHPa: 700, relativeHumidity: 0.3 },
      ],
    };
    renderWithProviders(<LaunchPanel launch={launch} onChange={onChange} />);
    expect(screen.getByText(/^Forecast atmosphere to 3,?012 m$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith({ atmosphereLevels: undefined });
  });

  it('shows nothing for the standard atmosphere', () => {
    renderWithProviders(<LaunchPanel launch={LAUNCH} onChange={() => {}} />);
    expect(screen.queryByText(/Forecast atmosphere/)).toBeNull();
  });
});

describe('the weather source line', () => {
  const stamp = {
    provider: 'open-meteo' as const,
    endpoint: 'forecast' as const,
    date: '2026-10-05',
    hour: 12,
    timezone: 'America/Denver',
    latitudeDeg: 28.61,
    longitudeDeg: -80.6,
    elevationM: 0,
    validAt: '2026-10-05T18:00:00.000Z',
    fetchedAt: '2026-10-04T15:00:00.000Z',
    groups: ['temperature' as const],
    elevationApplied: false,
    applied: { temperatureC: 12 },
  };

  it('says where the weather came from, and offers Refresh in the simulation editor', () => {
    renderWithProviders(
      <LaunchPanel launch={{ ...LAUNCH, temperatureC: 12, weatherSource: stamp }} onChange={() => {}} weather />,
    );
    expect(screen.getByText(/^Open-Meteo forecast for .*, fetched /)).toBeTruthy();
    expect(screen.queryByText('Edited since it was applied.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh…' }));
    expect(screen.getByRole('dialog', { name: 'Weather from Open-Meteo' })).toBeTruthy();
  });

  it('says when a filled value was edited, or the site moved', () => {
    renderWithProviders(
      <LaunchPanel
        launch={{ ...LAUNCH, temperatureC: 20, latitudeDeg: 30, weatherSource: stamp }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('Edited since it was applied.')).toBeTruthy();
    expect(screen.getByText('The launch site has moved since it was fetched.')).toBeTruthy();
    // No Weather dialog here, so no Refresh to offer.
    expect(screen.queryByRole('button', { name: 'Refresh…' })).toBeNull();
  });
});

describe('the Open-Meteo API key', () => {
  it('sits at the bottom of the Atmosphere card in the Settings copy only', () => {
    const { unmount } = renderWithProviders(<LaunchPanel launch={LAUNCH} onChange={() => {}} weatherKey />);
    const field = screen.getByLabelText('Open-Meteo API key');
    const card = screen.getByRole('heading', { name: 'Atmosphere' }).parentElement!;
    expect(card.contains(field)).toBe(true);
    unmount();
    renderWithProviders(<LaunchPanel launch={LAUNCH} onChange={() => {}} weather />);
    expect(screen.queryByLabelText('Open-Meteo API key')).toBeNull();
  });
});

describe('the sea-level pressure check', () => {
  afterEach(() => {
    __setEngineForTests(null);
    useEngineStore.setState({ phase: 'loading' });
  });

  /** A kernel that answers the standard pressure at 1500 m, and nothing else. */
  const kernelAt1500 = () => {
    __setEngineForTests({ getStandardPressure: () => 84_556 });
    useEngineStore.setState({ phase: 'ready' });
  };

  it('cautions on a sea-level figure typed at a high site', () => {
    kernelAt1500();
    renderWithProviders(
      <LaunchPanel launch={{ ...LAUNCH, launchAltitudeM: 1500, pressureHPa: 1013 }} onChange={() => {}} />,
    );
    expect(screen.getByText(/reduced to sea level/)).toBeTruthy();
  });

  it('says nothing for a pressure that fits the site', () => {
    kernelAt1500();
    renderWithProviders(
      <LaunchPanel launch={{ ...LAUNCH, launchAltitudeM: 1500, pressureHPa: 850 }} onChange={() => {}} />,
    );
    expect(screen.queryByText(/reduced to sea level/)).toBeNull();
  });

  it('says nothing while the engine is still loading', () => {
    renderWithProviders(
      <LaunchPanel launch={{ ...LAUNCH, launchAltitudeM: 1500, pressureHPa: 1013 }} onChange={() => {}} />,
    );
    expect(screen.queryByText(/reduced to sea level/)).toBeNull();
  });
});
