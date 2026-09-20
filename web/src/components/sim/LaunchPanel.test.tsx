// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { LaunchPanel } from './LaunchPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { LaunchConditions } from '../../services/orkTree';

const LAUNCH: LaunchConditions = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 0,
  windAverage: 0,
  windStdDev: 0,
  launchAltitudeM: 0,
  latitudeDeg: 28.61,
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
 * `{locateErr && <p role="status">...}` mounted the live region together with
 * its text, and a region that does not exist before its content is inserted
 * is not announced by most screen readers: the same defect UpdateToast had.
 * The region has to be there, empty, from the first render, and be the SAME
 * element once the message lands.
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
 * Site altitude and pressure were the two QNums without a range while the
 * comment beside temperature claimed all three were bounded. Both go straight
 * to the kernel's atmosphere model. Bounds are given in SI and shown in the
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

  it('clamps a typed altitude to the range', () => {
    const onChange = vi.fn();
    renderWithProviders(<LaunchPanel launch={LAUNCH} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Altitude'), { target: { value: '99999' } });
    expect(onChange).toHaveBeenLastCalledWith({ launchAltitudeM: 10000 });
  });
});
