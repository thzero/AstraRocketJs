import { describe, it, expect } from 'vitest';
import { useWorkspaceStore, selectActive, workspaceSnapshot } from '../../src/state/store';
import { findNode, updateNode } from '../../src/services/design/treeEdit';
import { isStale } from '../testing/flown';

const s = () => useWorkspaceStore.getState();

/**
 * A stored result from before result keys carries an `outdated` flag instead.
 * Flagged current, it was current against the tree stored beside it. When the
 * load repairs a value in that tree, the design on screen is not the one it
 * flew, so the result reads outdated.
 */
describe('a stored result with no result key, on a design the load repairs', () => {
  it('reads outdated against the repaired design', () => {
    s().resetWorkspace();
    const stored = workspaceSnapshot(s());
    // A density no material has, which the load clamps.
    const tree = updateNode(stored.tree, 'nose', { density: 1e9 } as never);
    const sims = stored.sims.map((x) => ({ ...x, result: { summary: {} } as never, outdated: false }));
    s().hydrate({ ...stored, tree, sims });

    expect(s().repairNotes.length).toBeGreaterThan(0);
    expect((findNode(s().tree, 'nose') as unknown as { density: number }).density).not.toBe(1e9);
    expect(isStale(selectActive(s()))).toBe(true);
  });

  it('reads current when the load repairs nothing', () => {
    s().resetWorkspace();
    const stored = workspaceSnapshot(s());
    const sims = stored.sims.map((x) => ({ ...x, result: { summary: {} } as never, outdated: false }));
    s().hydrate({ ...stored, sims });

    expect(s().repairNotes).toEqual([]);
    expect(isStale(selectActive(s()))).toBe(false);
  });
});
