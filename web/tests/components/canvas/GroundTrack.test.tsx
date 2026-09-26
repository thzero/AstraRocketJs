// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { GroundTrack } from '../../../src/components/canvas/GroundTrack';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { ChartFlight } from '../../../src/components/canvas/FlightChart';
import type { LaunchConditions } from '../../../src/services/orkTree';
import { useWorkspaceStore } from '../../../src/state/store';
import { defaultSweepSpec, type DriftSweep } from '../../../src/services/windSweep';
import { simInputs } from '../../../src/services/simulations';

const st = () => useWorkspaceStore.getState();

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

/** A complete, in-limits set of conditions — what the drift-sweep panel reads. */
const LAUNCH = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 0,
  windAverage: 4,
  windStdDev: 0.4,
  windDirectionDeg: 90,
  launchAltitudeM: 1800,
  latitudeDeg: 39.05,
  longitudeDeg: -104.8,
  temperatureC: null,
  pressureHPa: null,
} satisfies LaunchConditions;

const HOME = { latitudeDeg: 39.05, longitudeDeg: -104.8, launch: LAUNCH };

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
    renderWithProviders(<GroundTrack flight={flight()} latitudeDeg={null} longitudeDeg={null} launch={LAUNCH} />);
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

/**
 * The drift region a wind sweep leaves behind.
 *
 * The store is written directly rather than a sweep being flown: what is under
 * test here is the DRAWING — that the region belongs to the right flight, is
 * framed rather than clipped, and says which ground it covers.
 */
describe('GroundTrack drift region', () => {
  // The flight the fixture draws is `sim-1`, and the sweep panel looks its row
  // up in the store to decide whether the sweep has aged. Without a row of that
  // id every sweep would read as stale, and the staleness test below would pass
  // for the wrong reason.
  beforeEach(() => {
    useWorkspaceStore.setState({ sims: st().sims.map((x, i) => (i === 0 ? { ...x, id: 'sim-1' } : x)) });
  });

  /** Four landings in a square 800 m across, well outside the 500 m track. */
  const sweep = (simId: string, tree = st().tree): DriftSweep => ({
    simId,
    tree,
    inputs: simInputs(st().sims[0]!),
    spec: defaultSweepSpec(4),
    asked: 4,
    flown: 4,
    landings: [
      { branch: 0, east: 400, north: 400, speedMs: 2, headingDeg: 0 },
      { branch: 0, east: -400, north: 400, speedMs: 2, headingDeg: 90 },
      { branch: 0, east: -400, north: -400, speedMs: 6, headingDeg: 180 },
      { branch: 0, east: 400, north: -400, speedMs: 6, headingDeg: 270 },
    ],
  });

  afterEach(() => useWorkspaceStore.setState({ driftSweep: null, driftSweepRun: null }));

  const shapes = () => Array.from(document.querySelectorAll('svg[role="img"] polygon'));

  it('draws the envelope, the ellipse and every swept landing', () => {
    useWorkspaceStore.setState({ driftSweep: sweep('sim-1') });
    renderWithProviders(<GroundTrack flight={flight()} {...HOME} />);
    // The filled hull and the dashed ellipse.
    expect(shapes()).toHaveLength(2);
    expect(shapes()[0]!.getAttribute('fill-opacity')).toBe('0.14');
    expect(shapes()[1]!.getAttribute('stroke-dasharray')).toBeTruthy();
    // One dot per landing, plus the pad. The landing markers are rings (no
    // fill), so filled circles are the samples.
    const dots = Array.from(document.querySelectorAll('svg[role="img"] circle')).filter(
      (c) => c.getAttribute('r') === '1.6',
    );
    expect(dots).toHaveLength(4);
  });

  /**
   * A sweep is held one at a time, workspace-wide. Drawing another row's
   * landings over this one's track would be a picture of two different flights.
   */
  it('ignores a sweep flown for another simulation', () => {
    useWorkspaceStore.setState({ driftSweep: sweep('some-other-sim') });
    renderWithProviders(<GroundTrack flight={flight()} {...HOME} />);
    expect(shapes()).toHaveLength(0);
  });

  /**
   * The region routinely reaches further than the single track drawn through
   * it, so the frame has to be sized to hold it — otherwise the view clips
   * exactly the thing it was opened for.
   */
  it('widens the frame to hold a region bigger than the track', () => {
    const labels = () =>
      Array.from(document.querySelectorAll('svg[role="img"] text')).map((el) => el.textContent ?? '');
    const { unmount } = renderWithProviders(<GroundTrack flight={flight()} {...HOME} />);
    const withoutSweep = labels();
    unmount();

    useWorkspaceStore.setState({ driftSweep: sweep('sim-1') });
    renderWithProviders(<GroundTrack flight={flight()} {...HOME} />);
    const biggest = (xs: string[]) => Math.max(...xs.flatMap((x) => (/^(\d+) m$/.exec(x) ? [Number(RegExp.$1)] : [])));
    expect(biggest(labels())).toBeGreaterThan(biggest(withoutSweep));
  });

  it('reads out the swept range band beside the flown one', () => {
    useWorkspaceStore.setState({ driftSweep: sweep('sim-1') });
    renderWithProviders(<GroundTrack flight={flight()} {...HOME} />);
    // Every landing of this sweep is the same distance out: 400√2 ≈ 566 m.
    expect(screen.getByText('(566–566 m)')).toBeTruthy();
  });

  /**
   * The design or the row's own motor and conditions can move after a sweep
   * flew. The region is still the honest answer for the rocket that flew it, so
   * it stays up and says so rather than vanishing or redrawing as current.
   */
  it('flags a region older than what is on screen, without dropping it', () => {
    // Same sweep twice: once against the design it flew, once against a design
    // that has moved since.
    useWorkspaceStore.setState({ driftSweep: sweep('sim-1') });
    const { unmount } = renderWithProviders(<GroundTrack flight={flight()} {...HOME} />);
    fireEvent.click(screen.getByRole('button', { name: 'Drift' }));
    expect(screen.queryByText(/design has changed/i)).toBeNull();
    unmount();

    useWorkspaceStore.setState({ driftSweep: { ...sweep('sim-1'), tree: { ...st().tree } } });
    renderWithProviders(<GroundTrack flight={flight()} {...HOME} />);
    // Still drawn: the landings are the honest answer for the rocket that flew
    // them, and re-flying a few dozen sims to get the picture back is not a
    // price to pay for a fin tweak.
    expect(shapes()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Drift' }));
    expect(screen.getByText(/design has changed/i)).toBeTruthy();
  });

  /**
   * The region is what somebody reads when deciding how big a field they need,
   * so how settled it is belongs beside it rather than only in the docs.
   */
  it('says on the panel that the region is experimental', () => {
    renderWithProviders(<GroundTrack flight={flight()} {...HOME} />);
    fireEvent.click(screen.getByRole('button', { name: 'Drift' }));
    expect(screen.getByText('Experimental')).toBeTruthy();
    expect(screen.getByText(/not a range clearance/i)).toBeTruthy();
  });

  it('opens the sweep controls from the Drift button', () => {
    renderWithProviders(<GroundTrack flight={flight()} {...HOME} />);
    expect(screen.queryByRole('button', { name: 'Run sweep' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Drift' }));
    expect(screen.getByRole('button', { name: 'Run sweep' })).toBeTruthy();
    // Seeded from the flight's own 4 m/s wind, over the whole compass.
    expect((screen.getByLabelText('Speeds') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('Headings') as HTMLInputElement).value).toBe('8');
    expect(screen.getByText('32 flights')).toBeTruthy();
  });
});
