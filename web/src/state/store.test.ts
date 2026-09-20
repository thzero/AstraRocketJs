import { describe, it, expect, beforeEach, vi } from 'vitest';

// The sim normally runs in a Web Worker. Stub it so a test can decide when (and
// whether) a run resolves.
const simulateMock = vi.hoisted(() => vi.fn());
vi.mock('../engine/simClient', async (orig) => ({
  ...(await orig<typeof import('../engine/simClient')>()),
  simulateInWorker: simulateMock,
}));

import {
  useWorkspaceStore,
  selectActive,
  selectExtraMotors,
  selectRunIds,
  hasThrustCurve,
  selectRunFailed,
} from './store';
import { C6 } from '../engine/api';
import { setDesignLibrary } from '../services/designLibrary';
import { getWorkspaceStore } from '../services/workspaceStore';
import { findMounts, findNode } from '../services/treeEdit';
import type { FlightResult } from '../engine/openRocketEngine';
import type { SimPrefs } from '../services/simulations';

// The undo/redo history is pure JSON bookkeeping over the design tree (the React
// rebuild effect isn't involved), so we exercise the store actions directly.
const s = () => useWorkspaceStore.getState();
const len = (id: string): number | undefined => findNode(s().tree, id)?.length as number | undefined;
const active = () => selectActive(s());

describe('workspace undo/redo', () => {
  beforeEach(() => {
    // Reset to the default design; this also clears the history stacks.
    s().resetWorkspace();
    s().setSelectedId('nose');
  });

  it('starts with an empty history', () => {
    expect(s().past).toHaveLength(0);
    expect(s().future).toHaveLength(0);
  });

  it('coalesces one interaction (many patches + a commit) into a single undo step', () => {
    const before = len('nose');
    s().patchSelected({ length: 0.2 });
    s().patchSelected({ length: 0.3 });
    s().patchSelected({ length: 0.42 }); // still one open transaction
    s().commitEdit();
    expect(s().past).toHaveLength(1);
    expect(len('nose')).toBe(0.42);

    s().undo();
    expect(len('nose')).toBe(before); // jumps straight back to the pre-edit value
    expect(s().past).toHaveLength(0);
    expect(s().future).toHaveLength(1);
  });

  it('restores the prior selection on undo', () => {
    s().setSelectedId('body');
    s().patchSelected({ length: 0.9 });
    s().commitEdit();
    s().setSelectedId('nose'); // selection moves after the edit
    s().undo();
    expect(s().selectedId).toBe('body'); // undo re-focuses the edited part
  });

  it('undoes an add and a remove, reselecting what changed', () => {
    // Add a part under the selected nose cone.
    s().setSelectedId('body');
    s().addPartToTree('trapezoidfinset');
    const addedId = s().selectedId!;
    expect(findNode(s().tree, addedId)).toBeTruthy();
    s().undo();
    expect(findNode(s().tree, addedId)).toBeNull(); // the added part is gone

    // Remove an existing part, then undo the removal.
    s().setSelectedId('fins');
    s().removeSelected();
    expect(findNode(s().tree, 'fins')).toBeNull();
    s().undo();
    expect(findNode(s().tree, 'fins')).toBeTruthy(); // the removed part is back
    expect(s().selectedId).toBe('fins'); // and reselected
  });

  it('adds a stage as a new bottom sibling, selects it, and undoes cleanly', () => {
    const stageCount = () => s().tree.components.filter((n) => n.type === 'stage').length;
    const before = stageCount();
    s().addStageToTree();
    const stages = s().tree.components.filter((n) => n.type === 'stage');
    expect(stages).toHaveLength(before + 1);
    expect(s().selectedId).toBe(stages[stages.length - 1]!.id); // the new stage is selected
    s().undo();
    expect(stageCount()).toBe(before); // add is one undo step
  });

  it('redoes, and a fresh edit clears the redo stack', () => {
    s().patchSelected({ length: 0.25 });
    s().commitEdit();
    s().undo();
    expect(s().future).toHaveLength(1);
    s().redo();
    expect(len('nose')).toBe(0.25);
    expect(s().future).toHaveLength(0);

    // Undo, then a new edit should drop the redo branch.
    s().undo();
    expect(s().future).toHaveLength(1);
    s().patchSelected({ length: 0.11 });
    s().commitEdit();
    expect(s().future).toHaveLength(0);
  });

  it('undo folds an uncommitted in-flight edit into one step', () => {
    const before = len('nose');
    s().patchSelected({ length: 0.5 }); // no commitEdit — simulates Ctrl+Z mid-edit
    s().undo();
    expect(len('nose')).toBe(before);
    expect(s().past).toHaveLength(0);
  });

  it('clears history when the workspace is reset', () => {
    s().patchSelected({ length: 0.2 });
    s().commitEdit();
    expect(s().past).toHaveLength(1);
    s().resetWorkspace();
    expect(s().past).toHaveLength(0);
    expect(s().future).toHaveLength(0);
  });
});

