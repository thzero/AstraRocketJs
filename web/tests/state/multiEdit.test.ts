import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore, selectActive } from '../../src/state/store';
import { C6 } from '../../src/engine/api';

const st = () => useWorkspaceStore.getState();
const byName = (n: string) => st().sims.find((x) => x.name === n)!;

/**
 * Editing follows the SELECTION: a tick already means "fly these" and "delete
 * these", and now means "edit these" too. The property that makes it safe is
 * that each mutator merges into the target's OWN state, so only the field the
 * user touched moves.
 */
describe('editing across a selection', () => {
  beforeEach(() => {
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
    // Building the fixtures WAS editing, so every row is flagged stale by now.
    // Clear the flags so "this edit aged these rows" is a real assertion.
    useWorkspaceStore.setState({ sims: st().sims.map((x) => ({ ...x, outdated: false })) });
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
    expect(byName('A').outdated).toBe(true);
    expect(byName('B').outdated).toBe(true);
    expect(byName('C').outdated).toBeFalsy();
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

  it('keeps the MOTOR single-target, because that is what the rows exist to compare', () => {
    // Several simulations exist to fly one airframe on different motors. A bulk
    // motor change collapses exactly that comparison, and leaves every row
    // looking deliberately identical afterwards.
    st().setSimsSelected([byName('A').id, byName('B').id, byName('C').id]);
    const D12 = { ...C6, designation: 'D12' };
    st().setActiveMotor(D12);
    expect(byName('A').motor.designation).toBe('D12'); // the active one
    expect(byName('B').motor.designation).toBe(C6.designation);
    expect(byName('C').motor.designation).toBe(C6.designation);
  });

  it('keeps primary ignition single-target too, since it is part of the loadout', () => {
    st().setSimsSelected([byName('A').id, byName('B').id]);
    st().setActiveIgnition('burnout', 2);
    expect(byName('A').ignitionEvent).toBe('burnout');
    expect(byName('B').ignitionEvent).toBeUndefined();
  });

  it('ages only the row whose motor changed', () => {
    st().setSimsSelected([byName('A').id, byName('B').id]);
    st().setActiveMotor({ ...C6, designation: 'E9' });
    expect(byName('A').outdated).toBe(true);
    expect(byName('B').outdated).toBeFalsy();
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
