// @vitest-environment jsdom
// cspell:ignore Nowhereville
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { PlaceSearchDialog } from '../../../src/components/sim/PlaceSearchDialog';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { resetWeatherState, setWeatherTransport } from '../../../src/services/weather/openMeteo';

const PUEBLO = {
  results: [
    {
      name: 'Pueblo',
      latitude: 38.25445,
      longitude: -104.60914,
      elevation: 1430,
      admin1: 'Colorado',
      country: 'United States',
    },
  ],
};

let urls: string[] = [];

/** Open-Meteo, answering geocoding from `places` and elevation with 1512 m. */
const serve = (places: unknown) =>
  setWeatherTransport(((url: string) => {
    urls.push(url);
    const body = url.includes('/v1/elevation') ? { elevation: [1512] } : places;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch);

const searchFor = (text: string) => {
  fireEvent.change(screen.getByLabelText(/Place, postal code/), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
};

beforeEach(() => {
  resetWeatherState();
  urls = [];
});
afterEach(() => setWeatherTransport(null));

describe('PlaceSearchDialog', () => {
  it('finds a place by name and writes its latitude, longitude and elevation', async () => {
    serve(PUEBLO);
    const onPick = vi.fn();
    renderWithProviders(<PlaceSearchDialog onPick={onPick} onClose={() => {}} />);
    searchFor('Pueblo');
    fireEvent.click(await screen.findByRole('button', { name: /Pueblo.*Colorado, United States/ }));
    expect(onPick).toHaveBeenCalledWith({ latitudeDeg: 38.25445, longitudeDeg: -104.60914, launchAltitudeM: 1430 });
    expect(urls[0]).toMatch(/^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=Pueblo&/);
  });

  it('reads pasted coordinates without searching, and looks up only their elevation', async () => {
    serve(PUEBLO);
    const onPick = vi.fn();
    renderWithProviders(<PlaceSearchDialog onPick={onPick} onClose={() => {}} />);
    searchFor('38.2544° N, 104.6091° W');
    const row = await screen.findByRole('button', { name: /Coordinates.*1,?512/ });
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith({ latitudeDeg: 38.2544, longitudeDeg: -104.6091, launchAltitudeM: 1512 });
    expect(urls.every((u) => u.includes('/v1/elevation'))).toBe(true);
  });

  it('says a shortened link cannot be read, and asks nothing of anyone', async () => {
    serve(PUEBLO);
    renderWithProviders(<PlaceSearchDialog onPick={() => {}} onClose={() => {}} />);
    searchFor('https://maps.app.goo.gl/AbCdEf123');
    expect(await screen.findByText(/shortened link/)).toBeTruthy();
    expect(urls).toEqual([]);
  });

  it('says so when nothing matches', async () => {
    serve({ generationtime_ms: 0.5 });
    renderWithProviders(<PlaceSearchDialog onPick={() => {}} onClose={() => {}} />);
    searchFor('Nowhereville');
    expect(await screen.findByText(/No places found/)).toBeTruthy();
  });
});

/** Pose as offline for one test; jsdom reports online otherwise. */
const goOffline = () => {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  return () => Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
};

describe('PlaceSearchDialog offline', () => {
  it('cannot search a name offline, but still reads pasted coordinates', () => {
    const back = goOffline();
    try {
      renderWithProviders(<PlaceSearchDialog onPick={() => {}} onClose={() => {}} />);
      const box = screen.getByLabelText(/Place, postal code/);
      const search = () => screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement;
      fireEvent.change(box, { target: { value: 'Pueblo' } });
      expect(search().disabled).toBe(true);
      expect(search().title).toMatch(/offline/i);
      fireEvent.change(box, { target: { value: '38.25, -104.61' } });
      expect(search().disabled).toBe(false);
    } finally {
      back();
    }
  });
});