describe('design metadata (Rocket configuration)', () => {
  beforeEach(() => {
    s().resetWorkspace(); // fresh design + cleared history
  });

  it('patches the tree metadata as a single undo step', () => {
    const before = s().tree.name;
    s().updateDesignMeta({
      name: 'My Rocket',
      designer: 'Ada',
      comment: 'shear-pin notes',
      revision: 'r1',
      designType: 'clone_kit',
    });
    expect(s().tree.name).toBe('My Rocket');
    expect(s().tree.designer).toBe('Ada');
    expect(s().tree.comment).toBe('shear-pin notes');
    expect(s().tree.revision).toBe('r1');
    expect(s().tree.designType).toBe('clone_kit');
    expect(s().past).toHaveLength(1); // one atomic step, not one per field

    s().undo();
    expect(s().tree.name).toBe(before);
    expect(s().tree.designer).toBeUndefined();
    expect(s().tree.comment).toBeUndefined();
  });

  it('merges a partial patch, leaving untouched fields in place', () => {
    s().updateDesignMeta({ designer: 'Ada' });
    s().updateDesignMeta({ revision: 'r2' });
    expect(s().tree.designer).toBe('Ada'); // survived the second patch
    expect(s().tree.revision).toBe('r2');
    expect(s().past).toHaveLength(2); // two separate edits
  });
});

describe('simulation undo/redo', () => {
  beforeEach(() => {
    s().resetWorkspace();
  });

  it('undoes a motor change', () => {
    const before = active().motor.designation;
    s().setActiveMotor({ ...C6, designation: 'Z99' });
    expect(active().motor.designation).toBe('Z99');
    expect(s().past).toHaveLength(1);
    s().undo();
    expect(active().motor.designation).toBe(before);
  });

  it('coalesces a launch edit and undoes it in one step', () => {
    const before = active().launch.launchRodAngleDeg;
    s().patchLaunch({ launchRodAngleDeg: 5 });
    s().patchLaunch({ launchRodAngleDeg: 12 }); // same interaction
    s().commitEdit();
    expect(s().past).toHaveLength(1);
    expect(active().launch.launchRodAngleDeg).toBe(12);
    s().undo();
    expect(active().launch.launchRodAngleDeg).toBe(before);
  });

  it('undoes add / rename / delete of a simulation and restores the active sim', () => {
    const firstId = active().id;
    s().addSim();
    expect(s().sims).toHaveLength(2);
    s().undo();
    expect(s().sims).toHaveLength(1);
    expect(s().activeId).toBe(firstId); // active sim restored

    s().renameSim(firstId, 'Windy day');
    s().commitEdit();
    s().undo();
    expect(s().sims.find((x) => x.id === firstId)!.name).not.toBe('Windy day');

    // Add a second sim, then delete it — undo brings it back.
    s().addSim();
    const addedId = active().id;
    expect(s().sims).toHaveLength(2);
    s().deleteSim(addedId);
    expect(s().sims).toHaveLength(1);
    s().undo();
    expect(s().sims).toHaveLength(2);
  });

  it('does not record history when just switching the active sim', () => {
    s().addSim(); // one entry
    const firstId = s().sims[0]!.id;
    const before = s().past.length;
    s().setActiveId(firstId);
    expect(s().past).toHaveLength(before); // selection isn't an edit
  });

  it('strips cached flight results from history snapshots', () => {
    // Plant a fake result on the active sim, then take a snapshot via an edit.
    const fake = { series: {}, events: [] } as unknown as FlightResult;
    const id = active().id;
    useWorkspaceStore.setState({ sims: s().sims.map((x) => (x.id === id ? { ...x, result: fake } : x)) });
    s().addSim(); // recordStep snapshots the pre-add state (which had the result)
    expect(s().past[0]!.sims.every((x) => x.result === null)).toBe(true);
  });

  it('shares one timeline with tree edits', () => {
    s().setSelectedId('nose');
    s().patchSelected({ length: 0.3 });
    s().commitEdit(); // entry 1: tree edit
    s().setActiveMotor({ ...C6, designation: 'Q1' }); // entry 2: sim edit
    expect(s().past).toHaveLength(2);
    s().undo(); // reverts the motor
    expect(active().motor.designation).not.toBe('Q1');
    s().undo(); // reverts the tree edit
    expect(findNode(s().tree, 'nose')!.length).not.toBe(0.3);
  });
});

