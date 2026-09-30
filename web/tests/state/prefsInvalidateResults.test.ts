import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../../src/state/store';
import { SIM_PREF_KEYS, changedPrefKeys, type SimPrefs } from '../../src/services/flight/simulations';
import { DEFAULT_SETTINGS } from '../../src/services/storage/settings';
import type { FlightResult } from '../../src/engine/openRocketEngine';

/**
 * A saved result must not claim to be current after the settings it was flown
 * under have moved.
 *
 * Three of the four inputs to a flight already age their own rows: a design edit
 * through the tree watcher, a simulation's own edits through `patchTargets`, and
 * a flight configuration's (motor, ignition, deployment, separation) through
 * `patchConfig`. The GLOBAL run preferences were the one input nothing watched,
 * and results are persisted, so a stale row survived a reload still looking
 * current.
 *
 * The store action is tested rather than the React effect because the decision
 * that matters is per row, not the wiring: which rows a given set of changed
 * keys invalidates.
 */

const RESULT = { summary: { maxAltitude: 100 }, events: [], series: {} } as unknown as FlightResult;

/** Two rows with results: one plain, one pinning its own time step. */
function seed(): void {
  const s = useWorkspaceStore.getState();
  const [first] = s.sims;
  useWorkspaceStore.setState({
    sims: [
      { ...first!, id: 'plain', name: 'Plain', result: RESULT, outdated: false, prefs: undefined },
      {
        ...first!,
        id: 'pinned',
        name: 'Pinned',
        result: RESULT,
        outdated: false,
        prefs: { timeStep: 0.002 },
      },
    ],
  });
}

const row = (id: string) => useWorkspaceStore.getState().sims.find((x) => x.id === id)!;

describe('changedPrefKeys', () => {
  const base = DEFAULT_SETTINGS.simulation as SimPrefs;

  it('names only the keys that moved', () => {
    expect(changedPrefKeys(base, base)).toEqual([]);
    expect(changedPrefKeys(base, { ...base, timeStep: 0.01 })).toEqual(['timeStep']);
    expect(changedPrefKeys(base, { ...base, guideAwareRodClearance: true })).toEqual(['guideAwareRodClearance']);
  });

  /**
   * The settings store hands out a new `simulation` object on every unrelated
   * change in it, so comparing objects rather than keys would age every result
   * on screen when someone switched a unit or a part color.
   */
  it('sees no change in a different object holding the same values', () => {
    expect(changedPrefKeys(base, { ...base })).toEqual([]);
  });

  /** The list is what the invalidation keys off, so it must be the whole type. */
  it('covers every key a flight reads', () => {
    expect([...SIM_PREF_KEYS].sort()).toEqual(
      [
        'deploymentSpeedWarn',
        'drogueLowSpeedWarn',
        'guideAwareRodClearance',
        'mainHighSpeedWarn',
        'mainLowSpeedWarn',
        'maxAngleStep',
        'maxTime',
        'randomSeed',
        'timeStep',
      ].sort(),
    );
  });

  /**
   * These three live in `SimulationSettings` and are deliberately NOT here:
   * two are interface behavior and the third only colors the rod-exit tile.
   * Listing them would age every result for a change that cannot move a number.
   */
  it('excludes the settings that never reach the engine', () => {
    const keys: readonly string[] = SIM_PREF_KEYS;
    expect(keys).not.toContain('confirmDelete');
    expect(keys).not.toContain('autoRunOutdated');
    expect(keys).not.toContain('railExitVelocityMin');
  });
});

describe('markPrefsOutdated', () => {
  beforeEach(seed);

  it('ages a row flown under the old value', () => {
    useWorkspaceStore.getState().markPrefsOutdated(['timeStep']);
    expect(row('plain').outdated).toBe(true);
  });

  /**
   * A row with its own override for the changed key is unaffected: its override
   * wins at run time, so its numbers still stand and flagging it would be a lie
   * in the other direction.
   */
  it('leaves a row that pins the changed key alone', () => {
    useWorkspaceStore.getState().markPrefsOutdated(['timeStep']);
    expect(row('pinned').outdated).toBe(false);
  });

  it('ages the pinning row when a key it does NOT pin moves', () => {
    useWorkspaceStore.getState().markPrefsOutdated(['guideAwareRodClearance']);
    expect(row('pinned').outdated).toBe(true);
    expect(row('plain').outdated).toBe(true);
  });

  it('does nothing when nothing moved', () => {
    const before = useWorkspaceStore.getState().sims;
    useWorkspaceStore.getState().markPrefsOutdated([]);
    // The same array, not an equal one: an untouched store must not re-render
    // every subscriber.
    expect(useWorkspaceStore.getState().sims).toBe(before);
  });

  it('never ages a row that has no result to age', () => {
    const s = useWorkspaceStore.getState();
    const [first] = s.sims;
    useWorkspaceStore.setState({ sims: [{ ...first!, id: 'never-run', result: null, outdated: false }] });
    useWorkspaceStore.getState().markPrefsOutdated(['timeStep']);
    expect(row('never-run').outdated).toBe(false);
  });
});
