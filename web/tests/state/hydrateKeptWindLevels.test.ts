// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { useWorkspaceStore, selectActive, workspaceSnapshot } from '../../src/state/store';
import { DEFAULT_SETTINGS, saveSettings } from '../../src/services/storage/settings';
import { wireLoadedOrk } from '../../src/services/files/wireLoadedOrk';
import type { LoadedOrk } from '../../src/services/files/loadOrk';

const s = () => useWorkspaceStore.getState();

const profile = [
  { altitudeM: 0, speed: 3, directionDeg: 90, stddev: 0.3 },
  { altitudeM: 500, speed: 6, directionDeg: 120, stddev: 1.2 },
];

afterEach(() => localStorage.clear());

/**
 * A profile kept under the Average model belongs to the simulation that holds
 * it. A stored workspace keeps it across a reload, and a launch without one
 * does not take the defaults', or a file that never had a profile is saved
 * with one.
 */
describe('a profile kept under the Average model, on reload and on open', () => {
  it('survives a reload of the stored workspace', () => {
    s().resetWorkspace();
    const stored = workspaceSnapshot(s());
    const sims = stored.sims.map((x) => ({ ...x, launch: { ...x.launch, keptWindLevels: profile } }));
    s().hydrate(JSON.parse(JSON.stringify({ ...stored, sims })));
    expect(selectActive(s()).launch.keptWindLevels).toEqual(profile);
    expect(selectActive(s()).launch.windLevels).toBeUndefined();
  });

  it('is not taken from the defaults by a stored simulation without one', () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      launchDefaults: { ...DEFAULT_SETTINGS.launchDefaults, keptWindLevels: profile },
    });
    s().resetWorkspace();
    const stored = workspaceSnapshot(s());
    const sims = stored.sims.map((x) => {
      const { keptWindLevels: _drop, ...launch } = x.launch;
      return { ...x, launch };
    });
    s().hydrate(JSON.parse(JSON.stringify({ ...stored, sims })));
    expect(selectActive(s()).launch).not.toHaveProperty('keptWindLevels');
  });

  it('is not taken from the defaults by a file simulation without one', () => {
    const defaults = { ...DEFAULT_SETTINGS.launchDefaults, keptWindLevels: profile };
    const res = {
      name: 'Rocket',
      notes: [],
      tree: { components: [] },
      motors: {},
      configs: [{ id: 'cfg-1', name: null, motors: {} }],
      chosenConfigId: 'cfg-1',
      launch: { windAverage: 2 },
      simulations: [{ name: 'Simulation 1', configId: 'cfg-1', launch: { windAverage: 2 } }],
    } as unknown as LoadedOrk;
    const w = wireLoadedOrk(res, defaults);
    expect(w.sims[0]!.launch).not.toHaveProperty('keptWindLevels');
    expect(w.sims[0]!.launch.windAverage).toBe(2);
  });
});

/**
 * A launch without a flown profile flies the Average model, so a multilevel
 * profile in the Settings defaults must not reach it through the merge that
 * fills its missing fields. A new simulation, which has no launch of its own,
 * takes the defaults whole, profile included.
 */
describe('a default multilevel profile', () => {
  const withDefaultProfile = () =>
    saveSettings({
      ...DEFAULT_SETTINGS,
      launchDefaults: { ...DEFAULT_SETTINGS.launchDefaults, windLevels: profile },
    });

  it('does not turn a stored Average simulation into a multilevel one', () => {
    s().resetWorkspace();
    const stored = workspaceSnapshot(s());
    withDefaultProfile();
    const sims = stored.sims.map((x) => {
      const { windLevels: _drop, ...launch } = x.launch;
      return { ...x, launch };
    });
    s().hydrate(JSON.parse(JSON.stringify({ ...stored, sims })));
    expect(selectActive(s()).launch).not.toHaveProperty('windLevels');
  });

  it('does not turn an Average file simulation into a multilevel one', () => {
    const defaults = { ...DEFAULT_SETTINGS.launchDefaults, windLevels: profile };
    const res = {
      name: 'Rocket',
      notes: [],
      tree: { components: [] },
      motors: {},
      configs: [{ id: 'cfg-1', name: null, motors: {} }],
      chosenConfigId: 'cfg-1',
      launch: { windAverage: 2 },
      simulations: [{ name: 'Simulation 1', configId: 'cfg-1', launch: { windAverage: 2 } }],
    } as unknown as LoadedOrk;
    expect(wireLoadedOrk(res, defaults).sims[0]!.launch).not.toHaveProperty('windLevels');
  });

  it('is what a new simulation flies', () => {
    s().resetWorkspace();
    withDefaultProfile();
    s().addSim();
    expect(selectActive(s()).launch.windLevels).toEqual(profile);
  });
});