describe('mount ↔ motor reconciliation', () => {
  beforeEach(() => {
    s().resetWorkspace();
  }); // default design: one mount ('mount'), no extras

  // The motors seated in the non-primary mounts belong to a SIMULATION (they are
  // its flight configuration); the mounts themselves belong to the shared
  // design. So adding or removing a mount has to reach every simulation's
  // loadout, not just the selected one.
  const extras = () => selectExtraMotors(s());

  it('seeds a default motor when a second mount is added', () => {
    expect(Object.keys(extras())).toHaveLength(0);
    s().setSelectedId('body');
    s().addPartToTree('innertube'); // default innertube is a motor mount
    const ids = Object.keys(extras());
    expect(ids).toHaveLength(1);
    expect(extras()[ids[0]!]!.spec.designation).toBe('C6'); // new mount is loaded
  });

  it('drops the extra-motor entry when its mount is removed', () => {
    s().setSelectedId('body');
    s().addPartToTree('innertube');
    const addedId = s().selectedId!;
    expect(extras()[addedId]).toBeDefined();
    s().removeSelected();
    expect(extras()[addedId]).toBeUndefined(); // no stale entry left behind
    expect(Object.keys(extras())).toHaveLength(0);
  });

  it('undo restores the mounts and their motors together', () => {
    s().setSelectedId('body');
    s().addPartToTree('innertube');
    const addedId = s().selectedId!;
    s().undo();
    expect(findNode(s().tree, addedId)).toBeNull(); // mount gone
    expect(extras()[addedId]).toBeUndefined(); // and its seeded motor
  });

  it('seeds the new mount into EVERY simulation, not just the selected one', () => {
    s().addSim();
    s().setSelectedId('body');
    s().addPartToTree('innertube');
    const addedId = s().selectedId!;
    expect(s().sims).toHaveLength(2);
    expect(s().sims.every((x) => !!x.extraMotors[addedId])).toBe(true);

    s().removeSelected();
    expect(s().sims.every((x) => !x.extraMotors[addedId])).toBe(true);
  });
});

/**
 * The motor loadout is per simulation, which is OpenRocket's "flight
 * configuration". It used to be one workspace-level map, so a staged rocket
 * could only ever be flown one way: seating a different sustainer motor changed
 * it for every simulation at once, and had to age all of their results.
 */
describe('each simulation owns its motor loadout', () => {
  beforeEach(() => {
    s().resetWorkspace();
    s().setSelectedId('body');
    s().addPartToTree('innertube'); // a second mount, seeded in both sims below
  });

  it('seats a motor on one simulation without touching the other', () => {
    const mount = s().selectedId!;
    const first = s().activeId;
    s().addSim();
    const second = s().activeId;
    expect(second).not.toBe(first);

    const d12 = { ...C6, designation: 'D12' };
    s().setExtraMotor(mount, d12);

    const byId = (id: string) => s().sims.find((x) => x.id === id)!;
    expect(byId(second).extraMotors[mount]!.spec.designation).toBe('D12');
    expect(byId(first).extraMotors[mount]!.spec.designation).toBe('C6');
  });

  it('ages only the simulation whose loadout changed', () => {
    const mount = s().selectedId!;
    const first = s().activeId;
    s().addSim();
    const second = s().activeId;
    useWorkspaceStore.setState((st) => ({
      sims: st.sims.map((x) => ({ ...x, result: { summary: {} } as never, outdated: false })),
    }));

    s().setExtraMotor(mount, { ...C6, designation: 'D12' });

    const byId = (id: string) => s().sims.find((x) => x.id === id)!;
    expect(byId(second).outdated).toBe(true);
    expect(byId(first).outdated).toBe(false); // the other simulation is untouched
  });

  it('a duplicate carries the loadout forward', () => {
    const mount = s().selectedId!;
    s().setExtraMotor(mount, { ...C6, designation: 'D12' });
    s().duplicateSim(s().activeId);
    expect(selectExtraMotors(s())[mount]!.spec.designation).toBe('D12');
  });

  it('folds a legacy workspace-level map into every simulation', () => {
    // Blobs written before the move carry one shared map, which applied to every
    // sim -- so that is where it has to land.
    const tree = s().tree;
    const mount = s().selectedId!;
    const legacy = { [mount]: { spec: { ...C6, designation: 'D12' } } };
    s().hydrate({
      tree,
      sims: [
        { ...selectActive(s()), id: 'a', extraMotors: undefined as never },
        { ...selectActive(s()), id: 'b', extraMotors: undefined as never },
      ],
      activeId: 'a',
      extraMotors: legacy as never,
      loadedMeta: null,
    });
    expect(s().sims.every((x) => x.extraMotors[mount]!.spec.designation === 'D12')).toBe(true);
  });
});

