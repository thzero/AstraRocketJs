import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../../src/state/store';

/**
 * A tree edit that changes nothing records no undo step and leaves the tree
 * object alone. The tree is the kernel rebuild dependency, so a fresh copy of
 * an unchanged design costs a full rebuild, and Undo would then step over an
 * entry that does nothing visible.
 */
const s = () => useWorkspaceStore.getState();

describe('tree edits that change nothing', () => {
  beforeEach(() => {
    s().resetWorkspace();
  });

  it('records nothing for a move past the end of the siblings', () => {
    // The nose cone is the first part of the default stage, so it cannot move up.
    s().setSelectedId('nose');
    const before = s().tree;
    const depth = s().past.length;
    s().moveSelected(-1);
    expect(s().tree).toBe(before);
    expect(s().past.length).toBe(depth);
  });

  it('records one step for a move that happens', () => {
    s().setSelectedId('nose');
    const before = s().tree;
    const depth = s().past.length;
    s().moveSelected(1);
    expect(s().tree).not.toBe(before);
    expect(s().past.length).toBe(depth + 1);
  });

  it('records nothing for a tree action that returns the tree it was given', () => {
    const before = s().tree;
    const depth = s().past.length;
    s().applyTreeAction((t) => t);
    expect(s().tree).toBe(before);
    expect(s().past.length).toBe(depth);
  });

  it('leaves no step behind when the edit throws', () => {
    const depth = s().past.length;
    expect(() =>
      s().applyTreeAction(() => {
        throw new Error('refused');
      }),
    ).toThrow('refused');
    expect(s().past.length).toBe(depth);
  });
});
