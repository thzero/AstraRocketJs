// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { GroundTrack } from './GroundTrack';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { ChartFlight } from './FlightChart';

/**
 * The ground track's map layer, without a network.
 *
 * jsdom never fetches an `<img>`, so nothing here needs a tile server: what is
 * checked is which tiles the view ASKS for, and that it still draws a correct
 * plan view when it asks for none. The projection itself is covered against
 * hand-computed figures in `services/slippyMap.test.ts`, and the track geometry
 * in `services/groundTrack.test.ts`.
 *
 * There is no ResizeObserver in jsdom either, which the component handles by
 * keeping its 420 px default.
 */

const HOME = { latitudeDeg: 39.05, longitudeDeg: -104.8 };

/** A flight that drifts to 500 m east and 500 m north over four samples. */
const flight = (): ChartFlight =>
  ({
    id: 'sim-1',
    name: 'Simulation 1',
    result: {
      summary: {},
      events: [],
      series: {
        time: [0, 1, 2, 3],
        altitude: [0, 100, 60, 0],
        Px: [0, 100, 300, 500],
        Py: [0, 120, 320, 500],
      },
    },
  }) as unknown as ChartFlight;

/** `alt=""` makes the tiles presentational, so query them by tag. */
const tiles = () => Array.from(document.querySelectorAll('img')).map((el) => el.getAttribute('src') ?? '');

/**
 * Turn imagery on for the view just rendered.
 *
 * Needed by nearly every test here, because imagery is OFF until asked for.
 * Both the layer and whether imagery shows at all are also remembered at module
 * scope for the session (that is the point - switching to street in the site
 * map carries over), so a test that leaves it on would decide what the NEXT
 * test renders. Asking for it explicitly is what keeps these independent of
 * each other's order.
 */
const showImagery = () => fireEvent.click(screen.getByRole('button', { name: 'Satellite' }));

/** Put the session memory back, so the next test starts from the real default. */
const hideImagery = () => fireEvent.click(screen.getByRole('button', { name: 'None' }));

