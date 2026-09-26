import { describe, it, expect, vi } from 'vitest';
import { addPart, defaultNode, findNode, updateNode } from '../../src/services/treeEdit';
import type { RocketTree } from '../../src/engine/openRocketEngine';

/**
 * Node ids were minted from a module-scope counter (`<type>-<n>`) that
 * restarted at zero on every page load while the persisted tree kept its ids.
 * Session 2's first body tube was `bodytube-1` again, and every walker stops
 * at the first match, so editing the new part edited the old one.
 *
 * A fresh module instance stands in for a reload.
 */
describe('treeEdit node ids survive a reload', () => {
  it('a new node never reuses an id already in the tree, even when the tree came from an earlier session', async () => {
    // "Earlier session": a tree whose ids came from whatever the previous
    // build minted, including the old counter format.
    const persisted: RocketTree = {
      components: [
        {
          type: 'stage',
          id: 's1',
          children: [
            { type: 'bodytube', id: 'bodytube-1', name: 'old' },
            { type: 'bodytube', id: 'bodytube-2', name: 'old 2' },
          ],
        },
      ],
    };
    // "This session": a freshly loaded copy of the module (module-scope state
    // starts over, exactly as it does on a page load).
    vi.resetModules();
    const fresh = await import('../../src/services/treeEdit');
    const { tree, id } = fresh.addPart(persisted, 'bodytube', 's1');
    expect(['bodytube-1', 'bodytube-2']).not.toContain(id);
    const renamed = updateNode(tree, id, { name: 'new' });
    expect(findNode(renamed, 'bodytube-1')!.name).toBe('old');
    expect(findNode(renamed, id)!.name).toBe('new');
  });

  it('two nodes minted back to back differ', () => {
    expect(defaultNode('bodytube').id).not.toBe(defaultNode('bodytube').id);
  });

  it('ids are UUIDs, so they cannot collide across sessions by construction', () => {
    // A body tube: addPart now enforces allowedChildren, and a stage hosts the
    // axial chain only, so a bulkhead under a bare stage would throw.
    const { id } = addPart({ components: [{ type: 'stage', id: 's1', children: [] }] }, 'bodytube', 's1');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
