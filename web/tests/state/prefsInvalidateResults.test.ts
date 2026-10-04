import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../../src/state/store';
import { SIM_PREF_KEYS, changedPrefKeys, type SimPrefs } from '../../src/services/flight/simulations';
import { DEFAULT_SETTINGS } from '../../src/services/storage/settings';
import type { FlightResult } from '../../src/engine/openRocketEngine';
import { asFlown, isStale } from '../testing/flown';

/**
 * A saved result must not claim to be current after the settings it was flown
 * under have moved.
 *
 * The global run preferences are one of the four inputs a result's key covers,
 * alongside the design, the configuration and the row's launch conditions. The
 * store is tested rather than the React effect that mirrors the settings into
 * it, because the decision that matters is per row: which rows a given change
 * ages.
 */

const RESULT = { summary: { maxAltitude: 100 }, events: [], series: {} } as unknown as FlightResult;

/** Two rows with results: one plain, one pinning its own time step. */
function seed(): void {
  const s = useWorkspaceStore.getState();
  s.setSimPrefs(BASE);
  const [first] = s.sims;
  useWorkspaceStore.setState((st) => ({
    sims: [
      asFlown(st, { ...first!, id: 'plain', name: 'Plain', result: RESULT, prefs: undefined }),
      asFlown(st, { ...first!, id: 'pinned', name: 'Pinned', result: RESULT, prefs: { timeStep: 0.002 } }),
    ],
  }));
}

const BASE: SimPrefs = DEFAULT_SETTINGS.simulation;
const row = (id: string) => useWorkspaceStore.getState().sims.find((x) => x.id === id)!;
const setGlobals = (p: Partial<SimPrefs>) => useWorkspaceStore.getState().setSimPrefs({ ...BASE, ...p });

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

describe('a change to the global run preferences', () => {
  beforeEach(seed);

  it('starts with both rows current', () => {
    expect(isStale(row('plain'))).toBe(false);
    expect(isStale(row('pinned'))).toBe(false);
  });

  it('ages a row flown under the old value', () => {
    setGlobals({ timeStep: 0.01 });
    expect(isStale(row('plain'))).toBe(true);
  });

  /**
   * A row with its own override for the changed key is unaffected: its override
   * wins at run time, so its numbers still stand and flagging it would be a lie
   * in the other direction.
   */
  it('leaves a row that pins the changed key alone', () => {
    setGlobals({ timeStep: 0.01 });
    expect(isStale(row('pinned'))).toBe(false);
  });

  it('ages the pinning row when a key it does NOT pin moves', () => {
    setGlobals({ guideAwareRodClearance: !BASE.guideAwareRodClearance });
    expect(isStale(row('pinned'))).toBe(true);
    expect(isStale(row('plain'))).toBe(true);
  });

  it('reads current again when the value goes back', () => {
    setGlobals({ timeStep: 0.01 });
    setGlobals({});
    expect(isStale(row('plain'))).toBe(false);
  });

  it('does nothing when no flight key moved', () => {
    const before = useWorkspaceStore.getState().simPrefs;
    // A new object holding the same values, as the settings store hands out on
    // every unrelated change: it must not re-render every subscriber.
    useWorkspaceStore.getState().setSimPrefs({ ...BASE });
    expect(useWorkspaceStore.getState().simPrefs).toBe(before);
  });

  it('never ages a row that has no result to age', () => {
    const [first] = useWorkspaceStore.getState().sims;
    useWorkspaceStore.setState({ sims: [{ ...first!, id: 'never-run', result: null }] });
    setGlobals({ timeStep: 0.01 });
    expect(isStale(row('never-run'))).toBe(false);
  });
});
