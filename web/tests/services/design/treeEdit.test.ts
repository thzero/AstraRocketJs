import { describe, it, expect } from 'vitest';
import { defaultStageName } from '../../../src/services/design/orkTree';
import {
  findNode,
  findParent,
  updateNode,
  removeNode,
  addChild,
  findMounts,
  isAxial,
  allowedChildren,
  hasCatalog,
  hasMaterial,
  catalogPatch,
  siblingIndex,
  moveNode,
  defaultNode,
  addPart,
  addStage,
  stageNodes,
  isFirstStage,
} from '../../../src/services/design/treeEdit';
import type { RocketTree } from '../../../src/engine/openRocketEngine';
import type { Component } from '../../../src/services/parts/componentDb';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import { KERNEL_DEFAULTS } from '../../../src/tree/kernelDefaults';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

describe('findParent', () => {
  it('returns the containing component', () => {
    expect(findParent(makeTree(), 'f1')!.id).toBe('b1');
    expect(findParent(makeTree(), 'n1')!.id).toBe('s1');
  });

  it('returns null for a top-level node and for an id that is not there', () => {
    // Null is a real answer here (a stage has no parent) as well as the "not
    // found" result, so both are pinned: a search that conflated them would
    // report the last-visited node instead.
    expect(findParent(makeTree(), 's1')).toBeNull();
    expect(findParent(makeTree(), 'nope')).toBeNull();
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
  it('findMounts returns every motor-mount node in order', () => {
    const t = makeTree();
    // add a second mount under the body tube
    const two = addChild(t, 'b1', { id: 'm2', type: 'innertube', motorMount: true } as never);
    expect(findMounts(two).map((n) => n.id)).toEqual(['m1', 'm2']);
    expect(findMounts(makeTree()).map((n) => n.id)).toEqual(['m1']);
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
    // An inner tube can be picked even though the catalog has no such type:
    // it reads the body tube rows, which include motor mount tubes. See
    // componentDb.catalogTypeFor.
    expect(hasCatalog('innertube')).toBe(true);
    expect(hasMaterial('bodytube')).toBe(true);
    expect(hasMaterial('parachute')).toBe(false);
  });
});

describe('catalogPatch', () => {
  it('maps a filled nosecone (radius + solid thickness + material)', () => {
    const p = {
      type: 'nosecone',
      shape: 'ogive',
      length: 0.1,
      outerDiameter: 0.05,
      filled: true,
      materialDensity: 680,
      material: 'Balsa',
    } as unknown as Component;
    expect(catalogPatch(p)).toMatchObject({
      shape: 'ogive',
      length: 0.1,
      aftRadius: 0.025,
      filled: true,
      thickness: 0.025,
      density: 680,
      materialName: 'Balsa',
    });
  });

  /**
   * Whether a cone is solid is the part's answer, not the last part's.
   *
   * The kernel reads it from the `filled` flag (`api/ComponentFactory` calls
   * `setFilled`), and the catalog publishes it on every nose cone row: most are
   * filled and some are not, the default PNC-50KA among them. A pick that left
   * the flag alone would let whatever was there before decide, so a solid cone
   * followed by a hollow one would fly solid at the hollow one's dimensions:
   * several times the part's real mass, at the very nose, which moves the CG and
   * the margin with it.
   */
  describe('a nose cone picked after another', () => {
    const cone = (filled: boolean) =>
      ({ type: 'nosecone', shape: 'ogive', length: 0.1, outerDiameter: 0.05, filled }) as unknown as Component;
    const solidNode = { type: 'nosecone', filled: true, thickness: 0.03 } as unknown as ComponentNode;
    const hollowNode = { type: 'nosecone', thickness: 0.0013 } as unknown as ComponentNode;

    it('stops being solid when the part it replaces was', () => {
      const patch = catalogPatch(cone(false), solidNode);
      expect(patch).toMatchObject({ filled: false });
      // And its wall is a wall. The replaced node's 30 mm was the whole radius
      // of a solid part; carried over it would keep this 25 mm cone solid.
      expect(patch.thickness).toBe(KERNEL_DEFAULTS.nosecone.thickness);
      expect(patch.thickness!).toBeLessThan(0.025);
    });

    it('keeps a wall that is already a wall', () => {
      // 1.3 mm was typed for this airframe; a different hollow cone is no
      // reason to throw it away, and the row states no wall of its own.
      expect(catalogPatch(cone(false), hollowNode)).toMatchObject({ filled: false });
      expect(catalogPatch(cone(false), hollowNode).thickness).toBeUndefined();
    });

    it('becomes solid when the part it replaces was not', () => {
      expect(catalogPatch(cone(true), hollowNode)).toMatchObject({ filled: true, thickness: 0.025 });
    });

    it('still answers with no node to compare against', () => {
      // The picker always has one, but the function is reachable without.
      expect(catalogPatch(cone(false))).toMatchObject({
        filled: false,
        thickness: KERNEL_DEFAULTS.nosecone.thickness,
      });
    });

    it('is still what the kernel reads solidness from', () => {
      // The one thing holding this to the engine: the flag, not the thickness.
      const factory = readFileSync(
        resolve(process.cwd(), '../engine-java/src/api/java/api/ComponentFactory.java'),
        'utf8',
      );
      expect(factory).toContain('nose.setFilled(bool(node, "filled", false));');
    });
  });

  it('derives body-tube wall thickness from OD/ID and clamps to a floor', () => {
    const wall = {
      type: 'bodytube',
      outerDiameter: 0.05,
      innerDiameter: 0.048,
      length: 0.2,
      materialDensity: 930,
    } as unknown as Component;
    const wallPatch = catalogPatch(wall) as { outerRadius: number; length: number; thickness: number };
    expect(wallPatch).toMatchObject({ outerRadius: 0.025, length: 0.2 });
    expect(wallPatch.thickness).toBeCloseTo(0.001, 9); // (OD−ID)/2
    const paper = {
      type: 'bodytube',
      outerDiameter: 0.05,
      innerDiameter: 0.049999,
      length: 0.2,
      materialDensity: 800,
    } as unknown as Component;
    expect((catalogPatch(paper) as { thickness: number }).thickness).toBe(0.0001); // clamped
  });

  it('defaults parachute Cd to 0.8 when the catalog omits it', () => {
    expect(catalogPatch({ type: 'parachute', diameter: 0.3, cd: null } as unknown as Component)).toMatchObject({
      diameter: 0.3,
      cd: 0.8,
      cdAuto: true,
    });
    expect(catalogPatch({ type: 'parachute', diameter: 0.3, cd: 1.5 } as unknown as Component)).toMatchObject({
      diameter: 0.3,
      cd: 1.5,
      cdAuto: false,
    });
  });

  // Parachute.loadFromPreset: lines, materials and packed size from the part.
  it('applies the lines, materials and packed size a parachute row states', () => {
    const patch = catalogPatch({
      type: 'parachute',
      diameter: 0.6,
      cd: 0.99,
      lineCount: 10,
      lineLength: 0.7,
      packedLength: 0.058,
      packedDiameter: 0.05,
      material: 'Ripstop nylon, lightweight, 3 mil',
      materialDensity: 0.0357,
      lineMaterial: 'Spectra #200',
      lineMaterialDensity: 0.00066,
      mass: 0.035,
    } as unknown as Component);
    expect(patch).toMatchObject({
      lineCount: 10,
      lineLength: 0.7,
      lineLengthAuto: false,
      surfaceMaterialName: 'Ripstop nylon, lightweight, 3 mil',
      surfaceDensity: 0.0357,
      lineMaterialName: 'Spectra #200',
      lineDensity: 0.00066,
      length: 0.058,
      radius: 0.025,
      // Both packed sizes stated: the radius follows the bore, as on the desktop.
      radiusAuto: true,
      overrideMass: 0.035,
    });
  });

  it('resets what a parachute row leaves out to the values of a new parachute', () => {
    const patch = catalogPatch({
      type: 'parachute',
      diameter: 0.3,
      cd: null,
      packedDiameter: 0.04,
      mass: 0,
    } as unknown as Component);
    expect(patch).toMatchObject({
      lineCount: 6,
      lineLength: 0.3,
      surfaceMaterialName: 'Ripstop nylon',
      lineMaterialName: 'Elastic cord (round 2 mm, 1/16 in)',
      radius: 0.02,
      radiusAuto: false,
    });
    // A zero mass is no mass: no override, rather than a weightless canopy.
    expect(patch['overrideMass']).toBeUndefined();
    // No packed length stated, so the part keeps the one it had.
    expect(patch).not.toHaveProperty('length');
  });

  it('applies a saved part without the keys a saved part never keeps', () => {
    // A stored entry from storage can carry anything; applying its id, type,
    // name, position or children would duplicate an id or change the part.
    const patch = catalogPatch({
      type: 'bodytube',
      custom: true,
      patch: {
        id: 'stale',
        type: 'nosecone',
        name: 'Old name',
        position: { method: 'top', offset: 0.1 },
        children: [{ id: 'kid', type: 'finset' }],
        outerRadius: 0.02,
        length: 0.3,
      },
    } as unknown as Component);
    expect(patch).toMatchObject({ outerRadius: 0.02, length: 0.3 });
    for (const key of ['id', 'type', 'name', 'position', 'children']) expect(patch).not.toHaveProperty(key);
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

  it('streamer defaults use stripLength/stripWidth (not length/width) + automatic Cd + apogee', () => {
    const s = defaultNode('streamer') as Record<string, unknown>;
    // The editor, engine and .ork all key on stripLength/stripWidth; a default
    // under length/width would silently drop streamer sizing.
    expect(s.stripLength).toBeGreaterThan(0);
    expect(s.stripWidth).toBeGreaterThan(0);
    expect(s.length).toBeUndefined();
    expect(s.width).toBeUndefined();
    // Streamer() starts with cdAutomatic set; a stated cd would fly as the user's own.
    expect(s.cdAuto).toBe(true);
    expect(s.cd).toBeUndefined();
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

describe('defaultNode(stage)', () => {
  it('is a bare stage seeded with the desktop-default separation', () => {
    const n = defaultNode('stage');
    expect(n.type).toBe('stage');
    expect(n.children ?? []).toHaveLength(0);
    expect(n.separationEvent).toBe('ejection');
    expect(n.separationDelay).toBe(0);
  });
});

describe('addStage', () => {
  it('appends a new empty stage as the bottom sibling and names it as a file names its unnamed stage', () => {
    const { tree, id } = addStage(makeTree());
    const stages = stageNodes(tree);
    expect(stages).toHaveLength(2);
    expect(stages[1]!.id).toBe(id); // appended last (the bottom booster)
    expect(stages[1]!.name).toBe(defaultStageName(1));
    expect(stages[1]!.name).toBe('Booster 1');
    expect(stages[1]!.children ?? []).toHaveLength(0);
  });

  it('numbers a third stage and leaves the original tree untouched', () => {
    const t = makeTree();
    const once = addStage(t).tree;
    const twice = addStage(once).tree;
    expect(stageNodes(twice).map((s) => s.name)).toEqual([undefined, 'Booster 1', 'Booster 2']);
    expect(t.components).toHaveLength(1); // immutable: original unchanged
  });
});

describe('stage helpers', () => {
  it('stageNodes returns top-level stages in order; isFirstStage flags the top one', () => {
    const { tree, id } = addStage(makeTree());
    expect(stageNodes(tree).map((s) => s.id)).toEqual(['s1', id]);
    expect(isFirstStage(tree, 's1')).toBe(true);
    expect(isFirstStage(tree, id)).toBe(false);
  });
});

describe('addPart enforces allowedChildren', () => {
  it('adds under the nearest ancestor that may host the type when the selection cannot', () => {
    // A fin set is a leaf; a bulkhead added with it selected belongs in the
    // fin's body tube, which is where the desktop would put it.
    const { tree, id } = addPart(makeTree(), 'bulkhead', 'f1');
    expect(findNode(tree, 'b1')!.children!.some((c) => c.id === id)).toBe(true);
    expect(findNode(tree, 'f1')!.children ?? []).toHaveLength(0);
  });

  it('falls back to the stage for an axial part added with an internal part selected', () => {
    const { tree, id } = addPart(makeTree(), 'transition', 'm1');
    expect(findNode(tree, 's1')!.children!.some((c) => c.id === id)).toBe(true);
  });

  it('throws rather than building a tree the kernel would never see from the desktop', () => {
    // Nothing above a bare stage can host a bulkhead: a caller bug, not a
    // design to silently produce.
    const bare = { components: [{ id: 's1', type: 'stage', children: [] }] } as unknown as RocketTree;
    expect(() => addPart(bare, 'bulkhead', 's1')).toThrow(/cannot be added/);
    expect(() => addPart(bare, 'bulkhead', null)).toThrow(/cannot be added/);
  });
});

describe('updateNode path-copies the spine only', () => {
  it('shares every untouched node with the input and copies the patched path', () => {
    const t = makeTree();
    const next = updateNode(t, 'f1', { rootChord: 0.1 } as never);
    // Spine: root -> s1 -> b1 -> f1 are new objects...
    expect(next).not.toBe(t);
    expect(findNode(next, 's1')).not.toBe(findNode(t, 's1'));
    expect(findNode(next, 'b1')).not.toBe(findNode(t, 'b1'));
    expect(findNode(next, 'f1')).not.toBe(findNode(t, 'f1'));
    // ...and everything off it is the same object (no per-keystroke deep clone).
    expect(findNode(next, 'n1')).toBe(findNode(t, 'n1'));
    expect(findNode(next, 'm1')).toBe(findNode(t, 'm1'));
    // The input is untouched.
    expect((findNode(t, 'f1') as { rootChord?: number }).rootChord).toBeUndefined();
    expect((findNode(next, 'f1') as { rootChord?: number }).rootChord).toBe(0.1);
  });

  it('still returns a distinct tree when the id is not found', () => {
    const t = makeTree();
    const next = updateNode(t, 'nope', { length: 1 } as never);
    expect(next).not.toBe(t);
    expect(next.components).toBe(t.components); // nothing to copy
  });
});

/**
 * A rail button from the catalog, as RailButton.loadFromPreset applies it: the
 * button's geometry, and the button, screw and nut masses together as its mass
 * override. One that states no mass or Cd clears the overrides.
 */
describe('catalogPatch for a rail button', () => {
  const row = {
    type: 'railbutton',
    mfr: 'Binder Design-Rail Button Supply House',
    partNo: 'Std 1010 RB',
    desc: 'Standard 1010 Rail Button',
    material: 'Delrin',
    materialDensity: 1420,
    outerDiameter: 0.0111125,
    innerDiameter: 0.0058039,
    height: 0.0075565,
    baseHeight: 0.0018542,
    flangeHeight: 0.0018542,
    screwHeight: 0,
    cd: null,
    mass: 0.002865,
  } as const;

  it('is offered by the parts picker', () => {
    expect(hasCatalog('railbutton')).toBe(true);
  });

  it('applies the geometry and the combined mass as the override', () => {
    expect(catalogPatch(row as never)).toMatchObject({
      outerDiameter: 0.0111125,
      innerDiameter: 0.0058039,
      height: 0.0075565,
      baseHeight: 0.0018542,
      flangeHeight: 0.0018542,
      screwHeight: 0,
      overrideMass: 0.002865,
      density: 1420,
      materialName: 'Delrin',
    });
  });

  it('leaves the overrides alone for a part that states neither', () => {
    // RailButton.loadFromPreset sets the mass override only when the preset has
    // a MASS, SCREW_MASS or NUT_MASS, and the drag override only for a CD > 0.
    const patch = catalogPatch({ ...row, mass: undefined } as never);
    expect('overrideMass' in patch).toBe(false);
    expect('overrideCD' in patch).toBe(false);
  });

  it('applies a stated drag coefficient as the drag override', () => {
    expect(catalogPatch({ ...row, cd: 0.6 } as never).overrideCD).toBe(0.6);
  });
});

/**
 * A centering ring from the catalog, as RadiusRingComponent.loadFromPreset
 * applies it: the inner radius only when the part states one, with the bore no
 * longer automatic either way.
 */
describe('catalogPatch for a centering ring', () => {
  const row = {
    type: 'centeringring',
    mfr: 'Estes',
    partNo: 'CR-1',
    desc: 'ring',
    outerDiameter: 0.04,
    innerDiameter: 0.019,
    length: 0.003,
    materialDensity: 0,
  } as const;

  it('takes a stated inner diameter', () => {
    expect(catalogPatch(row as never)).toMatchObject({
      outerRadius: 0.02,
      innerRadius: 0.0095,
      innerRadiusAuto: false,
    });
  });

  it('keeps the bore the ring had when the part states none', () => {
    const patch = catalogPatch({ ...row, innerDiameter: null } as never);
    expect('innerRadius' in patch).toBe(false);
    expect(patch['innerRadiusAuto']).toBe(false);
  });

  // RadiusRingComponent.loadFromPreset stores a stated bore unchecked, and
  // getThickness reads a bore past the outer radius as no wall. The patch holds
  // the bore at the outer radius, the bound the panel puts on a typed bore.
  // Quest CR2924 states a 28.8 mm bore in a 25.25 mm ring.
  it('holds a stated bore inside the outer radius', () => {
    const patch = catalogPatch({ ...row, outerDiameter: 0.02525, innerDiameter: 0.0288 } as never);
    expect(patch['outerRadius']).toBe(0.02525 / 2);
    expect(patch['innerRadius']).toBe(0.02525 / 2);
  });

  it('holds the bore the ring had inside a smaller new part', () => {
    const node = { type: 'centeringring', id: 'r', outerRadius: 0.03, innerRadius: 0.025 } as unknown as ComponentNode;
    const patch = catalogPatch({ ...row, innerDiameter: null } as never, node);
    expect(patch['innerRadius']).toBe(0.02);
  });
});

describe('a new pod set or parallel stage', () => {
  // The booster's seed tube is slim on purpose. A new body tube is automatic,
  // and an automatic tube with no neighbor in its own chain resolves to the
  // kernel's SymmetricComponent.DEFAULT_RADIUS (25 mm), so the seed has to be fixed.
  it('keeps the parallelstage seed tube at 9 mm radius once added', () => {
    const { tree, id } = addPart(makeTree(), 'parallelstage', 'b1');
    const tube = findNode(tree, id)!.children![0]!;
    expect(tube.type).toBe('bodytube');
    expect(tube['outerRadiusAuto']).toBe(false);
    expect(tube['outerRadius']).toBe(0.009);
  });

  // A pod set arrives as PodSet() does: two copies with nothing in them.
  it('adds an empty pod set of two copies', () => {
    const { tree, id } = addPart(makeTree(), 'podset', 'b1');
    const pods = findNode(tree, id)!;
    expect(pods.children ?? []).toHaveLength(0);
    expect(pods['instanceCount']).toBe(2);
  });
});

/**
 * The catalog link follows the kernel's `clearPreset()` callers: an edit through
 * a setter that calls it drops the `<preset>`, any other edit keeps it.
 */
describe('updateNode and the catalog link', () => {
  const LINK = { type: 'x', manufacturer: 'Estes', partNo: 'P1' };
  const kept = (node: Record<string, unknown>, patch: Record<string, unknown>) => {
    const tree = { components: [{ id: 'p', preset: LINK, ...node }] } as unknown as RocketTree;
    const out = updateNode(tree, 'p', patch as Partial<ComponentNode>);
    return findNode(out, 'p')!['preset'] !== undefined;
  };

  it.each([
    // Transition.setForeShoulderRadius / setAftShoulderRadius
    [{ type: 'transition' }, { foreShoulderRadius: 0.01 }],
    [{ type: 'transition' }, { aftShoulderRadius: 0.01 }],
    // NoseCone.setShoulderRadius
    [{ type: 'nosecone' }, { shoulderRadius: 0.01 }],
    // RingComponent.setLength
    [{ type: 'tubecoupler' }, { length: 0.05 }],
    // Parachute.setLineLength with lines
    [{ type: 'parachute', lineCount: 6 }, { lineLength: 0.5 }],
    // Streamer.setStripWidth
    [{ type: 'streamer' }, { stripWidth: 0.06 }],
    // A shoulder grown from 0 seeds its radius through setForeShoulderRadius
    // (Transition.java:514-515), which clears the link (:459)
    [{ type: 'transition' }, { foreShoulderLength: 0.02 }],
    // A shoulder set back to 0 zeroes its radius the same way (Transition.java:502-504)
    [{ type: 'nosecone', shoulderLength: 0.02, shoulderRadius: 0.01 }, { shoulderLength: 0 }],
    // NoseCone.setFlipped moves the base through setForeRadius and setAftRadius
    [{ type: 'nosecone', aftRadius: 0.02 }, { flipped: true }],
    [{ type: 'nosecone', aftRadius: 0.02, flipped: true }, { flipped: false }],
  ])('drops it on %o edited with %o', (node, patch) => {
    expect(kept(node, patch)).toBe(false);
  });

  it.each([
    // RecoveryDevice deployment and MassObject packed size
    [{ type: 'parachute' }, { deployEvent: 'altitude' }],
    [{ type: 'parachute' }, { deployAltitude: 150 }],
    [{ type: 'parachute' }, { deployDelay: 1 }],
    [{ type: 'parachute' }, { length: 0.05 }],
    [{ type: 'parachute' }, { radius: 0.01 }],
    // Parachute.setLineLength on a chute with no lines
    [{ type: 'parachute', lineCount: 0 }, { lineLength: 0.5 }],
    // Transition.setClipped, the shoulder lengths
    [{ type: 'transition' }, { clipped: false }],
    // A shoulder length that does not cross 0, or grows from 0 onto a radius
    // already set, leaves the radius alone (Transition.java:514, :524-525)
    [{ type: 'transition', foreShoulderLength: 0.01, foreShoulderRadius: 0.01 }, { foreShoulderLength: 0.02 }],
    [{ type: 'transition', foreShoulderRadius: 0.01 }, { foreShoulderLength: 0.02 }],
    // A setter given the value it already holds returns before clearPreset():
    // BodyTube.setOuterRadius, RingComponent.setLength, ExternalComponent.setMaterial
    [{ type: 'bodytube', outerRadius: 0.02 }, { outerRadius: 0.02 }],
    [{ type: 'tubecoupler', length: 0.05 }, { length: 0.05 }],
    [
      { type: 'nosecone', materialName: 'Balsa', density: 170 },
      { materialName: 'Balsa', density: 170 },
    ],
    // BodyComponent.setLength, LaunchLug.setLength
    [{ type: 'bodytube' }, { length: 0.3 }],
    [{ type: 'launchlug' }, { length: 0.03 }],
    // Streamer.setStripLength
    [{ type: 'streamer' }, { stripLength: 0.5 }],
  ])('keeps it on %o edited with %o', (node, patch) => {
    expect(kept(node, patch)).toBe(true);
  });

  it('follows the setters these cases are written from', () => {
    const java = (file: string) =>
      readFileSync(
        resolve(process.cwd(), '../engine-java/src/java/info/openrocket/core/rocketcomponent', file),
        'utf8',
      ).replace(/\s+/g, ' ');
    expect(java('BodyTube.java')).toContain('if ((this.outerRadius == radius) && (autoRadius == false)) return;');
    expect(java('RingComponent.java')).toContain('if (this.length == l) return; this.length = l; clearPreset();');
    expect(java('ExternalComponent.java')).toContain('if (material.equals(mat)) return;');
    const transition = java('Transition.java');
    expect(transition).toContain(
      'if (MathUtil.equals(foreShoulderLength,0)){ this.foreShoulderLength = 0; this.setForeShoulderRadius(0);',
    );
    expect(transition).toContain(
      'if (MathUtil.equals(this.getForeShoulderRadius(),0)) { this.setForeShoulderRadius(radius - wallThickness); }',
    );
    expect(transition).toContain(
      'if (MathUtil.equals(this.foreShoulderRadius, foreShoulderRadius)) return; this.foreShoulderRadius = foreShoulderRadius;',
    );
    // A flip moves the base through the radius setters, which clear the link
    // unless the value is unchanged (the 24.12 release's bytecode is the same).
    expect(java('NoseCone.java')).toContain(
      'if (flipped) { setForeRadius(getAftRadius()); setForeRadiusAutomatic(isAftRadiusAutomatic(), sanityCheck);',
    );
    expect(transition).toContain(
      'if ((this.foreRadius == radius) && (autoForeRadius == false)) return; this.autoForeRadius = false;',
    );
  });

  /**
   * An automatic shoulder takes the bore of the tube it plugs. On the desktop
   * that diameter is typed into the shoulder, and `setShoulderRadius` clears
   * the link when the value changes, so turning the flag on is the same edit.
   */
  describe('an automatic shoulder turned on', () => {
    const design = (shoulderRadius: number) =>
      ({
        components: [
          {
            id: 's',
            type: 'stage',
            children: [
              {
                id: 'p',
                type: 'nosecone',
                preset: LINK,
                aftRadius: 0.0125,
                length: 0.1,
                shoulderLength: 0.02,
                shoulderRadius,
                shoulderThickness: 0.001,
                shoulderAuto: false,
              },
              { id: 't', type: 'bodytube', outerRadius: 0.0125, thickness: 0.0005, length: 0.3 },
            ],
          },
        ],
      }) as unknown as RocketTree;

    it('drops the link when the shoulder moves to the bore', () => {
      const out = updateNode(design(0.01), 'p', { shoulderAuto: true });
      const p = findNode(out, 'p')!;
      // The bore it follows: the tube's radius less its wall.
      expect(p['shoulderRadius']).toBeCloseTo(0.0125 - 0.0005, 12);
      expect(p['preset']).toBeUndefined();
    });

    it('keeps the link when the shoulder already sits at the bore', () => {
      const out = updateNode(design(0.012), 'p', { shoulderAuto: true });
      expect(findNode(out, 'p')!['preset']).toEqual(LINK);
    });
  });
});
