import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TFunction } from 'i18next';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { buildSchematicShapes } from '../../../src/components/canvas/schematicShapes';
import { buildPieces } from '../../../src/components/canvas/rocketPieces';
import { buildAftScene } from '../../../src/components/canvas/AftView';
import { bodyRadiusAt } from '../../../src/tree/finPlanform';
import { assemblyParentRadius, resolveAssemblyRadius } from '../../../src/tree/assembly';

/**
 * A part on the outside of a nose cone or transition stands on the body radius
 * at its own station, as the kernel stands it (`FinSet.getFinFront`,
 * `TubeFinSet.getBodyRadius`), and a fin's root runs along the parent's
 * profile (`FinSet.getRootPoints`). Each view is checked against a conical
 * parent, whose radius has a closed form, so no expected value is copied from
 * the code under test.
 */

/** Scene scale of the 2D schematic here: 1 px per mm, centerline at y = 200. */
const S = 1000;
const CY = 200;
const t = ((k: string) => k) as unknown as TFunction;

const NOSE = { type: 'nosecone', id: 'nose', shape: 'conical', length: 0.1, aftRadius: 0.025 };
const TUBE = { type: 'bodytube', id: 'tube', length: 0.2, outerRadius: 0.025 };
/** A conical boat tail, 25 mm to 15 mm over 60 mm, starting 300 mm aft of the tip. */
const T_START = 0.3;
const T_LEN = 0.06;
const T_FORE = 0.025;
const T_AFT = 0.015;
/** The conical transition's radius at `x` from its fore end. */
const coneR = (x: number) => T_FORE + ((T_AFT - T_FORE) * x) / T_LEN;

