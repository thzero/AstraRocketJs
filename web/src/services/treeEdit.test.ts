import { describe, it, expect } from 'vitest';
import {
  findNode, updateNode, removeNode, addChild, findMountId, findMounts, isUpperStageMount,
  isAxial, allowedChildren, hasCatalog, hasMaterial, catalogPatch,
  siblingIndex, moveNode, defaultNode, addPart,
} from './treeEdit';
import type { RocketTree } from '../engine/openRocketEngine';
import type { Component } from './componentDb';

const makeTree = (): RocketTree =>
  ({
    components: [
      {
        id: 's1', type: 'stage', children: [
          { id: 'n1', type: 'nosecone' },
          {
            id: 'b1', type: 'bodytube', children: [
              { id: 'm1', type: 'innertube', motorMount: true },
              { id: 'f1', type: 'trapezoidfinset' },
            ],
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

describe('findNode', () => {
  it('finds nested nodes and returns null when absent', () => {
    expect(findNode(makeTree(), 'm1')!.type).toBe('innertube');
    expect(findNode(makeTree(), 'nope')).toBeNull();
  });
});

describe('immutable edits', () => {
  it('updateNode patches a fresh tree, leaving the original untouched', () => {
    const t = makeTree();
    const next = updateNode(t, 'n1', { length: 0.5 } as never);
    expect(next).not.toBe(t);
    expect((findNode(next, 'n1') as { length?: number }).length).toBe(0.5);
    expect((findNode(t, 'n1') as { length?: number }).length).toBeUndefined();
  });

  it('removeNode drops a nested node without mutating the original', () => {
    const t = makeTree();
    const next = removeNode(t, 'f1');
    expect(findNode(next, 'f1')).toBeNull();
    expect(findNode(t, 'f1')).not.toBeNull();
  });

  it('addChild appends, creating the children array when missing', () => {
    const t = makeTree();
    const next = addChild(t, 'n1', { id: 'x', type: 'bulkhead' } as never);
    expect(findNode(next, 'x')).not.toBeNull();
    expect(findNode(t, 'x')).toBeNull();
  });
});

describe('mount + type rules', () => {
  it('findMountId returns the first motor-mount id', () => {
    expect(findMountId(makeTree())).toBe('m1');
  });

  it('findMounts returns every motor-mount node in order', () => {
    const t = makeTree();
    // add a second mount under the body tube
    const two = addChild(t, 'b1', { id: 'm2', type: 'innertube', motorMount: true } as never);
    expect(findMounts(two).map((n) => n.id)).toEqual(['m1', 'm2']);
    expect(findMounts(makeTree()).map((n) => n.id)).toEqual(['m1']);
  });

  it('isUpperStageMount is false on a single (implicit or explicit) stage', () => {
    expect(isUpperStageMount(makeTree(), 'm1')).toBe(false);
  });

  it('isUpperStageMount is true for a mount above the bottom booster, false for the booster', () => {
    // Two stages in desktop order: [0] = top sustainer, [1] = bottom booster.
    const staged = ({
      components: [
        { id: 'sus', type: 'stage', children: [
          { id: 'bt-s', type: 'bodytube', children: [{ id: 'm-sus', type: 'innertube', motorMount: true }] },
        ] },
        { id: 'boost', type: 'stage', children: [
          { id: 'bt-b', type: 'bodytube', children: [{ id: 'm-boost', type: 'innertube', motorMount: true }] },
        ] },
      ],
    }) as unknown as RocketTree;
    expect(isUpperStageMount(staged, 'm-sus')).toBe(true);   // has the booster below it
    expect(isUpperStageMount(staged, 'm-boost')).toBe(false); // bottom stage — nothing below
  });

  it('isAxial is true only for axial body components', () => {
    expect(isAxial('nosecone')).toBe(true);
    expect(isAxial('bodytube')).toBe(true);
    expect(isAxial('trapezoidfinset')).toBe(false);
  });

  it('allowedChildren maps parents, defaults undefined→stage, leaves→[]', () => {
    expect(allowedChildren('stage')).toContain('nosecone');
    expect(allowedChildren(undefined)).toEqual(allowedChildren('stage'));
    expect(allowedChildren('parachute')).toEqual([]); // leaf, absent from the map
  });

  it('hasCatalog / hasMaterial classify types', () => {
    expect(hasCatalog('nosecone')).toBe(true);
    expect(hasCatalog('trapezoidfinset')).toBe(false);
    expect(hasMaterial('bodytube')).toBe(true);
    expect(hasMaterial('parachute')).toBe(false);
  });
});

describe('catalogPatch', () => {
  it('maps a filled nosecone (radius + solid thickness + material)', () => {
    const p = { type: 'nosecone', shape: 'ogive', length: 0.1, outerDiameter: 0.05, filled: true, materialDensity: 680, material: 'Balsa' } as unknown as Component;
    expect(catalogPatch(p)).toMatchObject({ shape: 'ogive', length: 0.1, aftRadius: 0.025, thickness: 0.025, density: 680, materialName: 'Balsa' });
  });

  it('derives body-tube wall thickness from OD/ID and clamps to a floor', () => {
    const wall = { type: 'bodytube', outerDiameter: 0.05, innerDiameter: 0.048, length: 0.2, materialDensity: 930 } as unknown as Component;
    const wallPatch = catalogPatch(wall) as { outerRadius: number; length: number; thickness: number };
    expect(wallPatch).toMatchObject({ outerRadius: 0.025, length: 0.2 });
    expect(wallPatch.thickness).toBeCloseTo(0.001, 9); // (OD−ID)/2
    const paper = { type: 'bodytube', outerDiameter: 0.05, innerDiameter: 0.049999, length: 0.2, materialDensity: 800 } as unknown as Component;
    expect((catalogPatch(paper) as { thickness: number }).thickness).toBe(0.0001); // clamped
  });

  it('defaults parachute Cd to 0.8 when the catalog omits it', () => {
    expect(catalogPatch({ type: 'parachute', diameter: 0.3, cd: null } as unknown as Component)).toEqual({ diameter: 0.3, cd: 0.8 });
    expect(catalogPatch({ type: 'parachute', diameter: 0.3, cd: 1.5 } as unknown as Component)).toEqual({ diameter: 0.3, cd: 1.5 });
  });

  it('omits material fields when the part has no density', () => {
    const patch = catalogPatch({ type: 'bulkhead', outerDiameter: 0.05, length: 0.003 } as unknown as Component);
    expect(patch).not.toHaveProperty('density');
  });
});

describe('sibling ordering', () => {
  it('siblingIndex reports index + count, null when absent', () => {
    expect(siblingIndex(makeTree(), 'n1')).toEqual({ index: 0, count: 2 });
    expect(siblingIndex(makeTree(), 'b1')).toEqual({ index: 1, count: 2 });
    expect(siblingIndex(makeTree(), 'nope')).toBeNull();
  });

  it('moveNode swaps within bounds and is a no-op past the edge', () => {
    const t = makeTree();
    const down = moveNode(t, 'n1', 1);
    expect(down.components[0]!.children!.map((c) => c.id)).toEqual(['b1', 'n1']);
    const edge = moveNode(t, 'n1', -1); // already first → unchanged order
    expect(edge.components[0]!.children!.map((c) => c.id)).toEqual(['n1', 'b1']);
    expect(t.components[0]!.children!.map((c) => c.id)).toEqual(['n1', 'b1']); // original intact
  });
});

describe('recovery-device defaults', () => {
  it('parachute defaults carry Cd, shroud lines, and an apogee deployment', () => {
    const p = defaultNode('parachute') as Record<string, unknown>;
    expect(p.diameter).toBeGreaterThan(0);
    expect(p.cd).toBeGreaterThan(0);
    expect(p.lineCount).toBeGreaterThan(0);
    expect(typeof p.lineLength).toBe('number');
    expect(p.deployEvent).toBe('apogee');
  });

  it('freeform fin is addable and defaults to a valid outline (>= 3 points)', () => {
    expect(allowedChildren('bodytube')).toContain('freeformfinset');
    const ff = defaultNode('freeformfinset') as Record<string, unknown>;
    const pts = ff.points as [number, number][];
    expect(Array.isArray(pts)).toBe(true);
    expect(pts.length).toBeGreaterThanOrEqual(3);
  });

  it('streamer defaults use stripLength/stripWidth (not length/width) + Cd + apogee', () => {
    const s = defaultNode('streamer') as Record<string, unknown>;
    // Guards the key-name bug: the editor/engine/.ork all key on stripLength/
    // stripWidth; a regression to length/width silently drops streamer sizing.
    expect(s.stripLength).toBeGreaterThan(0);
    expect(s.stripWidth).toBeGreaterThan(0);
    expect(s.length).toBeUndefined();
    expect(s.width).toBeUndefined();
    expect(s.cd).toBeGreaterThan(0);
    expect(s.deployEvent).toBe('apogee');
  });
});

describe('defaultNode', () => {
  it('gives an innertube a motor mount and a nosecone an ogive shape', () => {
    expect((defaultNode('innertube') as { motorMount?: boolean }).motorMount).toBe(true);
    expect((defaultNode('nosecone') as { shape?: string }).shape).toBe('ogive');
  });
});

describe('addPart', () => {
  it('adds under the selected node', () => {
    const { tree, id } = addPart(makeTree(), 'bulkhead', 'b1');
    expect(findNode(tree, 'b1')!.children!.some((c) => c.id === id)).toBe(true);
  });

  it('falls back to the stage when nothing is selected or the selection is missing', () => {
    const a = addPart(makeTree(), 'bodytube', null);
    expect(findNode(a.tree, 's1')!.children!.some((c) => c.id === a.id)).toBe(true);
    const b = addPart(makeTree(), 'bodytube', 'ghost');
    expect(findNode(b.tree, 's1')!.children!.some((c) => c.id === b.id)).toBe(true);
  });

  it('pushes to the root when there is no stage at all', () => {
    const flat = { components: [{ id: 'b', type: 'bodytube' }] } as unknown as RocketTree;
    const { tree, id } = addPart(flat, 'bodytube', null);
    expect(tree.components).toHaveLength(2);
    expect(tree.components.some((c) => c.id === id)).toBe(true);
  });
});
