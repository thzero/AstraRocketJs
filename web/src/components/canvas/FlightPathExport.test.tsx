// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { ExportDialog } from './FlightPathExport';
import { readSettings, renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import type { FlightResult } from '../../engine/openRocketEngine';
import type { LaunchConditions } from '../../services/orkTree';

const series = {
  time: [0, 1, 2],
  altitude: [0, 100, 0],
  velocity: [0, 50, 10],
  acceleration: [20, 5, -9.8],
  Px: [0, 50, 100],
  Py: [0, 100, 200],
};
const events = [{ type: 'APOGEE', time: 1 }];

const flight = (branches?: unknown[]) =>
  ({
    summary: { maxAltitude: 100, maxVelocity: 50, maxAcceleration: 20 },
    series,
    events,
    ...(branches ? { branches } : {}),
  }) as unknown as FlightResult;

const launch = { latitudeDeg: 40, longitudeDeg: -105, launchAltitudeM: 1600 } as LaunchConditions;

const show = (result: FlightResult) =>
  renderWithProviders(
    <ExportDialog
      onClose={() => {}}
      meta={{ simName: 'Sim', rocketName: 'R', motorName: 'C6' }}
      launch={launch}
      result={result}
    />,
  );

const trackRef = () => screen.getByLabelText('Track altitude from') as HTMLSelectElement;
const pinRef = () => screen.getByLabelText('Waypoint altitude from') as HTMLSelectElement;
const shadow = () => screen.getByRole('checkbox', { name: 'Draw shadow down to the ground' }) as HTMLInputElement;
const balloons = () => screen.getByRole('checkbox', { name: 'Summary balloons' }) as HTMLInputElement;
const preset = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
/** The preset the toggle group currently claims, or null for none. */
const pressed = () =>
  ['Drift cast', 'Flight path', 'Landing plots'].find((n) => preset(n).getAttribute('aria-pressed') === 'true') ?? null;

/**
 * The placement options decide how the exported KML sits on the map. The button
 * that opens this dialog lives in the 3D path view, which needs WebGL and
 * crashes headless Chromium — so the wiring is checked here instead of in an
 * end-to-end test.
 */
describe('flight-path export dialog', () => {
  // The dialog persists its options now, so cases would otherwise inherit
  // each other's choices through localStorage - which is exactly the
  // cross-export carry-over the feature is FOR, and exactly what a test
  // must not have.
  beforeEach(() => localStorage.clear());

  it('opens on the flight-path placement, selected', () => {
    // The preset definitions and the dialog defaults have to agree, or the
    // panel opens in a shape no button claims. This is the assertion that
    // keeps them agreeing.
    show(flight());
    expect(pressed()).toBe('Flight path');
  });

  it('turns the shadow on from no placement at all', () => {
    // A plumb line under one pin reads as a position; a curtain under the whole
    // length of an arcing flight path is a wall that buries the flight it is
    // meant to explain. The checkbox stays, for the case it is good at.
    show(flight());
    for (const name of ['Drift cast', 'Flight path', 'Landing plots']) {
      fireEvent.click(preset(name));
      expect(shadow().checked).toBe(false);
    }
  });

  it('clears the placement highlight the moment a control it covers is moved', () => {
    // A preset only SETS the controls, so a selection that survived an edit
    // would be claiming a shape the dialog had since been adjusted out of.
    show(flight());
    fireEvent.click(preset('Drift cast'));
    expect(pressed()).toBe('Drift cast');

    fireEvent.change(trackRef(), { target: { value: 'sealevel' } });
    expect(pressed()).toBeNull();

    // ...and it comes back when the controls spell that preset out again.
    fireEvent.change(trackRef(), { target: { value: 'clamped' } });
    expect(pressed()).toBe('Drift cast');
  });

  it('writes the summary balloons out of the box, and no placement changes that', () => {
    show(flight());
    expect(balloons().checked).toBe(true);
    for (const name of ['Drift cast', 'Flight path', 'Landing plots']) {
      fireEvent.click(preset(name));
      expect(balloons().checked).toBe(true); // not a placement, so not a preset's business
    }
    // It is still a control, and turning it off does not cost the placement.
    fireEvent.click(preset('Drift cast'));
    fireEvent.click(balloons());
    expect(balloons().checked).toBe(false);
    expect(pressed()).toBe('Drift cast');
  });

  it('starts on the desktop defaults', () => {
    show(flight());
    expect(trackRef().value).toBe('automatic');
    expect(pinRef().value).toBe('automatic');
    expect(shadow().checked).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'Draw waypoint names on the map' })).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Color waypoint pins per stage' }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('sets the track and the pins independently', () => {
    // The case the split exists for: the flight in the air, the pins flat on the
    // ground so you can read what they sit over.
    show(flight());
    const options = ['automatic', 'ground', 'sealevel', 'clamped'];
    expect([...trackRef().options].map((o) => o.value)).toEqual(options);
    expect([...pinRef().options].map((o) => o.value)).toEqual(options);

    fireEvent.change(trackRef(), { target: { value: 'sealevel' } });
    fireEvent.change(pinRef(), { target: { value: 'clamped' } });
    expect([trackRef().value, pinRef().value]).toEqual(['sealevel', 'clamped']);
  });

  it('disables the shadow only once BOTH halves are on the ground', () => {
    show(flight());
    fireEvent.change(trackRef(), { target: { value: 'clamped' } });
    expect(shadow().disabled).toBe(false); // pins are still in the air

    fireEvent.change(pinRef(), { target: { value: 'clamped' } });
    expect(shadow().disabled).toBe(true); // nothing left to draw a shadow from
  });

  it('presets reach all three sections, and only through the visible controls', () => {
    show(flight());
    const check = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

    fireEvent.click(screen.getByRole('button', { name: 'Drift cast' }));
    expect([trackRef().value, pinRef().value]).toEqual(['clamped', 'clamped']); // placement
    expect(check('Include flight path line').checked).toBe(false); // lines
    expect(check('Include ground track').checked).toBe(true);
    expect(check('Landing').checked).toBe(true); // waypoints — the third section

    // Landing plots narrows the waypoints to the one it is about.
    fireEvent.click(screen.getByRole('button', { name: 'Landing plots' }));
    expect(check('Landing').checked).toBe(true);
    expect(check('Apogee').checked).toBe(false);
    expect(check('Include ground track').checked).toBe(false);

    // …and a preset is a starting point, not a mode: every control still moves.
    fireEvent.change(trackRef(), { target: { value: 'sealevel' } });
    fireEvent.click(check('Apogee'));
    expect(trackRef().value).toBe('sealevel');
    expect(check('Apogee').checked).toBe(true);
  });

  it('every preset is reachable from every other', () => {
    // Each states its whole selection, waypoints included, so none of them is a
    // one-way door. Landing plots narrows the waypoints to the landing; Drift
    // cast has to be able to put them back, or it quietly becomes a drift cast
    // that plots nothing but the landing.
    show(flight());
    const check = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

    fireEvent.click(screen.getByRole('button', { name: 'Landing plots' }));
    expect(check('Apogee').checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Drift cast' }));
    expect(check('Apogee').checked).toBe(true);
    expect(check('Include ground track').checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Flight path' }));
    expect(check('Apogee').checked).toBe(true);
    expect(check('Include flight path line').checked).toBe(true);
  });

  it('hides the stage-track control for a single-stage flight', () => {
    // It asks where each stage's track begins, which means nothing when there
    // is one — and an option that cannot matter is noise in a busy dialog.
    show(flight());
    expect(screen.queryByLabelText("Each stage's track starts")).toBeNull();
  });

  it('shows the stage-track control once the flight staged', () => {
    show(
      flight([
        { name: 'Sustainer', events, series },
        { name: 'Booster', events, series },
      ]),
    );
    const select = screen.getByLabelText("Each stage's track starts") as HTMLSelectElement;
    expect(select.value).toBe('separation');
    expect([...select.options].map((o) => o.value)).toEqual(['separation', 'pad']);
  });

  it('offers an export language, following the app until you pick one', () => {
    // Same argument as the two unit dropdowns beside it: the language belongs
    // to the FILE, because a KML going to somebody else may want their language
    // whatever you are reading the app in.
    show(flight());
    const select = screen.getByLabelText('Language') as HTMLSelectElement;
    expect(select.value).toBe(''); // follow the app
    expect([...select.options].map((o) => o.value)).toEqual([
      '',
      'en',
      'de',
      'es',
      'fr',
      'pt-BR',
      'pt-PT',
      'nl',
      'pl',
      'ru',
      'ja',
    ]);
    expect(select.options[0]!.textContent).toBe('Same as the app');
  });

  it('remembers the export language, including a deliberate "follow the app"', () => {
    // '' is a choice here, not an absence, so it has to survive a reload -
    // picking Spanish and then going back has to stick rather than silently
    // leaving the file in Spanish next time.
    const stored = () => (readSettings().pathExport as Record<string, unknown>).exportLanguage;
    const { unmount } = show(flight());
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'es' } });
    expect(stored()).toBe('es');

    unmount();
    show(flight());
    expect((screen.getByLabelText('Language') as HTMLSelectElement).value).toBe('es');
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: '' } });
    expect(stored()).toBe('');
  });

  it('carries the mission name, and leaves the markers out of it by default', () => {
    show(flight());
    const mission = screen.getByLabelText('Mission') as HTMLInputElement;
    expect(mission.value).toBe(''); // never carried over from the last export
    fireEvent.change(mission, { target: { value: 'Sod Blaster' } });
    expect(mission.value).toBe('Sod Blaster');
    expect((screen.getByRole('checkbox', { name: 'Prefix the waypoint names too' }) as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it('carries the options, including every stage color, into the next export', () => {
    const { unmount } = show(
      flight([
        { name: 'Sustainer', events, series },
        { name: 'Booster', events, series },
      ]),
    );
    const openColors = () => fireEvent.click(screen.getByRole('button', { name: 'Stage colors\u2026' }));
    const colors = () => within(screen.getByRole('dialog', { name: 'Stage colors' }));
    const swatch = (stage: string, role: string) => colors().getByLabelText(`${stage} ${role}`) as HTMLInputElement;

    openColors();
    fireEvent.change(swatch('Sustainer', 'Path'), { target: { value: '#112233' } });
    fireEvent.change(swatch('Sustainer', 'Ground'), { target: { value: '#445566' } });
    fireEvent.change(swatch('Booster', 'Pin'), { target: { value: '#778899' } });
    fireEvent.click(colors().getByRole('button', { name: 'OK' }));

    // Close the dialog entirely and open a fresh one, which is the real
    // question: does the NEXT export start where the last one left off.
    unmount();
    show(
      flight([
        { name: 'Sustainer', events, series },
        { name: 'Booster', events, series },
      ]),
    );
    openColors();
    expect(swatch('Sustainer', 'Path').value).toBe('#112233');
    expect(swatch('Sustainer', 'Ground').value).toBe('#445566');
    expect(swatch('Booster', 'Pin').value).toBe('#778899');
    // Sparse: a stage nobody touched still follows its palette rather than
    // having today's palette frozen in as an override.
    expect(swatch('Booster', 'Path').value).toBe('#d95319');
    expect(swatch('Sustainer', 'Pin').value).toBe('#0072bd');
  });

  it('does not carry the mission name over', () => {
    // The one field that deliberately still starts fresh: a name left from the
    // last flight silently mislabels this one, which is worse than retyping it.
    const { unmount } = show(flight());
    const mission = () => screen.getByLabelText('Mission') as HTMLInputElement;
    fireEvent.change(mission(), { target: { value: 'Ship of Theseus' } });
    expect(mission().value).toBe('Ship of Theseus');

    unmount();
    show(flight());
    expect(mission().value).toBe('');
  });

  it('gives every stage a swatch per role, and only commits them on OK', () => {
    show(
      flight([
        { name: 'Sustainer', events, series },
        { name: 'Booster', events, series },
      ]),
    );
    const openColors = () => fireEvent.click(screen.getByRole('button', { name: 'Stage colors\u2026' }));
    // Scoped to the sub-dialog: the export dialog behind it has a Cancel too.
    const colors = () => within(screen.getByRole('dialog', { name: 'Stage colors' }));
    const swatch = (stage: string, role: string) => colors().getByLabelText(`${stage} ${role}`) as HTMLInputElement;

    openColors();
    // Each role starts on its OWN palette, not on a shade of the path's.
    expect(swatch('Sustainer', 'Path').value).toBe('#0072bd');
    expect(swatch('Sustainer', 'Ground').value).toBe('#ff2d55');
    expect(swatch('Sustainer', 'Pin').value).toBe('#0072bd');
    expect(swatch('Booster', 'Path').value).toBe('#d95319');
    expect(swatch('Booster', 'Ground').value).toBe('#00b3a4');

    // Cancel leaves the prior selection exactly as it was.
    fireEvent.change(swatch('Sustainer', 'Path'), { target: { value: '#112233' } });
    fireEvent.click(colors().getByRole('button', { name: 'Cancel' }));
    openColors();
    expect(swatch('Sustainer', 'Path').value).toBe('#0072bd');

    // Moving one column must NOT drag the others. An earlier design had ground
    // and pin follow the path swatch while they were still on their derived
    // value, which made two identical-looking swatches behave differently
    // depending on history.
    fireEvent.change(swatch('Sustainer', 'Path'), { target: { value: '#112233' } });
    expect(swatch('Sustainer', 'Ground').value).toBe('#ff2d55');
    expect(swatch('Sustainer', 'Pin').value).toBe('#0072bd');

    // OK commits every column, and reopening shows what was committed.
    fireEvent.change(swatch('Sustainer', 'Ground'), { target: { value: '#445566' } });
    fireEvent.change(swatch('Sustainer', 'Pin'), { target: { value: '#778899' } });
    fireEvent.click(colors().getByRole('button', { name: 'OK' }));
    openColors();
    expect(swatch('Sustainer', 'Path').value).toBe('#112233');
    expect(swatch('Sustainer', 'Ground').value).toBe('#445566');
    expect(swatch('Sustainer', 'Pin').value).toBe('#778899');
    expect(swatch('Booster', 'Path').value).toBe('#d95319'); // untouched stage

    // Reset drops every override rather than freezing today's palettes in.
    fireEvent.click(colors().getByRole('button', { name: 'Reset to defaults' }));
    expect(swatch('Sustainer', 'Path').value).toBe('#0072bd');
    expect(swatch('Sustainer', 'Ground').value).toBe('#ff2d55');
    expect(swatch('Sustainer', 'Pin').value).toBe('#0072bd');
  });

  it('toggles the waypoint display options', () => {
    show(flight());
    const pins = screen.getByRole('checkbox', { name: 'Color waypoint pins per stage' }) as HTMLInputElement;
    fireEvent.click(pins);
    expect(pins.checked).toBe(false);
  });

  /**
   * What the dialog writes to the app settings, and when. It used to persist
   * from an effect keyed on the whole option object: that ran on mount (so
   * merely opening the dialog rewrote the settings) and on every keystroke in
   * the mission field (which is the one field deliberately NOT persisted), and
   * it stored the units unconditionally, which froze them to whatever the app
   * showed on the first open instead of following the app's distance unit.
   */
  describe('persistence', () => {
    const altUnit = () => screen.getByLabelText('Altitude') as HTMLSelectElement;
    const distUnit = () => screen.getByLabelText('Distance') as HTMLSelectElement;
    const stored = () => localStorage.getItem('astrarrocketjs:settings:v1');
    /** The app's Settings > Units distance preference, changed outside the dialog. */
    const setAppDistance = (unit: string) => {
      const s = readSettings();
      seedSettings({ ...s, units: { ...(s.units as Record<string, string>), distance: unit } });
    };

    it('does not persist anything just for being opened', () => {
      show(flight());
      expect(stored()).toBeNull();
    });

    it('does not write the settings while the mission name is typed', () => {
      show(flight());
      const mission = screen.getByLabelText('Mission') as HTMLInputElement;
      fireEvent.change(mission, { target: { value: 'S' } });
      fireEvent.change(mission, { target: { value: 'Sod' } });
      expect(mission.value).toBe('Sod');
      expect(stored()).toBeNull();
    });

    it('writes the settings when a persisted option changes', () => {
      show(flight());
      fireEvent.click(screen.getByRole('checkbox', { name: 'Apogee' }));
      const p = readSettings().pathExport as Record<string, unknown>;
      expect(p.waypoints).not.toContain('apogee');
      // The mission name is not part of what was written.
      expect(p).not.toHaveProperty('missionName');
    });

    it('follows the app distance unit until a unit is chosen in the dialog', () => {
      const { unmount } = show(flight());
      expect([altUnit().value, distUnit().value]).toEqual(['m', 'm']);
      // A persisted change, so the store IS written after this open...
      fireEvent.click(screen.getByRole('checkbox', { name: 'Apogee' }));
      unmount();
      // ...and neither unit was frozen into it.
      const p = readSettings().pathExport as Record<string, unknown>;
      expect(p).not.toHaveProperty('altitudeUnit');
      expect(p).not.toHaveProperty('distanceUnit');

      setAppDistance('ft');
      show(flight());
      expect([altUnit().value, distUnit().value]).toEqual(['ft', 'ft']);
    });

    it('keeps a unit chosen in the dialog, and only that one', () => {
      const { unmount } = show(flight());
      fireEvent.change(altUnit(), { target: { value: 'km' } });
      unmount();

      setAppDistance('ft');
      show(flight());
      expect(altUnit().value).toBe('km'); // the explicit choice outranks the app
      expect(distUnit().value).toBe('ft'); // the untouched one still follows it
    });
  });
});
