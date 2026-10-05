import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import {
  buildPieces,
  exportCamera,
  fitCameraToBox,
  isFittableBox,
  piecesBounds,
  type Piece,
} from '../../../src/components/canvas/Rocket3D';
import { internalExtent } from '../../../src/components/canvas/schematicGeometry';
import { resolveDisc } from '../../../src/services/design/discGeometry';
import { KERNEL_DEFAULTS } from '../../../src/tree/kernelDefaults';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * The export framing, which was extracted to be provable and never proved.
 *
 * `piecesBounds`, `isFittableBox`, `fitCameraToBox` and `exportCamera` all
 * carry doc comments saying they live outside the component precisely so the
 * numbers can be checked without mounting an R3F canvas ("this is where the
 * export framing is actually proven", "Pure so the numbers are provable").
 * There was no `Rocket3D.test.*` at all, and no e2e asserts the framing - so
 * the corner-by-corner fit, the degenerate-`up` nudge and the NaN-box guard
 * were subtle, regression-prone geometry with a stated test rationale and
 * nothing holding them.
 */

const boxOf = (min: [number, number, number], max: [number, number, number]) =>
  new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));

/** A piece-like with a geometry, as `piecesBounds` consumes. */
const piece = (min: [number, number, number], max: [number, number, number]) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([min[0], min[1], min[2], max[0], max[1], max[2]], 3));
  return { geometry: g } as unknown as Parameters<typeof piecesBounds>[0][number];
};

describe('isFittableBox', () => {
  it('accepts a real box', () => {
    expect(isFittableBox(boxOf([-1, -1, -1], [1, 1, 1]))).toBe(true);
  });

  it('rejects an empty box', () => {
    expect(isFittableBox(new THREE.Box3())).toBe(false);
  });

  it('rejects a box poisoned with NaN', () => {
    // The guard exists because a single non-finite vertex anywhere in the
    // model makes the whole fit NaN, and the export then renders nothing.
    const b = boxOf([0, 0, 0], [1, 1, 1]);
    b.max.y = NaN;
    expect(isFittableBox(b)).toBe(false);
  });

  it('rejects a box poisoned with Infinity', () => {
    const b = boxOf([0, 0, 0], [1, 1, 1]);
    b.min.x = -Infinity;
    expect(isFittableBox(b)).toBe(false);
  });
});

describe('piecesBounds', () => {
  it('unions every piece', () => {
    const box = piecesBounds([piece([0, 0, 0], [1, 1, 1]), piece([-2, 0, 0], [0, 3, 0])]);
    expect(box.min.x).toBeCloseTo(-2, 6);
    expect(box.max.y).toBeCloseTo(3, 6);
  });

  it('is empty for no pieces, which isFittableBox then rejects', () => {
    const box = piecesBounds([]);
    expect(isFittableBox(box)).toBe(false);
  });
});

