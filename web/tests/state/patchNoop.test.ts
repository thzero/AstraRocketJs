import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../../src/state/store';
import { findNode, patchChangesNode } from '../../src/services/design/treeEdit';

/**
 * A patch that says what the node already says must do nothing.
 *
 * `patchSelected` was the one tree-editing action with no no-op guard, where
 * `applyTreeAction` and `setStageDrogue` beside it both return on an unchanged
 * tree. It matters because `updateNode` always hands back a fresh `components`
 * array - it path-copies the spine as it walks, so it cannot cheaply know
 * otherwise - and `components` is the kernel rebuild dependency.
 *
 * `NumberInput` fires one patch per keystroke with the ALREADY-CLAMPED value, so
 * typing past a ceiling fired N identical patches: N full kernel builds, and an
 * undo step that changes nothing waiting for the user at the end of it.
 */
const s = () => useWorkspaceStore.getState();

/**
 * The tree with the nose cone's catalog link already gone.
 *
 * The default design's nose carries a `preset`, and patching any DIMENSION of a
 * preset part drops that link - which is itself a change, so `patchChangesNode`
 * reports one however equal the values are. The no-op case this guard exists for
 * is the SECOND and later keystroke, by which point the link is long gone.
 */
const unlinked = () => {
  const current = findNode(s().tree, 'nose')!.length as number;
  s().setSelectedId('nose');
  s().patchSelected({ length: current + 0.01 });
  s().patchSelected({ length: current });
  s().commitEdit();
  return s().tree;
};

describe('patchChangesNode', () => {
  beforeEach(() => {
    s().resetWorkspace();
  });

  it('is false for a patch that repeats the current value', () => {
    const current = findNode(unlinked(), 'nose')!.length as number;
    expect(patchChangesNode(unlinked(), 'nose', { length: current })).toBe(false);
  });

  it('is true for a patch that changes one key of several', () => {
    const current = findNode(unlinked(), 'nose')!.length as number;
    expect(patchChangesNode(unlinked(), 'nose', { length: current, name: 'Different' })).toBe(true);
  });

  it('is true for a key the node does not carry at all', () => {
    expect(patchChangesNode(unlinked(), 'nose', { comment: 'note' } as never)).toBe(true);
  });

  it('is false for a node that is not there, so nothing is attempted', () => {
    expect(patchChangesNode(s().tree, 'no-such-id', { length: 1 })).toBe(false);
  });

  it('is true when the only change is dropping the preset link', () => {
    // Dropping the link IS the change, even with every value already equal: the
    // panel's Parts Library row stops claiming this is a catalog part. The
    // DEFAULT nose carries a preset, so this is the plain tree.
    const nose = findNode(s().tree, 'nose')!;
    expect(nose['preset']).toBeTruthy();
    expect(patchChangesNode(s().tree, 'nose', { length: nose.length as number })).toBe(true);
  });
});

describe('patchSelected does nothing on a no-op', () => {
  beforeEach(() => {
    s().resetWorkspace();
    s().setSelectedId('nose');
  });

  it('leaves the tree IDENTICAL, which is what the rebuild keys on', () => {
    const before = unlinked();
    const current = findNode(before, 'nose')!.length as number;
    s().patchSelected({ length: current });
    // Reference equality, not deep equality: `components` is the dependency the
    // rebuild effect compares, so a fresh array is a kernel build whatever is in
    // it.
    expect(s().tree).toBe(before);
    expect(s().tree.components).toBe(before.components);
  });

  it('opens no undo transaction, so there is no empty step to undo', () => {
    const tree = unlinked();
    const steps = s().past.length;
    s().patchSelected({ length: findNode(tree, 'nose')!.length as number });
    s().commitEdit();
    expect(s().past).toHaveLength(steps);
  });

  it('survives the clamped-keystroke sequence with one step', () => {
    // What the user does: type past a ceiling. The box clamps and reports the
    // same value for every further character. The first patch is real; every one
    // after it was a full kernel build for nothing.
    const clamped = 0.42;
    const before = s().tree;
    s().patchSelected({ length: clamped });
    const afterFirst = s().tree;
    s().patchSelected({ length: clamped });
    s().patchSelected({ length: clamped });
    s().commitEdit();
    expect(afterFirst).not.toBe(before);
    expect(s().tree).toBe(afterFirst); // the second and third changed nothing
    expect(s().past).toHaveLength(1);
    expect(findNode(s().tree, 'nose')!.length).toBe(clamped);
  });

  it('still applies a real change after a no-op', () => {
    const current = findNode(unlinked(), 'nose')!.length as number;
    const steps = s().past.length;
    s().patchSelected({ length: current });
    s().patchSelected({ length: current + 0.05 });
    s().commitEdit();
    expect(findNode(s().tree, 'nose')!.length).toBeCloseTo(current + 0.05, 9);
    expect(s().past).toHaveLength(steps + 1);
  });

  it('still reconciles configurations when the mount flag really changes', () => {
    // The guard must not swallow the one patch that can alter mount topology.
    s().setSelectedId('body');
    const before = s().tree;
    s().patchSelected({ motorMount: true });
    expect(s().tree).not.toBe(before);
  });
});
