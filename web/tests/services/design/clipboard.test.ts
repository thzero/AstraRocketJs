import { describe, it, expect } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { canRemove, duplicateNode, pasteNode, pastePlace } from '../../../src/services/design/clipboard';
import { findNode, findParent } from '../../../src/services/design/treeEdit';

/** Desktop's Edit menu rules (RocketActions): inside if it fits, else after, else nowhere. */
const makeTree = (): RocketTree =>
  ({
    components: [
      {
        id: 's1',
        type: 'stage',
        children: [
          { id: 'n1', type: 'nosecone' },
          {
            id: 'b1',
            type: 'bodytube',
            children: [
              { id: 'm1', type: 'innertube', motorMount: true },
              { id: 'f1', type: 'trapezoidfinset', name: 'Fins' },
              { id: 'p1', type: 'parachute', drogue: true },
            ],
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

const part = (type: string, extra: Record<string, unknown> = {}): ComponentNode =>
  ({ id: 'clip', type, ...extra }) as unknown as ComponentNode;

const kids = (tree: RocketTree, id: string) => (findNode(tree, id)!.children ?? []).map((c) => c.type);

describe('pastePlace', () => {
  it('goes inside the selection when it fits, as the last child', () => {
    expect(pastePlace(makeTree(), part('bulkhead'), 'b1')).toEqual({ parentId: 'b1', index: 3 });
  });

  it('goes after the selection, in its parent, when only the parent fits', () => {
    // A fin set holds nothing; a bulkhead beside it goes in the body tube.
    expect(pastePlace(makeTree(), part('bulkhead'), 'f1')).toEqual({ parentId: 'b1', index: 2 });
  });

  it('has nowhere to go when neither fits', () => {
    // Fins may not sit in a transition, nor in the stage beside one.
    expect(pastePlace(makeTree(), part('trapezoidfinset'), 'n1')).toBeNull();
  });

  it('puts a stage after a selected stage, or at the end with nothing selected', () => {
    expect(pastePlace(makeTree(), part('stage'), 's1')).toEqual({ parentId: null, index: 1 });
    expect(pastePlace(makeTree(), part('stage'), null)).toEqual({ parentId: null, index: 1 });
    expect(pastePlace(makeTree(), part('bulkhead'), null)).toBeNull();
  });
});

describe('pasteNode', () => {
  it('pastes a copy with fresh ids throughout and returns its id', () => {
    const clip = part('masscomponent', { children: [{ id: 'inner', type: 'masscomponent' }] });
    const done = pasteNode(makeTree(), clip, 'b1')!;
    const pasted = findNode(done.tree, done.id)!;
    expect(done.id).not.toBe('clip');
    expect(pasted.children![0]!.id).not.toBe('inner');
    expect(findParent(done.tree, done.id)!.id).toBe('b1');
  });

  it('leaves a second drogue in one stage as a plain recovery device', () => {
    const done = pasteNode(makeTree(), part('parachute', { drogue: true }), 'b1')!;
    expect(findNode(done.tree, done.id)!['drogue']).toBeUndefined();
    expect(findNode(done.tree, 'p1')!['drogue']).toBe(true);
  });

  it('keeps the drogue mark where the stage has none', () => {
    const tree = makeTree();
    delete (findNode(tree, 'p1') as Record<string, unknown>)['drogue'];
    const done = pasteNode(tree, part('parachute', { drogue: true }), 'b1')!;
    expect(findNode(done.tree, done.id)!['drogue']).toBe(true);
  });
});

describe('duplicateNode', () => {
  it('puts the copy at the end of the parent, keeping its name', () => {
    const done = duplicateNode(makeTree(), 'f1')!;
    expect(kids(done.tree, 'b1')).toEqual(['innertube', 'trapezoidfinset', 'parachute', 'trapezoidfinset']);
    expect(findNode(done.tree, done.id)!.name).toBe('Fins');
  });

  it('duplicates a stage as a new last stage', () => {
    const done = duplicateNode(makeTree(), 's1')!;
    expect(done.tree.components.map((c) => c.type)).toEqual(['stage', 'stage']);
    expect(done.tree.components[1]!.id).toBe(done.id);
  });
});

describe('canRemove', () => {
  it('refuses only the last stage', () => {
    expect(canRemove(makeTree(), 's1')).toBe(false);
    expect(canRemove(makeTree(), 'f1')).toBe(true);
    expect(canRemove(duplicateNode(makeTree(), 's1')!.tree, 's1')).toBe(true);
  });
});