describe('GroundTrack imagery', () => {
  /**
   * Nothing is fetched from anybody's tile servers until somebody asks to see
   * the ground. The plan view is a measurement that stands on its own - the
   * range rings do not depend on a picture - so opening Results is not a reason
   * to reach out for scenery.
   */
  it('asks for no tiles at all until the ground is turned on', () => {
    renderWithProviders(<GroundTrack flight={flight()} {...HOME} />);
    expect(tiles()).toHaveLength(0);
    // jest-dom's matchers are not loaded here, so read the attribute directly.
    expect(screen.getByRole('button', { name: 'None' }).getAttribute('aria-pressed')).toBe('true');
    // And the view is complete without it.
    expect(screen.getByRole('img', { name: /over the ground/i })).toBeTruthy();
    expect(screen.queryByText(/Esri/)).toBeNull();
  });

  it('draws tiles centered on the site the flight was flown from', () => {
    renderWithProviders(<GroundTrack flight={flight()} {...HOME} />);
    showImagery();
    const sources = tiles();
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((s) => s.includes('World_Imagery/MapServer/tile/'))).toBe(true);
    // Never OpenStreetMap's own volunteer servers: see the note in slippyMap.ts.
    expect(sources.some((s) => s.includes('openstreetmap.org'))).toBe(false);
    hideImagery();
  });

  /**
   * The zoom follows the flight rather than sitting at SITE_ZOOM, which is the
   * whole reason this could not just reuse the site map. A 500 m drift draws
   * closer in than a 5 km one, so it must ask for a HIGHER zoom.
   */
  it('zooms to the track rather than to a fixed site zoom', () => {
    const zoomOf = (sources: string[]) => Number(sources[0]!.match(/MapServer\/tile\/(\d+)\//)![1]);

    const { unmount } = renderWithProviders(<GroundTrack flight={flight()} {...HOME} />);
    showImagery();
    const near = zoomOf(tiles());
    unmount();

    const far = flight();
    far.result.series.Px = [0, 1000, 3000, 5000];
    far.result.series.Py = [0, 1200, 3200, 5000];
    renderWithProviders(<GroundTrack flight={far} {...HOME} />);
    showImagery();
    expect(zoomOf(tiles())).toBeLessThan(near);
    hideImagery();
  });

  it('carries the provider attribution the tiles require', () => {
    renderWithProviders(<GroundTrack flight={flight()} {...HOME} />);
    showImagery();
    expect(screen.getByText(/Esri/)).toBeTruthy();
    hideImagery();
  });

  it('switches layers, and turns the imagery off entirely', () => {
    renderWithProviders(<GroundTrack flight={flight()} {...HOME} />);

    fireEvent.click(screen.getByRole('button', { name: 'Street' }));
    expect(tiles().every((s) => s.includes('World_Street_Map/MapServer/tile/'))).toBe(true);

    // Off is a real choice, not a disabled-looking button: imagery under a
    // track is context, and sometimes it is in the way.
    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(tiles()).toHaveLength(0);
    // The measurement is what survives, so the plan view is still readable.
    expect(screen.getByRole('img', { name: /over the ground/i })).toBeTruthy();

    hideImagery();
  });

  /**
   * A simulation cannot run without coordinates (services/requiredLaunch.ts),
   * so this is the defensive case rather than the common one. It matters
   * because the alternative - falling back to a default site the way the KML
   * export does - would draw somebody else's field under a real measurement.
   */
  it('draws the bare plan view, with no layer buttons, when the site is blank', () => {
    renderWithProviders(<GroundTrack flight={flight()} latitudeDeg={null} longitudeDeg={null} />);
    expect(tiles()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Satellite' })).toBeNull();
    expect(screen.getByRole('img', { name: /over the ground/i })).toBeTruthy();
  });

  /**
   * The case a plain run actually produces, and the one this feature is judged
   * on: still air lands the rocket a tenth of a meter from the pad.
   *
   * It used to draw no map at all. The view sized itself to the flight, the
   * zoom ran past what any provider holds, and the result was an empty box
   * under a Satellite button that looked pressed. The fix is in the view's
   * scale rather than here: `trackExtent` floors at a field (MIN_EXTENT_M), so
   * there is ground worth showing and the imagery is ordinary imagery.
   */
  it('still draws a map when the rocket lands on the pad', () => {
    const calm = flight();
    calm.result.series.Px = [0, 0.03, 0.07, 0.11];
    calm.result.series.Py = [0, 0.01, 0.02, 0.02];
    renderWithProviders(<GroundTrack flight={calm} {...HOME} />);
    showImagery();

    expect(tiles().length).toBeGreaterThan(0);
    expect(screen.queryByText('No imagery this close in')).toBeNull();
    // And the rings are a walk rather than a measurement in centimeters.
    const labels = Array.from(document.querySelectorAll('svg[role="img"] text')).map((el) => el.textContent ?? '');
    expect(labels.some((x) => /^[1-9]\d*(\.\d+)? m$/.test(x))).toBe(true);
    expect(labels.some((x) => /^0\.\d+ m$/.test(x))).toBe(false);
    hideImagery();
  });

  /**
   * One 404 is a hole in the coverage at this zoom; a screenful failing is no
   * network, and the results views are exactly where somebody is standing in a
   * field with no signal. What is left is the view this had before imagery.
   */
  it('falls back to the bare plan view when the tiles do not arrive', () => {
    renderWithProviders(<GroundTrack flight={flight()} {...HOME} />);
    showImagery();
    const imgs = Array.from(document.querySelectorAll('img'));
    expect(imgs.length).toBeGreaterThan(2);
    for (const img of imgs) fireEvent.error(img);

    expect(tiles()).toHaveLength(0);
    expect(screen.getByText('No imagery offline')).toBeTruthy();
    expect(screen.getByRole('img', { name: /over the ground/i })).toBeTruthy();

    // Still a way back: picking a layer re-asks the network.
    showImagery();
    expect(tiles().length).toBeGreaterThan(0);
    hideImagery();
  });
});
