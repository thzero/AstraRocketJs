// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { SiteMap } from '../../../src/components/sim/SiteMap';
import { renderWithProviders } from '../../testing/renderWithProviders';

/**
 * The map, without a network.
 *
 * jsdom never fetches an `<img>`, so nothing here depends on a tile server
 * being reachable: what is checked is the URLs the component ASKS for, where
 * it puts the pin, and what a pointer does. The projection itself is covered
 * in `services/slippyMap.test.ts` against hand-computed figures.
 *
 * There is no ResizeObserver in jsdom either, which the component handles by
 * keeping its 320x256 default — so the center of the box is (160, 128) below.
 */

const HOME = { latitudeDeg: 39.05, longitudeDeg: -104.8 };

/** `alt=""` makes the tiles presentational, so query them by tag. */
const tiles = () => Array.from(document.querySelectorAll('img')).map((el) => el.getAttribute('src') ?? '');

describe('SiteMap', () => {
  it('asks its default source for tiles around the coordinate', () => {
    renderWithProviders(<SiteMap {...HOME} />);
    const sources = tiles();
    expect(sources.length).toBeGreaterThan(0);
    // Esri World Imagery, in its z/y/x order. Zoom 15 is SITE_ZOOM.
    expect(sources.every((s) => s.includes('World_Imagery/MapServer/tile/15/'))).toBe(true);
  });

  it('switches to the street layer, on the same provider', () => {
    renderWithProviders(<SiteMap {...HOME} />);
    fireEvent.click(screen.getByRole('button', { name: 'Street' }));
    const sources = tiles();
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((s) => s.includes('World_Street_Map/MapServer/tile/15/'))).toBe(true);
    // Never OpenStreetMap's own volunteer servers: see the note in slippyMap.ts.
    expect(sources.some((s) => s.includes('openstreetmap.org'))).toBe(false);

    // The chosen layer is remembered at module scope, so a second map opened
    // in the same session keeps it. Put it back, or every test after this one
    // would be running against the street layer by accident.
    fireEvent.click(screen.getByRole('button', { name: 'Satellite' }));
    expect(tiles().every((s) => s.includes('World_Imagery'))).toBe(true);
  });

  it('reads the coordinate back with hemispheres rather than signs', () => {
    // The whole point of the map is catching a dropped minus sign, so the
    // readout beside it must not be another place one can hide.
    renderWithProviders(<SiteMap {...HOME} />);
    expect(screen.getByText('39.0500° N, 104.8000° W')).toBeTruthy();
  });

  it('says what to do when there is no coordinate yet', () => {
    renderWithProviders(<SiteMap latitudeDeg={null} longitudeDeg={null} />);
    expect(screen.getByText(/Enter a latitude and longitude/i)).toBeTruthy();
  });

  it('picks the coordinate under a click', () => {
    const onPick = vi.fn();
    renderWithProviders(<SiteMap {...HOME} onPick={onPick} />);
    const map = screen.getByRole('group', { name: /Launch site map/ });

    // The center of the box is the center of the view, so a click there is the
    // coordinate the map is already showing, to four places.
    fireEvent.pointerDown(map, { pointerId: 1, clientX: 160, clientY: 128 });
    fireEvent.pointerUp(map, { pointerId: 1, clientX: 160, clientY: 128 });
    expect(onPick).toHaveBeenCalledWith(39.05, -104.8);
  });

  it('picks north-west of center for a click above and left of it', () => {
    const onPick = vi.fn();
    renderWithProviders(<SiteMap {...HOME} onPick={onPick} />);
    const map = screen.getByRole('group', { name: /Launch site map/ });
    fireEvent.pointerDown(map, { pointerId: 1, clientX: 100, clientY: 60 });
    fireEvent.pointerUp(map, { pointerId: 1, clientX: 100, clientY: 60 });

    const [lat, lon] = onPick.mock.calls[0]!;
    // Up is north, left is west. Getting either axis backwards yields a map
    // that looks fine and puts the location somewhere else entirely.
    expect(lat).toBeGreaterThan(HOME.latitudeDeg);
    expect(lon).toBeLessThan(HOME.longitudeDeg);
  });

  it('pans on a drag instead of picking', () => {
    const onPick = vi.fn();
    renderWithProviders(<SiteMap {...HOME} onPick={onPick} />);
    const map = screen.getByRole('group', { name: /Launch site map/ });

    fireEvent.pointerDown(map, { pointerId: 1, clientX: 160, clientY: 128 });
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 210, clientY: 128 });
    fireEvent.pointerUp(map, { pointerId: 1, clientX: 210, clientY: 128 });
    // A drag that ended over a different place must not move the location there.
    expect(onPick).not.toHaveBeenCalled();
    // The location has not moved either, so the readout still says where it is.
    expect(screen.getByText('39.0500° N, 104.8000° W')).toBeTruthy();
  });

  it('does not move the location when a control inside the map is clicked', () => {
    // The controls are children of the box the pointer handlers are on, so
    // their events bubble there. Read as a click on the ground, switching to
    // the street layer relocated the launch site to the top-left corner of the
    // map, which is where the layer buttons sit. Silent: the coordinates just
    // changed under you.
    const onPick = vi.fn();
    renderWithProviders(<SiteMap {...HOME} onPick={onPick} />);
    for (const name of ['Street', 'Satellite', 'Zoom in', 'Zoom out']) {
      const button = screen.getByRole('button', { name });
      fireEvent.pointerDown(button, { pointerId: 1, clientX: 20, clientY: 12 });
      fireEvent.pointerUp(button, { pointerId: 1, clientX: 20, clientY: 12 });
    }
    expect(onPick).not.toHaveBeenCalled();
  });

  it('omits the click-to-move hint when it is only showing', () => {
    renderWithProviders(<SiteMap {...HOME} />);
    // The instruction line belongs to the control, not the read-only map.
    expect(screen.queryByText(/Click the map/i)).toBeNull();
  });

  it('falls back to a coordinate grid when the tiles cannot load', () => {
    renderWithProviders(<SiteMap {...HOME} />);
    const imgs = Array.from(document.querySelectorAll('img'));
    expect(imgs.length).toBeGreaterThanOrEqual(3);

    // One failure is a hole in the coverage; a screenful is no network.
    fireEvent.error(imgs[0]!);
    expect(document.querySelectorAll('img').length).toBeGreaterThan(0);
    fireEvent.error(imgs[1]!);
    fireEvent.error(imgs[2]!);

    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect(screen.getByText(/No imagery offline/i)).toBeTruthy();
    // The coordinate is still readable, which is what the grid is there for.
    expect(screen.getByText('39.0500° N, 104.8000° W')).toBeTruthy();
  });

  it('keeps drawing once a tile has loaded, however many others fail', () => {
    // Zoomed in past a provider's coverage, individual tiles 404 forever. A
    // map that swapped itself for the offline grid on those would be telling
    // the user they are offline while showing them a working map.
    renderWithProviders(<SiteMap {...HOME} />);
    const imgs = Array.from(document.querySelectorAll('img'));
    fireEvent.load(imgs[0]!);
    for (const img of imgs.slice(1)) fireEvent.error(img);
    expect(document.querySelectorAll('img').length).toBeGreaterThan(0);
    expect(screen.queryByText(/No imagery offline/i)).toBeNull();
  });
});