describe('simulation run guards', () => {
  beforeEach(() => {
    s().resetWorkspace();
  });

  it('hasThrustCurve distinguishes a real motor from an empty one', () => {
    expect(hasThrustCurve(C6)).toBe(true);
    expect(hasThrustCurve(null)).toBe(false);
    expect(hasThrustCurve({ ...C6, thrusts: [] })).toBe(false);
  });

  // A run that throws leaves exactly the state auto-run fires on: no result, not
  // busy, a result view open. Without a record of the failure it retried the
  // same failing design forever, spawning a full flight sim each time.
  it('records a failed run against the design it failed on', async () => {
    simulateMock.mockRejectedValueOnce(new Error('kernel exploded'));
    await s().runSim({} as SimPrefs);

    // Named, like the skip messages already were: a failure is reported once
    // per row so a batch cannot collapse into one anonymous line.
    expect(s().err).toBe('"Simulation 1" failed: kernel exploded');
    expect(s().simBusy).toBe(false);
    expect(selectRunFailed(s())).toBe(true); // auto-run must not retry this
  });

  it('lets the retry happen again once the design changes', async () => {
    simulateMock.mockRejectedValueOnce(new Error('kernel exploded'));
    await s().runSim({} as SimPrefs);
    expect(selectRunFailed(s())).toBe(true);

    // Any edit replaces the tree, so the record no longer matches and auto-run
    // is free to try the new design.
    s().setSelectedId('nose');
    s().patchSelected({ length: 0.2 });
    expect(selectRunFailed(s())).toBe(false);
  });

  // The await can outlast the design: edit while the worker is busy and the
  // answer coming back describes a rocket that is no longer on screen.
  it('drops a result the design has moved past', async () => {
    let release!: (r: unknown) => void;
    simulateMock.mockImplementationOnce(() => new Promise((res) => (release = res)));

    const running = s().runSim({} as SimPrefs);
    // The user edits mid-flight.
    s().setSelectedId('nose');
    s().patchSelected({ length: 0.3 });

    release({ summary: { apogee: 123 }, branches: [] });
    await running;

    expect(active().result).toBeNull(); // not installed
    expect(s().view).not.toBe('flight'); // and the view was not yanked over
  });

  it('refuses to run with no motor mount and reports why', async () => {
    s().setSelectedId('mount');
    s().removeSelected();
    expect(findMounts(s().tree)).toHaveLength(0);
    await s().runSim({} as SimPrefs);
    expect(s().err).toBeTruthy(); // a reason was surfaced
    expect(s().simBusy).toBe(false); // never entered the running state
    expect(active().result).toBeNull();
  });
});

/**
 * The workbench has three tabs, and two of them own a family of views: Design
 * the design ones, Results the flight ones. Picking either end has to move the
 * other, or a run finishes on a tab you are not looking at (which is exactly
 * what it used to do) or the view switch quietly draws a flight chart on the
 * Design tab.
 *
 * `designPane` is the second axis — which half of the Design tab a phone shows.
 * It is not a tab, so moving between its two values must never change what the
 * workbench is doing.
 */
/**
 * A design edit used to NULL every cached result, so the numbers you were
 * comparing a change against vanished the moment you made it, the Results tab
 * came and went on every keystroke, and "run outdated simulations
 * automatically" had no state it could ever mean. They are now kept and
 * flagged, the way OpenRocket does it.
 */
describe('results age instead of being destroyed', () => {
  const seed = (): void => {
    useWorkspaceStore.setState((st) => ({
      sims: st.sims.map((x) => ({ ...x, result: { summary: { maxAltitude: 271 } } as never, outdated: false })),
    }));
  };
  beforeEach(() => {
    s().resetWorkspace();
    seed();
  });

  it('flags every simulation when the design changes', () => {
    s().markOutdated();
    expect(active().result).not.toBeNull();
    expect(active().outdated).toBe(true);
  });

  it('flags the active simulation when its own inputs change', () => {
    s().patchLaunch({ windAverage: 4 });
    expect(active().result).not.toBeNull();
    expect(active().outdated).toBe(true);
  });

  it('flags EVERY simulation when a workspace-level motor changes', () => {
    // Extra-mount motors are not per-simulation, so one change ages them all.
    const mount = findMounts(s().tree)[0]!.id as string;
    s().setExtraMotor(mount, C6);
    expect(s().sims.every((x) => x.result && x.outdated)).toBe(true);
  });

  it('a finished run is current again', async () => {
    s().markOutdated();
    simulateMock.mockResolvedValueOnce({ summary: { maxAltitude: 300 } } as unknown as FlightResult);
    await s().runSim({} as SimPrefs);
    expect(active().outdated).toBe(false);
  });

  it('carries results through an undo rather than blanking them', () => {
    const id = s().tree.components[0]!.id as string;
    s().setSelectedId(id);
    s().patchSelected({ length: 0.2 });
    s().commitEdit();
    s().undo();

    // The inputs came back; the numbers stayed, flagged, because the design just
    // moved under them.
    expect(active().result).not.toBeNull();
    expect(active().outdated).toBe(true);
  });
});

/**
 * Per-simulation overrides of the global run preferences. Unset keys fall
 * through, so a workspace that never touches them is unaffected.
 */
