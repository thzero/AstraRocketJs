import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/engine/simClient', async (orig) => ({
  ...(await orig<typeof import('../../src/engine/simClient')>()),
  simulateInWorker: vi.fn(),
}));

import { useWorkspaceStore, selectActive, selectConfig, workspaceSnapshot } from '../../src/state/store';
import { findMounts, findNode, findRecoveryDevices, findStages, updateNode } from '../../src/services/design/treeEdit';
import { C6 } from '../../src/engine/api';

const s = () => useWorkspaceStore.getState();

/** Freeze everything an undo entry can share with live state, all the way down. */
function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}
const freezeWorkspace = () => {
  const st = s();
  deepFreeze(st.tree);
  deepFreeze(st.sims);
  deepFreeze(st.configs);
  deepFreeze(st.selectedSimIds);
  deepFreeze(st.lastRunIds);
};

beforeEach(() => s().resetWorkspace());

/**
 * Undo entries hold the state they recorded by reference. That is only sound
 * while no action edits state in place, so this drives every recording action
 * over frozen state: an in-place write throws here (modules are strict) instead
 * of silently rewriting history.
 */
describe('undo history shares state by reference', () => {
  it('restores the very tree an edit replaced', () => {
    const before = s().tree;
    s().setSelectedId('nose');
    s().patchSelected({ length: 0.31 });
    s().commitEdit();
    s().undo();
    expect(s().tree).toBe(before);
  });

  it('keeps configurations, thrust curves included, by reference across undo', () => {
    const configs = s().configs;
    s().addSim();
    s().undo();
    expect(s().configs).toBe(configs);
  });

  it('no action writes into state that history holds', () => {
    const step = (fn: () => void) => {
      freezeWorkspace();
      fn();
    };
    step(() => s().setSelectedId('nose'));
    step(() => s().patchSelected({ length: 0.33 }));
    step(() => s().commitEdit());
    step(() => s().addPartToTree('bodytube'));
    step(() => s().duplicateSelected());
    step(() => s().moveSelected(-1));
    step(() => s().copySelected());
    step(() => s().pasteClipboard());
    step(() => s().cutSelected());
    step(() => s().setSelectedId('nose'));
    step(() => s().scaleDesign(1.1));
    step(() => s().updateDesignMeta({ name: 'Frozen', designer: 'Someone' }));
    const configId = selectConfig(s()).id;
    const mountId = findMounts(s().tree)[0]!.id as string;
    step(() => s().setMountMotor(configId, mountId, C6));
    step(() => s().setMountIgnition(configId, mountId, 'burnout', 1));
    step(() => s().commitEdit());
    const deviceId = findRecoveryDevices(s().tree)[0]?.id as string | undefined;
    if (deviceId) step(() => s().setDeployment(configId, deviceId, 'deployAltitude', 150));
    const stageId = findStages(s().tree)[0]!.id as string;
    step(() => s().setSeparation(configId, stageId, 'separationDelay', 2));
    step(() => s().commitEdit());
    step(() => s().addConfig());
    step(() => s().copyConfig(configId));
    step(() => s().renameConfig(configId, 'Renamed'));
    step(() => s().commitEdit());
    step(() => s().addSim());
    step(() => s().duplicateSim(s().activeId));
    step(() => s().renameSim(s().activeId, 'Renamed'));
    step(() => s().commitEdit());
    step(() => s().toggleSimSelected(s().sims[0]!.id));
    step(() => s().patchLaunch({ windAverage: 4 }));
    step(() => s().commitEdit());
    step(() => s().patchActiveLaunch({ launchAltitudeM: 900 }));
    step(() => s().setSimPref('timeStep', 0.02));
    step(() => s().commitEdit());
    step(() => s().clearSimPrefs());
    step(() => s().commitEdit());
    step(() => s().setSimConfig(s().activeId, s().configs[1]!.id));
    step(() => s().deleteConfig(s().configs[1]!.id));
    step(() => s().deleteSim(s().sims[1]!.id));
    const depth = s().past.length;
    expect(depth).toBeGreaterThan(20);
    for (let i = 0; i < depth; i++) step(() => s().undo());
    for (let i = 0; i < depth; i++) step(() => s().redo());
    expect(s().future).toHaveLength(0);
  });
});

describe('updateDesignMeta', () => {
  it('records nothing when no field changes, and leaves redo alone', () => {
    s().setSelectedId('nose');
    s().patchSelected({ length: 0.27 });
    s().commitEdit();
    s().undo();
    const tree = s().tree;
    const past = s().past.length;
    // What the Rocket-configuration dialog sends on OK when nothing was edited:
    // every field as the tree holds it, and the design type the dialog
    // defaults an absent one to.
    s().updateDesignMeta({
      name: tree.name,
      designer: tree.designer,
      comment: tree.comment,
      revision: tree.revision,
      designType: tree.designType ?? 'original',
    });
    expect(s().tree).toBe(tree);
    expect(s().past).toHaveLength(past);
    expect(s().future).toHaveLength(1);
  });

  it('records one step when a field changes', () => {
    const past = s().past.length;
    s().updateDesignMeta({ designer: 'A. Builder' });
    expect(s().tree.designer).toBe('A. Builder');
    expect(s().past).toHaveLength(past + 1);
  });
});

describe('hydrate and repaired values', () => {
  it('lets the autosave keep a repair, so its note is not raised on every load', () => {
    const stored = workspaceSnapshot(s());
    const dense = { ...stored, tree: updateNode(stored.tree, 'nose', { density: 1e9 } as never) };
    const quiet = s().quietReplace;
    s().hydrate(dense);
    expect(s().repairNotes.length).toBeGreaterThan(0);
    expect(s().quietReplace).toBe(quiet);
    expect((findNode(s().tree, 'nose') as unknown as { density: number }).density).toBeLessThan(1e9);
  });

  it('stays quiet when nothing was repaired', () => {
    const stored = workspaceSnapshot(s());
    const quiet = s().quietReplace;
    s().hydrate(stored);
    expect(s().repairNotes).toEqual([]);
    expect(s().quietReplace).toBe(quiet + 1);
  });
});

describe('patchActiveLaunch', () => {
  it('writes the active simulation alone, even with rows ticked', () => {
    s().addSim();
    const [a, b] = s().sims;
    useWorkspaceStore.setState({ selectedSimIds: [a!.id, b!.id], activeId: b!.id });
    s().patchActiveLaunch({ launchAltitudeM: 1830 });
    expect(selectActive(s()).launch.launchAltitudeM).toBe(1830);
    expect(s().sims.find((x) => x.id === a!.id)!.launch.launchAltitudeM).not.toBe(1830);
  });

  it('is one undo step', () => {
    const before = selectActive(s()).launch;
    const past = s().past.length;
    s().patchActiveLaunch({ latitudeDeg: 39.05, longitudeDeg: -104.8 });
    expect(s().past).toHaveLength(past + 1);
    s().undo();
    expect(selectActive(s()).launch).toEqual(before);
  });

  it('records nothing when the site is already so', () => {
    const { latitudeDeg } = selectActive(s()).launch;
    const past = s().past.length;
    s().patchActiveLaunch({ latitudeDeg });
    expect(s().past).toHaveLength(past);
  });
});