describe('fitCameraToBox', () => {
  const dir = new THREE.Vector3(0, 0, -1); // looking down -Z

  it('keeps the subject centered and the view direction exact', () => {
    const box = boxOf([-1, -1, -1], [1, 1, 1]);
    const { position, target } = fitCameraToBox(box, dir, 50, 16 / 9);
    expect(target.toArray()).toEqual([0, 0, 0]);
    // `back` runs subject -> camera, so the camera sits on +Z looking back.
    expect(position.x).toBeCloseTo(0, 9);
    expect(position.y).toBeCloseTo(0, 9);
    expect(position.z).toBeGreaterThan(0);
  });

  it('actually fits: every corner lands inside the frustum', () => {
    // The real contract. A long thin rocket viewed on a wide aspect is the
    // case a naive "distance from bounding sphere" fit gets wrong.
    const box = boxOf([-0.02, -0.02, -0.5], [0.02, 0.02, 0.5]);
    const fov = 50;
    const aspect = 16 / 9;
    const { position, target } = fitCameraToBox(box, new THREE.Vector3(0, 0, -1), fov, aspect);

    const cam = new THREE.PerspectiveCamera(fov, aspect, 0.001, 1000);
    cam.position.copy(position);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const ndc = new THREE.Vector3(x, y, z).applyMatrix4(vp);
          expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('pulls back further for a narrower frame', () => {
    const box = boxOf([-1, -1, -1], [1, 1, 1]);
    const wide = fitCameraToBox(box, dir, 50, 21 / 9).position.z;
    const narrow = fitCameraToBox(box, dir, 50, 1 / 2).position.z;
    expect(narrow).toBeGreaterThan(wide);
  });

  it('survives a view straight down the up axis', () => {
    // Dead overhead degenerates the cross product; the nudge exists so the
    // result is finite and matches what three's own lookAt would pick.
    const box = boxOf([-1, -1, -1], [1, 1, 1]);
    const { position } = fitCameraToBox(box, new THREE.Vector3(0, -1, 0), 50, 16 / 9);
    expect(position.toArray().every(Number.isFinite)).toBe(true);
    expect(position.length()).toBeGreaterThan(0);
  });

  it('survives a zero-length direction', () => {
    const box = boxOf([-1, -1, -1], [1, 1, 1]);
    const { position } = fitCameraToBox(box, new THREE.Vector3(0, 0, 0), 50, 16 / 9);
    expect(position.toArray().every(Number.isFinite)).toBe(true);
  });

  it('gives a degenerate (zero-size) box a usable distance', () => {
    const { position } = fitCameraToBox(boxOf([0, 0, 0], [0, 0, 0]), dir, 50, 16 / 9);
    expect(position.toArray().every(Number.isFinite)).toBe(true);
    expect(position.length()).toBeGreaterThan(0);
  });
});

describe('exportCamera', () => {
  it('brackets the subject with its near and far planes', () => {
    // Fitting a small rocket pulls the camera well inside the live camera's
    // 0.1 m default near plane, which would export an empty frame.
    const box = boxOf([-0.02, -0.02, -0.05], [0.02, 0.02, 0.05]);
    const src = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    src.position.set(0, 0, 1);
    src.lookAt(0, 0, 0);
    src.updateMatrixWorld();

    const cam = exportCamera(box, src, 16 / 9);
    cam.updateProjectionMatrix();

    const view = box.clone().applyMatrix4(cam.matrixWorldInverse);
    // Camera space looks down -Z: the nearest corner is at -view.max.z.
    expect(cam.near).toBeGreaterThan(0);
    expect(cam.near).toBeLessThanOrEqual(-view.max.z + 1e-9);
    expect(cam.far).toBeGreaterThanOrEqual(-view.min.z - 1e-9);
  });

  it('keeps the source camera untouched', () => {
    const src = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    src.position.set(0, 0, 1);
    src.updateMatrixWorld();
    const before = src.position.clone();
    exportCamera(boxOf([-1, -1, -1], [1, 1, 1]), src, 2);
    expect(src.position.equals(before)).toBe(true);
  });
});

/**
 * The internals build. The airframe and the motor alone are enough for a
 * translucent shell but not for a cutaway: cutting a rocket open to find nothing
 * in it is not a feature. These hold the two things that make the cut worth
 * taking: tubes are hollow, and what the 2D schematic draws inside them is in the
 * 3D build too, at the dimensions the rest of the app agrees on.
 */
const tree = {
  name: 'Section',
  components: [
    {
      type: 'stage',
      name: 'S',
      children: [
        { type: 'nosecone', id: 'nose', shape: 'ogive', length: 0.1, aftRadius: 0.013, thickness: 0.002 },
        {
          type: 'bodytube',
          id: 'body',
          length: 0.3,
          outerRadius: 0.013,
          thickness: 0.001,
          children: [
            { type: 'centeringring', id: 'cr', length: 0.003 },
            { type: 'bulkhead', id: 'bh', length: 0.003 },
            { type: 'tubecoupler', id: 'coupler', length: 0.05, thickness: 0.0005 },
            { type: 'engineblock', id: 'eb', length: 0.005, thickness: 0.00095 },
            { type: 'parachute', id: 'chute', length: 0.04, radius: 0.008 },
            { type: 'innertube', id: 'mount', outerRadius: 0.0095, thickness: 0.0005, length: 0.07 },
          ],
        },
      ],
    },
  ],
} as unknown as RocketTree;

/** A piece's world-space axial span and radial band (rocket axis = +X), with
 *  its position/rotation applied exactly as <mesh> composes them. */
function extent(p: Piece): { x0: number; x1: number; r0: number; r1: number } {
  const r = p.rotation ?? [0, 0, 0];
  const t = p.position ?? [0, 0, 0];
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r[0], r[1], r[2])).setPosition(t[0], t[1], t[2]);
  const attr = p.geometry.getAttribute('position');
  const v = new THREE.Vector3();
  let x0 = Infinity,
    x1 = -Infinity,
    r0 = Infinity,
    r1 = -Infinity;
  for (let i = 0; i < attr.count; i++) {
    v.fromBufferAttribute(attr, i).applyMatrix4(m);
    x0 = Math.min(x0, v.x);
    x1 = Math.max(x1, v.x);
    const rad = Math.hypot(v.y, v.z);
    r0 = Math.min(r0, rad);
    r1 = Math.max(r1, rad);
  }
  return { x0, x1, r0, r1 };
}

