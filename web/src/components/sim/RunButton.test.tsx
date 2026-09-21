// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';

import { RunButton } from './RunButton';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../state/store';
import { C6 } from '../../engine/api';
import { MAX_WIND_SPEED_MS } from '../../services/safetyLimits';

const st = () => useWorkspaceStore.getState();
const byName = (n: string) => st().sims.find((x) => x.name === n)!;
const button = () => screen.getByRole('button') as HTMLButtonElement;

// Row 0 survives `beforeEach` (it deletes down to one and re-adds), so its
// launch block has to be reset explicitly or a test that blanks a field leaks
// into the next one.
const LAUNCH = {
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

/**
 * What the button PROMISES has to match what the run will do.
 *
 * It used to judge a batch on the active simulation's motor alone, and only
 * when exactly one row was selected, while blocking the whole batch if any row
 * broke the safety codes. So a twelve-row batch could be refused over one bad
 * row, and a batch containing an unflyable row could be started with the button
 * showing nothing wrong. Both questions now go through `services/runnability`.
 */
describe('RunButton over a selection', () => {
  beforeEach(() => {
    st().setSimsSelected([]);
    while (st().sims.length > 1) st().deleteSim(st().sims[st().sims.length - 1]!.id);
    st().renameSim(st().sims[0]!.id, 'Good');
    st().addSim();
    st().renameSim(st().sims[1]!.id, 'NoMotor');
    st().addSim();
    st().renameSim(st().sims[2]!.id, 'TooWindy');
    st().commitEdit();

    useWorkspaceStore.setState({
      // `info` gates the button independently (the design has to have been
      // measured); a plausible stub keeps this test about runnability.
      info: { length: 0.3, mass: 0.07 } as never,
      sims: st()
        .sims.map((x) => ({ ...x, launch: { ...LAUNCH } }))
        .map((x) =>
          x.name === 'NoMotor'
            ? { ...x, motor: { ...C6, times: [], thrusts: [], masses: [] } }
            : x.name === 'TooWindy'
              ? { ...x, motor: C6, launch: { ...x.launch, windAverage: MAX_WIND_SPEED_MS + 5 } }
              : { ...x, motor: C6 },
        ),
    });
  });

  it('counts only the rows that will actually fly', () => {
    st().setSimsSelected([byName('Good').id, byName('NoMotor').id, byName('TooWindy').id]);
    renderWithProviders(<RunButton />);
    // Three ticked, one flyable: the label must not promise three flights.
    expect(button().disabled).toBe(false);
    expect(button().textContent).toMatch(/Run flight simulation/i);
  });

  it('stays enabled when some rows can fly, and names the ones it will skip', () => {
    st().setSimsSelected([byName('Good').id, byName('TooWindy').id]);
    renderWithProviders(<RunButton />);
    expect(button().disabled).toBe(false);
    // Blocking here would refuse a perfectly good flight over an unrelated row.
    expect(screen.getByText(/TooWindy/)).toBeTruthy();
    expect(screen.getByText(/Skipping/i)).toBeTruthy();
  });

  it('names an unflyable row in a batch, which it used to ignore entirely', () => {
    st().setSimsSelected([byName('Good').id, byName('NoMotor').id]);
    renderWithProviders(<RunButton />);
    expect(screen.getByText(/NoMotor/)).toBeTruthy();
  });

  it('goes dead only when nothing in the selection can fly', () => {
    st().setSimsSelected([byName('NoMotor').id, byName('TooWindy').id]);
    renderWithProviders(<RunButton />);
    expect(button().disabled).toBe(true);
    expect(screen.getByText(/NoMotor/)).toBeTruthy();
    expect(screen.getByText(/TooWindy/)).toBeTruthy();
  });

  it('refuses a row with a blank required field, naming the field', () => {
    // The panel used to coerce a cleared box to 0, so this could not happen and
    // an empty rod length flew as a zero-length rod.
    useWorkspaceStore.setState({
      sims: st().sims.map((x) => (x.name === 'Good' ? { ...x, launch: { ...x.launch, launchRodLengthM: null } } : x)),
    });
    st().setSimsSelected([byName('Good').id]);
    renderWithProviders(<RunButton />);
    expect(button().disabled).toBe(true);
    expect(screen.getByText(/rod length/i)).toBeTruthy();
  });

  it('says nothing at all when every selected row is flyable', () => {
    st().setSimsSelected([byName('Good').id]);
    renderWithProviders(<RunButton />);
    expect(button().disabled).toBe(false);
    expect(screen.queryByText(/Skipping/i)).toBeNull();
  });
});