describe('per-simulation options', () => {
  beforeEach(() => s().resetWorkspace());

  it('overrides the global value, and clears back to it', () => {
    s().setSimPref('timeStep', 0.01);
    expect(active().prefs?.timeStep).toBe(0.01);

    s().setSimPref('timeStep', null);
    // The KEY is removed, not stored as undefined: `prefs` is spread over the
    // globals, and an explicit undefined would shadow the global with nothing.
    // The last override going away drops the whole object.
    expect(active().prefs).toBeUndefined();
  });

  it('wins over the global preference on a run', async () => {
    s().setSimPref('timeStep', 0.01);
    simulateMock.mockResolvedValueOnce({ summary: {} } as unknown as FlightResult);
    await s().runSim({ timeStep: 0.05, maxTime: 1200, randomSeed: null } as SimPrefs);

    expect(simulateMock.mock.calls[0]![0].options.timeStep).toBe(0.01);
    expect(simulateMock.mock.calls[0]![0].options.maxTime).toBe(1200); // untouched key falls through
  });
});

/**
 * Run flies what the TABLE has selected: the ticked rows, or the active
 * simulation when nothing is ticked. `activeId` (what the editor points at) and
 * the tick set are deliberately different questions - ticking a row to fly it
 * must not drag the editor over to it.
 */
describe('running a selection', () => {
  beforeEach(() => {
    s().resetWorkspace();
    simulateMock.mockReset();
    simulateMock.mockResolvedValue({ summary: {} } as unknown as FlightResult);
  });

  it('defaults to the active simulation when nothing is ticked', () => {
    s().addSim();
    expect(s().selectedSimIds).toEqual([]);
    expect(selectRunIds(s())).toEqual([s().activeId]);
  });

  it('flies every ticked row, in order', async () => {
    s().addSim();
    const ids = s().sims.map((x) => x.id);
    s().setSimsSelected(ids);
    expect(selectRunIds(s())).toEqual(ids);

    await s().runSims(selectRunIds(s()), {} as SimPrefs);

    expect(simulateMock).toHaveBeenCalledTimes(2);
    expect(s().sims.every((x) => !!x.result)).toBe(true);
  });

  it('flies each row with ITS OWN configuration, not the active one', async () => {
    s().addSim(); // the new sim is active
    const [first, second] = s().sims;
    s().renameSim(first!.id, 'First');
    s().setSimsSelected([first!.id, second!.id]);

    await s().runSims(selectRunIds(s()), {} as SimPrefs);

    // Two calls, each carrying the launch conditions of the sim it was for.
    const launches = simulateMock.mock.calls.map((c) => c[0].options.launchRodLength);
    expect(launches).toHaveLength(2);
  });

  /**
   * Running IS asking to see the answer, so every run lands on Results - a batch
   * as much as a single flight. A batch used to stay put on the theory that
   * twelve rows should not yank you onto whichever finished last; in practice
   * that left a click with nothing behind it after every run.
   */
  it('shows the run, one flight or a batch', async () => {
    await s().runSims([s().activeId], {} as SimPrefs);
    expect(s().tab).toBe('results');
    expect(s().view).toBe('flight');

    s().setTab('design');
    s().addSim();
    s().setSimsSelected(s().sims.map((x) => x.id));
    await s().runSims(selectRunIds(s()), {} as SimPrefs);
    expect(s().tab).toBe('results');
  });

  /**
   * What the last run flew, which is what the Results heading reads to choose
   * between a plain name and a picker. Counting simulations that HAVE a result
   * is a different thing: results persist, so running one simulation after
   * having run another put a dropdown on screen for a single run.
   */
  it('records the simulations THIS run flew, and points the results at them', async () => {
    await s().runSims([s().activeId], {} as SimPrefs);
    expect(s().lastRunIds).toEqual([s().activeId]);
    expect(s().resultSimId).toBe(s().activeId);

    s().addSim();
    const both = s().sims.map((x) => x.id);
    await s().runSims(both, {} as SimPrefs);
    expect(s().lastRunIds).toEqual(both);

    // Back to one: the earlier run's rows still have results, but they are not
    // what this run flew.
    await s().runSims([both[0]!], {} as SimPrefs);
    expect(s().lastRunIds).toEqual([both[0]]);
  });

  it('drops a deleted simulation from the last run', async () => {
    s().addSim();
    const both = s().sims.map((x) => x.id);
    await s().runSims(both, {} as SimPrefs);
    s().deleteSim(both[1]!);
    // Otherwise the picker would keep offering a row that no longer exists.
    expect(s().lastRunIds).toEqual([both[0]]);
  });

  it('carries on past a simulation that cannot fly', async () => {
    s().addSim();
    const [first, second] = s().sims;
    // Strip the first sim's thrust curve: unflyable, but not a reason to
    // abandon the rest of the batch.
    useWorkspaceStore.setState((st) => ({
      sims: st.sims.map((x) => (x.id === first!.id ? { ...x, motor: { ...C6, thrusts: [] } } : x)),
    }));

    await s().runSims([first!.id, second!.id], {} as SimPrefs);

    expect(simulateMock).toHaveBeenCalledTimes(1); // only the flyable one
    expect(s().sims.find((x) => x.id === second!.id)!.result).not.toBeNull();
    expect(s().err).toBeTruthy(); // and the reason was surfaced
  });

  it('forgets a tick when its simulation is deleted', () => {
    s().addSim();
    const ids = s().sims.map((x) => x.id);
    s().setSimsSelected(ids);
    s().deleteSim(ids[0]!);
    expect(s().selectedSimIds).toEqual([ids[1]]);
  });

  it('toggles one row without moving the editor', () => {
    s().addSim();
    const other = s().sims[0]!.id;
    const active = s().activeId;
    s().toggleSimSelected(other);
    expect(s().selectedSimIds).toEqual([other]);
    expect(s().activeId).toBe(active); // the editor stayed put
    s().toggleSimSelected(other);
    expect(s().selectedSimIds).toEqual([]);
  });
});