const byId = (pieces: Piece[], id: string) => pieces.filter((p) => p.id === id);

describe('buildPieces internals', () => {
  it('builds a body tube as a tube, with its own wall', () => {
    const { pieces } = buildPieces(tree);
    const [body] = byId(pieces, 'body');
    const e = extent(body!);
    // Outer radius out, bore in: a solid cylinder reaches the axis (r0 = 0)
    // and leaves nothing for a section to show.
    expect(e.r1).toBeCloseTo(0.013, 6);
    expect(e.r0).toBeCloseTo(0.012, 6);
    expect(e.x0).toBeCloseTo(0.1, 6);
    expect(e.x1).toBeCloseTo(0.4, 6);
  });

  it('keeps the tube when the wall is thicker than the radius, losing only the bore', () => {
    // A units slip in a hand-edited .ork. The print export returns null here on
    // purpose (a blocked bore must not ship as a part); a VIEW that dropped the
    // tube would just lose the rocket.
    const bad = JSON.parse(JSON.stringify(tree));
    bad.components[0].children[1].thickness = 0.02;
    const [body] = byId(buildPieces(bad as RocketTree).pieces, 'body');
    expect(body).toBeDefined();
    expect(extent(body!).r0).toBeCloseTo(0, 6);
  });

  it('renders every internal the 2D schematic draws', () => {
    const { pieces } = buildPieces(tree);
    for (const id of ['cr', 'bh', 'coupler', 'eb', 'chute', 'mount']) {
      expect(byId(pieces, id).length, `no 3D piece for ${id}`).toBeGreaterThan(0);
    }
  });

  it('sizes a centering ring by the shared resolution, not its own', () => {
    const { pieces } = buildPieces(tree);
    const [ring] = byId(pieces, 'cr');
    const d = resolveDisc(tree, 'cr')!;
    const e = extent(ring!);
    // Outer = the tube's bore, inner = the mount it centers — the same numbers
    // the DXF cut sheet and the printed ring use.
    expect(e.r1).toBeCloseTo(d.outerR, 6);
    expect(e.r0).toBeCloseTo(d.innerR, 6);
    expect(e.r1).toBeCloseTo(0.012, 6);
    expect(e.r0).toBeCloseTo(0.0095, 6);
    expect(e.x1 - e.x0).toBeCloseTo(d.length, 6);
  });

  it('gives a packed chute the extent the 2D view dashes in', () => {
    const { pieces } = buildPieces(tree);
    const [chute] = byId(pieces, 'chute');
    const node = { type: 'parachute', length: 0.04, radius: 0.008 } as unknown as ComponentNode;
    const want = internalExtent(node, 0.013);
    const e = extent(chute!);
    expect(e.r1).toBeCloseTo(want.radius, 6);
    expect(e.x1 - e.x0).toBeCloseTo(want.length, 6);
  });

  it('gives a keyless inner tube the kernel length and radius', () => {
    // ComponentFactory, case "innertube": 70 mm by 9.5 mm. The 3D view drew 50 mm.
    const keyless = {
      name: 'Mount',
      components: [
        {
          type: 'stage',
          name: 'S',
          children: [
            {
              type: 'bodytube',
              id: 'body',
              length: 0.3,
              outerRadius: 0.013,
              thickness: 0.001,
              children: [{ type: 'innertube', id: 'mount' }],
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    const e = extent(byId(buildPieces(keyless).pieces, 'mount')[0]!);
    expect(e.x1 - e.x0).toBeCloseTo(KERNEL_DEFAULTS.innertube.length, 6);
    expect(e.r1).toBeCloseTo(KERNEL_DEFAULTS.innertube.outerRadius, 6);
  });

  it('places every internal inside the tube that holds it', () => {
    const { pieces } = buildPieces(tree);
    for (const id of ['cr', 'bh', 'coupler', 'eb', 'chute', 'mount']) {
      const e = extent(byId(pieces, id)[0]!);
      expect(e.x0, id).toBeGreaterThanOrEqual(0.1 - 1e-9);
      expect(e.r1, id).toBeLessThanOrEqual(0.013 + 1e-9);
    }
  });
});

/**
 * Shoulders in the 3D model.
 *
 * A shoulder round-trips through `.ork`, is editable in the panel, draws in
 * the 2D schematic and is part of the printed solid. The 3D builder was the
 * one place that never read the keys, so the model stopped at the base of the
 * cone - and a shoulder lives INSIDE the tube next door, which is exactly what
 * the cutaway exists to show.
 */
describe('buildPieces shoulders', () => {
  const noseTree = (shoulder: Record<string, number>) =>
    ({
      name: 'Shouldered',
      components: [
        {
          type: 'stage',
          name: 'S',
          children: [
            { type: 'nosecone', id: 'nose', shape: 'ogive', length: 0.1, aftRadius: 0.013, ...shoulder },
            { type: 'bodytube', id: 'body', length: 0.3, outerRadius: 0.013, thickness: 0.001 },
          ],
        },
      ],
    }) as unknown as RocketTree;

  it('carries a nose cone shoulder aft, at the shoulder radius', () => {
    const { pieces } = buildPieces(noseTree({ shoulderLength: 0.03, shoulderRadius: 0.011 }));
    const e = extent(byId(pieces, 'nose')[0]!);
    // 100 mm of cone plus 30 mm of stub reaching into the tube behind it.
    expect(e.x1).toBeCloseTo(0.13, 6);
    // The widest point is still the cone's base, not the stub.
    expect(e.r1).toBeCloseTo(0.013, 6);
  });

  it('draws no stub when the nose cone has no shoulder', () => {
    const { pieces } = buildPieces(noseTree({}));
    expect(extent(byId(pieces, 'nose')[0]!).x1).toBeCloseTo(0.1, 6);
  });

  it('clamps a shoulder wider than the part it steps down from', () => {
    // A slip in a hand-edited file. Revolved as given it is a flange standing
    // proud of the airframe; clamped it is a stub that is merely a tight fit.
    const { pieces } = buildPieces(noseTree({ shoulderLength: 0.03, shoulderRadius: 0.05 }));
    expect(extent(byId(pieces, 'nose')[0]!).r1).toBeCloseTo(0.013, 6);
  });

  it('carries both of a transition shoulders, fore one reaching forward', () => {
    const tree = {
      name: 'Boat tail',
      components: [
        {
          type: 'stage',
          name: 'S',
          children: [
            { type: 'bodytube', id: 'body', length: 0.2, outerRadius: 0.013, thickness: 0.001 },
            {
              type: 'transition',
              id: 'trans',
              shape: 'conical',
              length: 0.05,
              foreRadius: 0.013,
              aftRadius: 0.009,
              foreShoulderLength: 0.02,
              foreShoulderRadius: 0.012,
              aftShoulderLength: 0.015,
              aftShoulderRadius: 0.008,
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    const e = extent(byId(buildPieces(tree).pieces, 'trans')[0]!);
    // The transition starts at x = 0.2; its fore shoulder reaches BACK into the
    // tube ahead of it, and its aft shoulder past its own end.
    expect(e.x0).toBeCloseTo(0.18, 6);
    expect(e.x1).toBeCloseTo(0.265, 6);
  });
});

/**
 * A nose cone, body tube or transition with no `length` key is laid out at the
 * kernel's length for its type (ComponentFactory: nose 70 mm, body 300 mm,
 * transition 50 mm), not at zero. Zero drew the part as nothing while the
 * engine flew it full length. An explicit 0 (the phantom tube a T-tail hangs
 * from) is still 0.
 */
describe('a chain part with no length key', () => {
  it('is laid out at the kernel length for its type', () => {
    const keyless = {
      name: 'K',
      components: [
        {
          type: 'stage',
          name: 'S',
          children: [
            { type: 'nosecone', id: 'nose', shape: 'ogive', aftRadius: 0.013 },
            { type: 'bodytube', id: 'body', length: 0.2, outerRadius: 0.013, thickness: 0.001 },
          ],
        },
      ],
    } as unknown as RocketTree;
    const { pieces } = buildPieces(keyless);
    const nose = extent(byId(pieces, 'nose')[0]!);
    const body = extent(byId(pieces, 'body')[0]!);
    expect(nose.x1 - nose.x0).toBeCloseTo(KERNEL_DEFAULTS.nosecone.length, 6);
    expect(body.x0).toBeCloseTo(KERNEL_DEFAULTS.nosecone.length, 6);
  });
});
