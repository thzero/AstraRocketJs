// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

const fetchSurfaceWind = vi.hoisted(() => vi.fn());
vi.mock('../../../src/services/tools/surfaceWind', async (orig) => ({
  ...(await orig<typeof import('../../../src/services/tools/surfaceWind')>()),
  fetchSurfaceWind,
}));

import { forgetOffTheRail, OffTheRail } from '../../../src/components/tools/OffTheRail';
import { renderWithProviders } from '../../testing/renderWithProviders';

beforeEach(() => {
  forgetOffTheRail();
  fetchSurfaceWind.mockReset();
});

/** A failed wind fetch is announced, not only drawn in red. */
describe('OffTheRail wind fetch', () => {
  it('raises the failure as an alert', async () => {
    fetchSurfaceWind.mockRejectedValue(new Error('forecast service down'));
    renderWithProviders(<OffTheRail />);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Get the forecast wind' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

/** A forecast belongs to the site, time and wind it was fetched for. */
describe('OffTheRail forecast line', () => {
  it('clears when the wind field changes after the fetch', async () => {
    fetchSurfaceWind.mockResolvedValue({
      speedMs: 5,
      gustMs: 9,
      validUnix: 1_700_000_000,
      answer: { timezone: 'UTC' },
    });
    renderWithProviders(<OffTheRail />);
    fireEvent.click(screen.getByRole('button', { name: 'Get the forecast wind' }));
    expect(await screen.findByText(/gusting to/)).toBeTruthy();
    const wind = screen.getByRole('spinbutton', { name: /Wind speed/ });
    fireEvent.change(wind, { target: { value: '12' } });
    fireEvent.blur(wind);
    expect(screen.queryByText(/gusting to/)).toBeNull();
  });
});

describe('OffTheRail site elevation', () => {
  it('asks for the forecast at the typed site elevation', async () => {
    fetchSurfaceWind.mockResolvedValue({
      speedMs: 5,
      gustMs: null,
      validUnix: 1_700_000_000,
      answer: { timezone: 'UTC' },
    });
    renderWithProviders(<OffTheRail />);
    const site = screen.getByRole('spinbutton', { name: /Site elevation/ });
    fireEvent.change(site, { target: { value: '1400' } });
    fireEvent.blur(site);
    fireEvent.click(screen.getByRole('button', { name: 'Get the forecast wind' }));
    expect(fetchSurfaceWind.mock.calls[0]![0]).toMatchObject({ siteM: 1400 });
  });

  it('asks for the elevation when the terrain model has none', async () => {
    fetchSurfaceWind.mockResolvedValue('noElevation');
    renderWithProviders(<OffTheRail />);
    fireEvent.click(screen.getByRole('button', { name: 'Get the forecast wind' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/elevation/);
  });
});

describe('OffTheRail site fields', () => {
  it('name the map button by its words, not its glyph', () => {
    renderWithProviders(<OffTheRail />);
    expect(screen.getByRole('button', { name: 'Show on map' })).toBeTruthy();
  });
});
