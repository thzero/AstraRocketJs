import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore, selectActive, configOf } from '../../src/state/store';
import { asFlown, isStale } from '../testing/flown';
import { C6 } from '../../src/engine/api';
import { findMounts } from '../../src/services/design/treeEdit';
import { primaryMotor } from '../../src/services/flight/flightConfigs';

const st = () => useWorkspaceStore.getState();
const byName = (n: string) => st().sims.find((x) => x.name === n)!;
/** The default design's one mount, and what a named row has seated in it. */
const mountId = () => findMounts(st().tree)[0]!.id as string;
const motorOf = (n: string) => primaryMotor(st().tree, configOf(st().configs, byName(n)))!;
const configIdOf = (n: string) => byName(n).configId;
const ignitionOf = (n: string) => configOf(st().configs, byName(n)).motors[mountId()]?.ignitionEvent;

/**
 * Editing follows the SELECTION: a tick already means "fly these" and "delete
 * these", and now means "edit these" too. The property that makes it safe is
 * that each mutator merges into the target's OWN state, so only the field the
 * user touched moves.
 */
describe('editing across a selection', () => {
  beforeEach(() => {
    // From a clean workspace, so one case's motor change cannot leave the next
    // case's rows on configurations of their own: `addSim` joins the setup that
    // already holds the default loadout, and an edited one no longer holds it.
    st().resetWorkspace();
    // Three simulations that disagree, so a patch that wrongly copied the
    // active one's whole block would be visible rather than a no-op.
    const s = st();
    s.setSimsSelected([]);
    while (st().sims.length > 1) st().deleteSim(st().sims[st().sims.length - 1]!.id);
    const first = st().sims[0]!.id;
    st().renameSim(first, 'A');
    st().setActiveId(first);
    st().patchLaunch({ windAverage: 1, launchRodLengthM: 1 });

    st().addSim();
    st().renameSim(st().sims[1]!.id, 'B');
    st().setActiveId(st().sims[1]!.id);
    st().patchLaunch({ windAverage: 2, launchRodLengthM: 2 });

    st().addSim();
    st().renameSim(st().sims[2]!.id, 'C');
    st().setActiveId(st().sims[2]!.id);
    st().patchLaunch({ windAverage: 3, launchRodLengthM: 3 });

    st().setActiveId(first);
    st().setSimsSelected([]);
    st().commitEdit();
    // Every row flown on the fixtures as built, so "this edit aged these rows"
    // is a real assertion.
    useWorkspaceStore.setState((s) => ({
      sims: s.sims.map((x) => asFlown(s, { ...x, result: { summary: {} } as never })),
    }));
  });

  it('writes to the active simulation alone when nothing is ticked', () => {
    st().patchLaunch({ windAverage: 42 });
    expect(byName('A').launch.windAverage).toBe(42);
    expect(byName('B').launch.windAverage).toBe(2);
    expect(byName('C').launch.windAverage).toBe(3);
  });

  it('writes to every ticked row', () => {
    st().setSimsSelected([byName('A').id, byName('C').id]);
    st().patchLaunch({ windAverage: 42 });
    expect(byName('A').launch.windAverage).toBe(42);
    expect(byName('C').launch.windAverage).toBe(42);
    expect(byName('B').launch.windAverage).toBe(2); // not ticked
  });

  it('moves ONLY the edited key, leaving each row its own other values', () => {
    // The whole point. Merging `{...active.launch, ...p}` would have copied the
    // active simulation's rod length onto the others as a side effect.
    st().setSimsSelected([byName('A').id, byName('B').id, byName('C').id]);
    st().patchLaunch({ windAverage: 42 });
    expect(byName('A').launch.launchRodLengthM).toBe(1);
    expect(byName('B').launch.launchRodLengthM).toBe(2);
    expect(byName('C').launch.launchRodLengthM).toBe(3);
  });

  it('ages every row it touched, so their cached results read as stale', () => {
    st().setSimsSelected([byName('A').id, byName('B').id]);
    st().patchLaunch({ windAverage: 7 });
    expect(isStale(byName('A'))).toBe(true);
    expect(isStale(byName('B'))).toBe(true);
    expect(isStale(byName('C'))).toBe(false);
  });

  it('keeps the name single-target, because three rows of one name is no naming', () => {
    st().setSimsSelected([byName('A').id, byName('B').id, byName('C').id]);
    const id = selectActive(st()).id;
    st().renameSim(id, 'Renamed');
    expect(
      st()
        .sims.map((x) => x.name)
        .sort(),
    ).toEqual(['B', 'C', 'Renamed']);
  });

  it('changes the motor for every row flying that configuration, tick or no tick', () => {
    // A motor belongs to a configuration, not to a row. A/B/C were created with
    // the same loadout, so they fly ONE configuration and all three move: that is
    // what sharing a setup means, and it is why the selection is not consulted.
    st().setSimsSelected([byName('A').id]);
    const D12 = { ...C6, designation: 'D12' };
    st().setMountMotor(configIdOf('A'), mountId(), D12);
    expect(motorOf('A').designation).toBe('D12');
    expect(motorOf('B').designation).toBe('D12');
    expect(motorOf('C').designation).toBe('D12');
  });

  it('leaves a row flying a different configuration alone', () => {
    st().addConfig();
    const own = st().selectedConfigId!;
    st().setSimConfig(byName('B').id, own);
    st().setMountMotor(own, mountId(), { ...C6, designation: 'D12' });
    expect(motorOf('B').designation).toBe('D12');
    expect(motorOf('A').designation).toBe(C6.designation);
  });

  it('carries ignition with the motor, for the same rows', () => {
    st().setSimsSelected([byName('A').id, byName('B').id]);
    st().setMountIgnition(configIdOf('A'), mountId(), 'burnout', 2);
    expect(ignitionOf('A')).toBe('burnout');
    expect(ignitionOf('B')).toBe('burnout');
  });

  it('ages every row flown on the configuration that changed', () => {
    st().setSimsSelected([byName('A').id]);
    st().setMountMotor(configIdOf('A'), mountId(), { ...C6, designation: 'E9' });
    expect(isStale(byName('A'))).toBe(true);
    expect(isStale(byName('B'))).toBe(true);
  });

  it('merges run-option overrides per row', () => {
    st().setSimsSelected([byName('A').id, byName('B').id]);
    st().setSimPref('timeStep', 0.01);
    expect(byName('A').prefs?.timeStep).toBe(0.01);
    expect(byName('B').prefs?.timeStep).toBe(0.01);
    expect(byName('C').prefs?.timeStep).toBeUndefined();

    // A second key must not drop the first on either row.
    st().setSimPref('maxTime', 300);
    expect(byName('A').prefs).toEqual({ timeStep: 0.01, maxTime: 300 });
    expect(byName('B').prefs).toEqual({ timeStep: 0.01, maxTime: 300 });
  });

  it('clears overrides across the selection, and is a no-op when there are none', () => {
    st().setSimsSelected([byName('A').id, byName('B').id]);
    st().setSimPref('timeStep', 0.01);
    st().clearSimPrefs();
    expect(byName('A').prefs).toBeUndefined();
    expect(byName('B').prefs).toBeUndefined();

    const before = st().sims;
    st().clearSimPrefs();
    expect(st().sims).toBe(before); // nothing to clear, so nothing changed
  });

  it('undoes a bulk edit in one step', () => {
    st().setSimsSelected([byName('A').id, byName('B').id, byName('C').id]);
    st().patchLaunch({ windAverage: 42 });
    st().commitEdit();
    st().undo();
    expect([byName('A'), byName('B'), byName('C')].map((x) => x.launch.windAverage)).toEqual([1, 2, 3]);
  });
});