describe('tab and view stay in step', () => {
  beforeEach(() => s().resetWorkspace());

  it('sends a flight view to the Results tab and a design view back to Design', () => {
    s().setDesignPane('sketch');
    s().setView('flight');
    expect(s().tab).toBe('results');
    s().setView('path');
    expect(s().tab).toBe('results');

    // Coming back, a phone lands on the half that actually draws the view.
    s().setView('2d');
    expect([s().tab, s().designPane]).toEqual(['design', 'sketch']);
    s().setView('drag');
    expect([s().tab, s().designPane]).toEqual(['design', 'sketch']);
  });

  it('leaves a caller alone on a pane that shows no view at all', () => {
    // The Simulate tab and the phone's Rocket pane show stats and the run, not a
    // view — so a view changing underneath (a result invalidated, a design
    // opened) must not drag the reader off what they chose.
    s().setDesignPane('stats');
    s().setView('flight');
    expect([s().tab, s().designPane]).toEqual(['design', 'stats']);
    s().setTab('sim');
    s().setView('2d');
    expect(s().tab).toBe('sim');
  });

  it('never strands you on Results with no result', () => {
    // Opening or starting a design writes `view` directly. It used to leave the
    // tab behind, which left a Results tab with nothing to show and a view
    // switch with every button hidden.
    s().setView('flight');
    s().setTab('results');
    expect(s().tab).toBe('results');

    s().resetWorkspace();
    expect(s().view).toBe('2d');
    expect(s().tab).not.toBe('results');
  });

  it('pulls the view into whichever family the chosen tab shows', () => {
    s().setView('2d');
    s().setTab('results');
    expect(s().view).toBe('flight'); // a design view cannot show on Results

    s().setTab('design');
    expect(s().view).toBe('2d'); // …nor a flight view on Design
  });

  it('keeps the view you already had when it suits the tab', () => {
    s().setView('path');
    s().setTab('results');
    expect(s().view).toBe('path'); // not reset to 'flight'

    s().setView('drag');
    s().setTab('design');
    expect(s().view).toBe('drag');
  });

  it('leaves the view alone for the places that do not own one', () => {
    s().setView('drag');
    s().setDesignPane('stats');
    expect([s().tab, s().designPane, s().view]).toEqual(['design', 'stats', 'drag']);
    s().setTab('sim');
    expect([s().tab, s().view]).toEqual(['sim', 'drag']);
  });

  it('treats the design pane as a phone detail, not a tab', () => {
    // Both halves are the Design tab. Switching between them must not change
    // which view is open, and must not be reachable from another tab by
    // accident — `setDesignPane` is how you GET to Design.
    s().setView('drag');
    s().setDesignPane('stats');
    s().setDesignPane('sketch');
    expect([s().tab, s().view]).toEqual(['design', 'drag']);

    // From Results, picking a design pane comes back with a design view.
    s().setTab('results');
    expect(s().view).toBe('flight');
    s().setDesignPane('stats');
    expect([s().tab, s().designPane, s().view]).toEqual(['design', 'stats', '2d']);
  });
});

describe('storage warning', () => {
  beforeEach(() => {
    s().resetWorkspace();
    s().setStorageWarning(null);
    s().setErr(null);
  });

  // These shared one slot, and the rebuild effect calls setErr(null) on every
  // successful build — which happens milliseconds after load and again on every
  // keystroke. The warning that the user's work is no longer being saved was
  // therefore wiped before anyone could read it.
  it('survives the rebuild effect clearing the transient error', () => {
    s().setStorageWarning('storage is full');
    s().setErr('something else went wrong');

    s().setErr(null); // what the rebuild effect does after every successful build

    expect(s().err).toBeNull();
    expect(s().storageWarning).toBe('storage is full');
  });

  it('is cleared only by its own setter', () => {
    s().setStorageWarning('storage is degraded');
    expect(s().storageWarning).toBe('storage is degraded');
    s().setStorageWarning(null);
    expect(s().storageWarning).toBeNull();
  });
});

