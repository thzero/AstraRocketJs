import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore, selectActive, hasThrustCurve } from './store';
import { C6 } from '../engine/api';
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
    expect(len('nose')).toBe(before);       // jumps straight back to the pre-edit value
    expect(s().past).toHaveLength(0);
    expect(s().future).toHaveLength(1);
  });

  it('restores the prior selection on undo', () => {
    s().setSelectedId('body');
    s().patchSelected({ length: 0.9 });
    s().commitEdit();
    s().setSelectedId('nose'); // selection moves after the edit
    s().undo();
    expect(s().selectedId).toBe('body');    // undo re-focuses the edited part
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
    expect(s().selectedId).toBe('fins');            // and reselected
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

describe('simulation undo/redo', () => {
  beforeEach(() => { s().resetWorkspace(); });

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
    s().addSim();               // one entry
    const firstId = s().sims[0].id;
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
    expect(s().past[0].sims.every((x) => x.result === null)).toBe(true);
  });

  it('shares one timeline with tree edits', () => {
    s().setSelectedId('nose');
    s().patchSelected({ length: 0.3 });
    s().commitEdit();                       // entry 1: tree edit
    s().setActiveMotor({ ...C6, designation: 'Q1' }); // entry 2: sim edit
    expect(s().past).toHaveLength(2);
    s().undo();                              // reverts the motor
    expect(active().motor.designation).not.toBe('Q1');
    s().undo();                              // reverts the tree edit
    expect(findNode(s().tree, 'nose')!.length).not.toBe(0.3);
  });
});

describe('mount ↔ motor reconciliation', () => {
  beforeEach(() => { s().resetWorkspace(); }); // default design: one mount ('mount'), no extras

  it('seeds a default motor when a second mount is added', () => {
    expect(Object.keys(s().extraMotors)).toHaveLength(0);
    s().setSelectedId('body');
    s().addPartToTree('innertube'); // default innertube is a motor mount
    const ids = Object.keys(s().extraMotors);
    expect(ids).toHaveLength(1);
    expect(s().extraMotors[ids[0]].spec.designation).toBe('C6'); // new mount is loaded
  });

  it('drops the extra-motor entry when its mount is removed', () => {
    s().setSelectedId('body');
    s().addPartToTree('innertube');
    const addedId = s().selectedId!;
    expect(s().extraMotors[addedId]).toBeDefined();
    s().removeSelected();
    expect(s().extraMotors[addedId]).toBeUndefined(); // no stale entry left behind
    expect(Object.keys(s().extraMotors)).toHaveLength(0);
  });

  it('undo restores the mounts and their motors together', () => {
    s().setSelectedId('body');
    s().addPartToTree('innertube');
    const addedId = s().selectedId!;
    s().undo();
    expect(findNode(s().tree, addedId)).toBeNull();          // mount gone
    expect(s().extraMotors[addedId]).toBeUndefined();         // and its seeded motor
  });
});

describe('simulation run guards', () => {
  beforeEach(() => { s().resetWorkspace(); });

  it('hasThrustCurve distinguishes a real motor from an empty one', () => {
    expect(hasThrustCurve(C6)).toBe(true);
    expect(hasThrustCurve(null)).toBe(false);
    expect(hasThrustCurve({ ...C6, thrusts: [] })).toBe(false);
  });

  it('refuses to run with no motor mount and reports why', async () => {
    s().setSelectedId('mount');
    s().removeSelected();
    expect(findMounts(s().tree)).toHaveLength(0);
    await s().runSim({} as SimPrefs);
    expect(s().err).toBeTruthy();     // a reason was surfaced
    expect(s().simBusy).toBe(false);  // never entered the running state
    expect(active().result).toBeNull();
  });
});