const rocket = (transitionChildren: unknown[]): RocketTree =>
  ({
    name: 'T',
    components: [
      {
        type: 'stage',
        id: 'stage',
        children: [
          NOSE,
          TUBE,
          {
            type: 'transition',
            id: 'boat',
            shape: 'conical',
            length: T_LEN,
            foreRadius: T_FORE,
            aftRadius: T_AFT,
            children: transitionChildren,
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

const schematic = (tree: RocketTree) =>
  buildSchematicShapes({
    chain: (tree.components[0]!.children ?? []) as ComponentNode[],
    ctx: { scale: S, cy: CY, x0: 0 },
    scale: S,
    w: 800,
    h: 400,
    roll: 0,
    uid: 't',
    setHoverId: () => {},
  });

/** A polygon's `points` attribute as meters in the rocket frame (y up from the axis). */
const polygonMeters = (nodes: ReactNode[]): [number, number][][] =>
  nodes
    .filter((n): n is ReactElement<{ points: string }> => isValidElement(n) && n.type === 'polygon')
    .map((n) =>
      n.props.points.split(' ').map((pair) => {
        const [x, y] = pair.split(',').map(Number) as [number, number];
        return [x / S, (CY - y) / S];
      }),
    );

/** The distinct (x, y) vertex positions of a mesh, rounded to a micrometer. */
const xyVertices = (geo: THREE.BufferGeometry): [number, number][] => {
  const p = geo.getAttribute('position');
  const seen = new Map<string, [number, number]>();
  for (let i = 0; i < p.count; i++) {
    const x = Math.round(p.getX(i) * 1e6) / 1e6;
    const y = Math.round(p.getY(i) * 1e6) / 1e6;
    seen.set(`${x},${y}`, [x, y]);
  }
  return [...seen.values()];
};

const boxOf = (geo: THREE.BufferGeometry): THREE.Box3 => {
  geo.computeBoundingBox();
  return geo.boundingBox!;
};

describe('a freeform fin on a conical transition', () => {
  // Root 40 mm from 10 mm aft of the transition's fore end, 30 mm tall.
  const FRONT = 0.01;
  const FIN = {
    type: 'freeformfinset',
    id: 'fins',
    finCount: 1,
    thickness: 0.003,
    points: [
      [0, 0],
      [0.02, 0.03],
      [0.04, 0],
    ],
    position: { method: 'top', offset: FRONT },
  };
  const tree = rocket([FIN]);
  const R = coneR(FRONT);
  // The kernel stands the fin on the radius under its front and moves the
  // outline's ends onto the root; on a cone the root is one straight segment.
  const expected: [number, number][] = [
    [T_START + FRONT, R],
    [T_START + FRONT + 0.02, R + 0.03],
    [T_START + FRONT + 0.04, coneR(FRONT + 0.04)],
  ];

  it('is the shared helper radius under its front', () => {
    expect(bodyRadiusAt(tree.components[0]!.children![2]!, FRONT)).toBeCloseTo(R, 12);
  });

  it('is drawn in the schematic with its root on the profile', () => {
    const { overlay } = schematic(tree);
    const fins = polygonMeters(overlay);
    expect(fins).toHaveLength(1);
    const fin = fins[0]!;
    expect(fin).toHaveLength(expected.length);
    fin.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(expected[i]![0], 9);
      expect(y).toBeCloseTo(expected[i]![1], 9);
    });
  });

  it('is built in 3D with its root on the profile', () => {
    const pieces = buildPieces(tree).pieces.filter((p) => p.id === 'fins');
    expect(pieces).toHaveLength(1);
    const verts = xyVertices(pieces[0]!.geometry);
    expect(verts).toHaveLength(expected.length);
    for (const [x, y] of expected) {
      expect(verts.some(([vx, vy]) => Math.abs(vx - x) < 1e-6 && Math.abs(vy - y) < 1e-6)).toBe(true);
    }
  });

  it('stands on the radius under its front in the aft view', () => {
    const fin = buildAftScene(tree.components, undefined, t).outer.find((s) => s.key === 'fins:0');
    expect(fin?.kind).toBe('fin');
    if (fin?.kind !== 'fin') return;
    expect(fin.from).toBeCloseTo(R, 12);
    // Out to the span the kernel reports, `FreeformFinSet.getSpan`
    // (FreeformFinSet.java:428-436): the highest point less the trailing
    // point's depth below the front, which the narrowing cone puts below it.
    expect(fin.to).toBeCloseTo(R + 0.03 - Math.min(coneR(FRONT + 0.04) - R, 0), 12);
  });
});

describe('a fin on a flipped nose cone stands at its base end', () => {
  // A flipped cone is a tail cone: its base is the fore end, so a fin 10 mm
  // from the fore end stands on nearly the full radius, not near the tip.
  const FRONT = 0.01;
  const L = 0.12;
  const BASE = 0.025;
  const tree = (flipped: boolean): RocketTree =>
    ({
      name: 'F',
      components: [
        {
          type: 'stage',
          id: 'stage',
          children: [
            { ...TUBE, id: 'front' },
            {
              type: 'nosecone',
              id: 'tail',
              shape: 'conical',
              length: L,
              aftRadius: BASE,
              flipped,
              children: [
                {
                  type: 'freeformfinset',
                  id: 'fins',
                  finCount: 1,
                  points: [
                    [0, 0],
                    [0.01, 0.02],
                    [0.03, 0],
                  ],
                  position: { method: 'top', offset: FRONT },
                },
              ],
            },
          ],
        },
      ],
    }) as unknown as RocketTree;
  const fromOf = (flipped: boolean) => {
    const fin = buildAftScene(tree(flipped).components, undefined, t).outer.find((s) => s.key === 'fins:0');
    return fin?.kind === 'fin' ? fin.from : NaN;
  };

  it('reads the profile from the base when flipped and from the tip when not', () => {
    expect(fromOf(true)).toBeCloseTo((BASE * (L - FRONT)) / L, 9);
    expect(fromOf(false)).toBeCloseTo((BASE * FRONT) / L, 9);
  });
});

describe('lugs, rail buttons and tube fins on a conical transition', () => {
  const LUG = { type: 'launchlug', id: 'lug', length: 0.02, outerRadius: 0.003, angleOffset: 0 };
  const BUTTON = { type: 'railbutton', id: 'button', outerDiameter: 0.008, height: 0.006, angleOffset: 0 };
  const TUBES = { type: 'tubefinset', id: 'tubes', finCount: 1, length: 0.03, outerRadius: 0.004 };
  const tree = rocket([
    { ...LUG, position: { method: 'top', offset: 0.01 } },
    { ...BUTTON, position: { method: 'top', offset: 0.03 } },
    { ...TUBES, position: { method: 'top', offset: 0.02 } },
  ]);
  const rLug = coneR(0.01);
  const rButton = coneR(0.03);
  const rTubes = coneR(0.02);

  it('stand on the radius at their own station in the schematic', () => {
    const { extents } = schematic(tree);
    // The lug and the button stand straight up (angle 0): their box runs from
    // the surface out by their own size.
    expect(extents.get('lug')!.box.y1).toBeCloseTo(CY - rLug * S, 9);
    expect(extents.get('lug')!.box.y0).toBeCloseTo(CY - (rLug + 2 * LUG.outerRadius) * S, 9);
    expect(extents.get('button')!.box.y1).toBeCloseTo(CY - rButton * S, 9);
    expect(extents.get('tubes')!.box.y0).toBeCloseTo(CY - (rTubes + 2 * TUBES.outerRadius) * S, 9);
  });

  it('stand on the radius at their own station in 3D', () => {
    const { pieces } = buildPieces(tree);
    expect(pieces.find((p) => p.id === 'lug')!.position![1]).toBeCloseTo(rLug + LUG.outerRadius, 12);
    expect(pieces.find((p) => p.id === 'button')!.position![1]).toBeCloseTo(rButton + BUTTON.height / 2, 12);
    const tube = boxOf(pieces.find((p) => p.id === 'tubes')!.geometry);
    expect(tube.min.y).toBeCloseTo(rTubes, 6);
    expect(tube.max.y).toBeCloseTo(rTubes + 2 * TUBES.outerRadius, 6);
  });

  it('stand on the radius at their own station in the aft view', () => {
    const { outer } = buildAftScene(tree.components, undefined, t);
    const dist = (key: string) => {
      const s = outer.find((o) => o.key === key)!;
      return Math.hypot(s.y, s.z);
    };
    expect(dist('lug:0')).toBeCloseTo(rLug + LUG.outerRadius, 12);
    // A button seen from behind reaches from the surface by its height.
    const button = outer.find((o) => o.key === 'button:0')!;
    expect(button.kind === 'fin' ? [button.from, button.to] : null).toEqual([
      expect.closeTo(rButton, 12),
      expect.closeTo(rButton + BUTTON.height, 12),
    ]);
    expect(dist('tubes:0')).toBeCloseTo(rTubes + TUBES.outerRadius, 12);
  });
});

describe('a pod on a nose cone', () => {
  // The kernel adds a pod parent's radius only for a body tube, so a pod on a
  // nose cone sits at its offset plus its own radius from the axis.
  const OFFSET = 0.01;
  const POD_R = 0.008;
  const pod = {
    type: 'podset',
    id: 'pod',
    instanceCount: 1,
    angleOffset: 0,
    radiusMethod: 'relative',
    radiusOffset: OFFSET,
    position: { method: 'top', offset: 0.05 },
    children: [{ type: 'bodytube', id: 'pod-tube', length: 0.04, outerRadius: POD_R }],
  };
  const nose = { ...NOSE, children: [pod] };
  const tree = {
    name: 'P',
    components: [{ type: 'stage', id: 'stage', children: [nose, TUBE] }],
  } as unknown as RocketTree;
  const center = OFFSET + POD_R;

  it('is placed from assemblyParentRadius', () => {
    expect(assemblyParentRadius(nose as unknown as ComponentNode)).toBe(0);
    expect(resolveAssemblyRadius(pod as unknown as ComponentNode, 0)).toBeCloseTo(center, 12);
  });

  it('draws at that radius in the schematic', () => {
    const box = schematic(tree).extents.get('pod-tube')!.box;
    expect(box.y0).toBeCloseTo(CY - (center + POD_R) * S, 9);
    expect(box.y1).toBeCloseTo(CY - (center - POD_R) * S, 9);
  });

  it('builds at that radius in 3D', () => {
    const box = boxOf(buildPieces(tree).pieces.find((p) => p.id === 'pod-tube')!.geometry);
    expect(box.min.y).toBeCloseTo(center - POD_R, 6);
    expect(box.max.y).toBeCloseTo(center + POD_R, 6);
  });

  it('rings the axis at that radius in the aft view', () => {
    // The first pod instance's tube; each instance keys its parts by instance.
    const hull = buildAftScene(tree.components, undefined, t).hulls.find((h) => h.key.startsWith('pod-tube:0'))!;
    expect(Math.hypot(hull.y, hull.z)).toBeCloseTo(center, 12);
  });
});