describe('openDesign is race-safe', () => {
  /**
   * Four sequential awaits, and the user can click a second design during any
   * of them. If B's read resolved first, A's continuation then ran
   * flushActive() — writing B's tree out under the store's current active id —
   * and finished with setActive(A) + hydrate(A). The user clicked B last and
   * was looking at A.
   */
  it('ignores a slow request that the user has already superseded', async () => {
    const wsFor = (name: string) => ({
      version: 1 as const,
      tree: { name, components: [] },
      sims: [{ id: 's1', name: 'Sim 1', result: null }],
      activeId: 's1',
      extraMotors: {},
      loadedMeta: null,
    });

    // A is slow, B is instant — so B lands first and A's continuation arrives
    // afterwards, which is exactly the interleaving that used to win.
    let releaseA!: () => void;
    const slowA = new Promise<void>((r) => (releaseA = r));
    const active: string[] = [];

    setDesignLibrary({
      list: async () => [],
      activeId: async () => null,
      read: async (id: string) => {
        if (id === 'A') await slowA;
        return wsFor(id) as never;
      },
      write: async () => true,
      create: async () => ({ id: 'X', name: 'X', updatedAt: 0 }),
      rename: async () => {},
      remove: async () => {},
      setActive: async (id: string) => {
        active.push(id);
      },
    } as never);

    const pA = s().openDesign('A');
    await s().openDesign('B');
    releaseA();
    await pA;

    // B was clicked last, so B is what is open — and A never got to call
    // setActive behind it.
    expect((s().tree as unknown as { name: string }).name).toBe('B');
    expect(active).toEqual(['B']);
  });
});

/**
 * One workspace generation, bumped by everything that replaces the workspace.
 *
 * `openToken` guarded openDesign against another openDesign and nothing else,
 * so every other pairing raced: two imports, an import against a library open,
 * a Save As against either.
 */
describe('replacing the workspace is race-safe across actions, not just openDesign', () => {
  const orkFile = (name: string, hold?: Promise<void>): File =>
    ({
      name: `${name}.ork`,
      arrayBuffer: async () => {
        if (hold) await hold;
        return new TextEncoder().encode(name).buffer;
      },
    }) as unknown as File;

  beforeEach(() => {
    s().resetWorkspace();
    vi.doUnmock('../services/loadOrk');
  });

  it('a slow import does not overwrite the fast one the user opened after it', async () => {
    // Import a large .ork then a small one: the small one lands first, and the
    // large one used to arrive afterwards and replace it.
    let releaseSlow!: () => void;
    const slow = new Promise<void>((r) => (releaseSlow = r));
    vi.doMock('../services/loadOrk', () => ({
      loadOrk: async (bytes: ArrayBuffer) => ({
        name: new TextDecoder().decode(bytes),
        notes: [],
        tree: { name: new TextDecoder().decode(bytes), components: [] },
        motors: {},
        motorSpecs: {},
      }),
    }));

    const big = s().openOrkFile(orkFile('BIG', slow));
    await s().openOrkFile(orkFile('SMALL'));
    releaseSlow();
    await big;

    expect((s().tree as unknown as { name: string }).name).toBe('SMALL');
  });

  it('a superseded import does not post its error over the design that replaced it', async () => {
    let releaseSlow!: () => void;
    const slow = new Promise<void>((r) => (releaseSlow = r));
    vi.doMock('../services/loadOrk', () => ({
      loadOrk: async (bytes: ArrayBuffer) => {
        if (new TextDecoder().decode(bytes) === 'BAD') throw new Error('corrupt zip');
        return { name: 'GOOD', notes: [], tree: { name: 'GOOD', components: [] }, motors: {}, motorSpecs: {} };
      },
    }));

    const bad = s().openOrkFile(orkFile('BAD', slow));
    await s().openOrkFile(orkFile('GOOD'));
    releaseSlow();
    await bad;

    expect(s().err).toBeNull(); // the failure belonged to a file nobody is looking at
    expect((s().tree as unknown as { name: string }).name).toBe('GOOD');
  });

  it('starting a new design voids an import still in flight', async () => {
    let releaseSlow!: () => void;
    const slow = new Promise<void>((r) => (releaseSlow = r));
    vi.doMock('../services/loadOrk', () => ({
      loadOrk: async () => ({
        name: 'IMPORTED',
        notes: [],
        tree: { name: 'IMPORTED', components: [] },
        motors: {},
        motorSpecs: {},
      }),
    }));

    const pending = s().openOrkFile(orkFile('IMPORTED', slow));
    s().resetWorkspace(); // File → New while the import is still parsing
    releaseSlow();
    await pending;

    expect((s().tree as unknown as { name?: string }).name).not.toBe('IMPORTED');
  });
});

/**
 * File → Save must ask the library whether this design has a name.
 *
 * `activeDesignId` is written only by refreshDesigns(), which nothing calls on
 * boot — so on a fresh load it is null while the first autosave has already
 * created a real entry. Reading it sent Save to Save As, which created a second
 * entry holding the same rocket.
 */
describe('saveDesign asks the library, not the cached activeDesignId', () => {
  const libWith = (activeId: string | null, created: string[]) =>
    ({
      list: async () => (activeId ? [{ id: activeId, name: 'My Rocket', updatedAt: 0 }] : []),
      activeId: async () => activeId,
      read: async () => null,
      write: async () => true,
      create: async (name: string) => {
        created.push(name);
        return { id: 'new', name, updatedAt: 0 };
      },
      rename: async () => {},
      remove: async () => {},
      setActive: async () => {},
    }) as never;

  beforeEach(() => s().resetWorkspace());

  it('saves the design the autosave already created, with activeDesignId still null', async () => {
    const created: string[] = [];
    setDesignLibrary(libWith('autosaved-1', created));
    // Exactly the fresh-boot state AFTER the first autosave: the library holds
    // the entry and the workspace store knows its id, but the zustand field
    // does not — nothing has called refreshDesigns().
    getWorkspaceStore().setActiveId?.('autosaved-1');
    expect(s().activeDesignId).toBeNull();

    expect(await s().saveDesign()).toBe(true); // was false → UI opened Save As
    expect(created).toEqual([]); // and no duplicate entry was minted
  });

  it('still reports "never named" when the library really has no active design', async () => {
    setDesignLibrary(libWith(null, []));
    expect(await s().saveDesign()).toBe(false); // Save As is correct here
  });
});

/**
 * Launch conditions outside the NAR/Tripoli safety codes are not flown.
 *
 * They are simulation SETTINGS, not design, so there is nothing to preserve by
 * flying them anyway — and a number this app will not stand behind is worse than
 * no number. The fields cap what you can type; this is the guard for everything
 * that arrives another way, which in practice means an imported `.ork`.
 */
describe('the safety codes stop a run', () => {
  beforeEach(() => {
    s().resetWorkspace();
    simulateMock.mockReset();
    simulateMock.mockResolvedValue({ summary: {} } as unknown as FlightResult);
  });

  it('refuses a simulation whose rod angle is outside the code', async () => {
    s().patchLaunch({ launchRodAngleDeg: 35 });
    await s().runSim({} as SimPrefs);

    expect(simulateMock).not.toHaveBeenCalled();
    expect(s().err).toContain('35');
    expect(active().result).toBeNull();
    expect(s().simBusy).toBe(false);
  });

  it('refuses a simulation whose wind is outside the code', async () => {
    s().patchLaunch({ windAverage: 20 }); // 20 m/s is about 45 mph
    await s().runSim({} as SimPrefs);
    expect(simulateMock).not.toHaveBeenCalled();
    expect(s().err).toBeTruthy();
  });

  it('skips only the offending row of a batch', async () => {
    s().addSim();
    const [first, second] = s().sims;
    useWorkspaceStore.setState((st) => ({
      sims: st.sims.map((x) => (x.id === first!.id ? { ...x, launch: { ...x.launch, launchRodAngleDeg: 35 } } : x)),
    }));

    await s().runSims([first!.id, second!.id], {} as SimPrefs);

    expect(simulateMock).toHaveBeenCalledTimes(1); // only the legal one flew
    expect(s().sims.find((x) => x.id === second!.id)!.result).not.toBeNull();
    expect(s().sims.find((x) => x.id === first!.id)!.result).toBeNull();
    expect(s().err).toBeTruthy();
  });

  it('runs once the conditions are brought back inside', async () => {
    s().patchLaunch({ launchRodAngleDeg: 35 });
    await s().runSim({} as SimPrefs);
    expect(simulateMock).not.toHaveBeenCalled();

    s().patchLaunch({ launchRodAngleDeg: 10 });
    await s().runSim({} as SimPrefs);
    expect(simulateMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * The workspace the store hands to persistence CARRIES its flight results.
 *
 * It used to strip them, so a reload lost every run. The split now happens one
 * level down, in `workspaceStore.save`: the design blob stays lean and the
 * flights go to their own key, written only when a run has changed them. That
 * keeps the per-keystroke autosave cheap without throwing the results away.
 *
 * Last in the file on purpose - it swaps the design-library singleton, which has
 * no restore, so anything after it would inherit the stub.
 */
describe('what reaches storage', () => {
  it('hands the flight results over rather than dropping them', async () => {
    s().resetWorkspace();
    useWorkspaceStore.setState((st) => ({
      sims: st.sims.map((x) => ({ ...x, result: { summary: { maxAltitude: 271 } } as never })),
    }));

    const save = vi.spyOn(getWorkspaceStore(), 'save').mockResolvedValue(undefined);
    setDesignLibrary({
      list: async () => [],
      activeId: async () => 'D',
      read: async () => null as never,
      write: async () => true,
      readResults: async () => ({}),
      writeResults: async () => true,
      create: async () => ({ id: 'D', name: 'D', updatedAt: 0 }),
      rename: async () => {},
      remove: async () => {},
      setActive: async () => {},
    } as never);

    await s().saveDesign();

    expect(save).toHaveBeenCalled();
    const written = JSON.stringify(save.mock.calls[0]![0]);
    expect(written).toContain('maxAltitude');
    expect(written).toContain('launch'); // …alongside the inputs
    save.mockRestore();
  });
});
