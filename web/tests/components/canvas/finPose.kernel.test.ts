// @vitest-environment node
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import * as THREE from 'three';
import { buildPieces } from '../../../src/components/canvas/rocketPieces';
import { buildSchematicShapes } from '../../../src/components/canvas/schematicShapes';
import { buildAftScene } from '../../../src/components/canvas/AftView';
import { syncDerived } from '../../../src/services/design/treeEdit';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { kernelGeometry, loadEngine, walkTree, type KernelGeometry } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * Each fin, lug, rail button and cluster tube where the kernel puts it, in the
 * side, aft and 3D views, inside pods and boosters (nested too) and canted.
 *
 * The kernel places every instance as translate(offset) then
 * `getAxialRotation(angle)` and hands that transform to every child
 * (FlightConfiguration.java:466-485): a pod's or booster's instance angle
 * (`PodSet.getInstanceAngles`, `ParallelStage.getInstanceAngles`) turns
 * everything in it. A fin is turned by its cant about the middle of its root,
 * `rotate_y(cant)` (FinSet.java:1783-1791, Transformation.java:279-287), then by
 * its own instance angle, `rotate_x` (Transformation.java:263-271). That
 * composition is written out below from the Java ({@link place}); every number
 * it is fed (outline points, root chord, radii, counts, angles, cant, cluster
 * places, stations) is read from the kernel through the bridge.
 */

const S = 1000;
const CY = 300;
const t = ((k: string) => k) as unknown as TFunction;

type P3 = [number, number, number];

/** The kernel's frame turned about the axis, `Transformation.rotate_x`. */
const rotX = (a: number, [x, y, z]: P3): P3 => [
  x,
  y * Math.cos(a) - z * Math.sin(a),
  y * Math.sin(a) + z * Math.cos(a),
];

/**
 * A fin point `(x, y, z)` in its own frame placed in its parent's frame, as
 * `FinSet.getInstanceOffsets` composes it: `localCantRotation`, a translate to
 * the root's middle around `rotate_y(cant)`, applied to the point raised by
 * the body radius, then `rotate_x(angle)`.
 */
function place(x: number, y: number, z: number, front: number, R: number, chord: number, cant: number, a: number): P3 {
  const c = chord / 2;
  const px = x - c;
  const py = R + y;
  // rotate_y: [[cos, 0, sin], [0, 1, 0], [-sin, 0, cos]]
  const cx = Math.cos(cant) * px + Math.sin(cant) * z + c;
  const cz = -Math.sin(cant) * px + Math.cos(cant) * z;
  const [, ry, rz] = rotX(a, [0, py, cz]);
  return [front + cx, ry, rz];
}

const FIN = (id: string, extra: Record<string, unknown>) => ({
  type: 'trapezoidfinset',
  id,
  rootChord: 0.06,
  tipChord: 0.03,
  sweep: 0.025,
  height: 0.04,
  thickness: 0.004,
  position: { method: 'bottom', offset: 0 },
  ...extra,
});

const tree: RocketTree = syncDerived({
  name: 'poses',
  components: [
    {
      type: 'stage',
      id: 's',
      children: [
        { type: 'nosecone', id: 'n', length: 0.12, aftRadius: 0.03, thickness: 0.002 },
        {
          type: 'bodytube',
          id: 'b',
          length: 0.5,
          outerRadius: 0.03,
          thickness: 0.001,
          children: [
            FIN('mf', { finCount: 4, rotation: 0.2, cant: 0.12 }),
            {
              type: 'freeformfinset',
              id: 'mff',
              finCount: 2,
              rotation: 1.3,
              cant: -0.07,
              thickness: 0.003,
              points: [
                [0, 0],
                [0.02, 0.035],
                [0.045, 0.03],
                [0.05, 0],
              ],
              position: { method: 'top', offset: 0.1 },
            },
            {
              type: 'podset',
              id: 'pod',
              instanceCount: 3,
              angleOffset: 0.4,
              radiusOffset: 0.03,
              position: { method: 'top', offset: 0.15 },
              children: [
                { type: 'nosecone', id: 'pn', length: 0.05, aftRadius: 0.012, thickness: 0.001 },
                {
                  type: 'bodytube',
                  id: 'pb',
                  length: 0.2,
                  outerRadius: 0.012,
                  thickness: 0.0005,
                  children: [
                    FIN('pf', { finCount: 3, rotation: 0.3, cant: -0.1, height: 0.02 }),
                    FIN('pu', { finCount: 2, rotation: 0.9, height: 0.015, position: { method: 'top', offset: 0 } }),
                    {
                      type: 'launchlug',
                      id: 'pl',
                      length: 0.03,
                      outerRadius: 0.003,
                      thickness: 0.0005,
                      angleOffset: 1.0,
                      position: { method: 'top', offset: 0.05 },
                    },
                    {
                      type: 'innertube',
                      id: 'pm',
                      length: 0.05,
                      outerRadius: 0.004,
                      thickness: 0.0005,
                      cluster: 'double',
                      clusterRotation: 0.2,
                      position: { method: 'bottom', offset: 0 },
                    },
                    {
                      type: 'podset',
                      id: 'pod2',
                      instanceCount: 2,
                      angleOffset: 0.7,
                      radiusOffset: 0.01,
                      position: { method: 'top', offset: 0.08 },
                      children: [
                        {
                          type: 'bodytube',
                          id: 'p2b',
                          length: 0.08,
                          outerRadius: 0.006,
                          thickness: 0.0005,
                          children: [FIN('p2f', { finCount: 3, rotation: 0.1, height: 0.01, rootChord: 0.03 })],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: 'parallelstage',
              id: 'boo',
              instanceCount: 2,
              angleOffset: 1.1,
              position: { method: 'bottom', offset: 0 },
              children: [
                { type: 'nosecone', id: 'bn', length: 0.06, aftRadius: 0.015, thickness: 0.001 },
                {
                  type: 'bodytube',
                  id: 'bb',
                  length: 0.25,
                  outerRadius: 0.015,
                  thickness: 0.0005,
                  children: [
                    {
                      type: 'ellipticalfinset',
                      id: 'bf',
                      finCount: 3,
                      rotation: 0.5,
                      cant: 0.05,
                      rootChord: 0.05,
                      height: 0.03,
                      thickness: 0.003,
                      position: { method: 'bottom', offset: 0 },
                    },
                    {
                      type: 'railbutton',
                      id: 'br',
                      angleOffset: 2.0,
                      position: { method: 'top', offset: 0.05 },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
} as unknown as RocketTree);

let kernel: Map<string, KernelGeometry> | undefined;
const kernelOf = async () => (kernel ??= kernelGeometry(await loadEngine(), tree, { fields: true }));
const num = (k: KernelGeometry, key: string): number => {
  const v = k.fields?.[key];
  expect(typeof v, key).toBe('number');
  return v as number;
};

/** The parent chain of every node, nearest first. */
const parents = new Map(walkTree(tree).map((v) => [v.id, v.parent]));
const ancestors = (id: string): ComponentNode[] => {
  const out: ComponentNode[] = [];
  for (let p = parents.get(id); p; p = parents.get(p.id ?? '')) out.push(p);
  return out;
};

/**
 * Every frame a part sits in: one per combination of the instances of the pods
 * and boosters above it, as the axis of that frame in the rocket frame
 * (`[y, z]`), its turn about the axis, and the copy suffix the aft view keys
 * its shapes with. Composed outermost first as FlightConfiguration.java:466-485
 * composes it.
 */
interface Frame {
  axis: [number, number];
  turn: number;
  copy: string;
}
async function framesOf(id: string): Promise<Frame[]> {
  const k = await kernelOf();
  let frames: Frame[] = [{ axis: [0, 0], turn: 0, copy: '' }];
  for (const a of ancestors(id).reverse()) {
    if (a.type !== 'podset' && a.type !== 'parallelstage') continue;
    const ka = k.get(a.id!)!;
    const count = num(ka, 'instanceCount');
    const r = num(ka, 'instanceRadius');
    frames = frames.flatMap((f) =>
      Array.from({ length: count }, (_, i) => {
        // PodSet.getInstanceAngles / ParallelStage.getInstanceAngles.
        const angle = num(ka, 'angleOffset') + (2 * Math.PI * i) / count;
        const [, oy, oz] = rotX(f.turn, [0, r * Math.cos(angle), r * Math.sin(angle)]);
        return {
          axis: [f.axis[0] + oy, f.axis[1] + oz] as [number, number],
          turn: f.turn + angle,
          copy: `${f.copy}/${a.id}#${i}`,
        };
      }),
    );
  }
  return frames;
}

/**
 * Every fin of a set, each as the kernel's outline points placed in the rocket
 * frame at the face offset `z`, with the fin's index, the frame's copy suffix
 * and the fin's whole turn.
 */
async function finsOf(id: string, z = 0) {
  const k = await kernelOf();
  const kf = k.get(id)!;
  const parent = parents.get(id)!;
  const kp = k.get(parent.id!)!;
  const count = num(kf, 'finCount');
  const cant = num(kf, 'cant');
  const R = kp.outerRadius!;
  const chord = kf.length;
  // The fin set is placed `bottom` or `top` on a body tube: its front from the
  // tube's own front and length, both the kernel's.
  const pos = findNode(id)!.position as { method: string; offset: number } | undefined;
  const front = pos?.method === 'top' ? kp.positionX! + pos.offset : kp.positionX! + kp.length - chord;
  // The kernel's station of the set is its first fin's turned origin, (0, R, 0)
  // under the cant: a check that the cant turns about the root's middle.
  expect(kf.positionX!).toBeCloseTo(place(0, 0, 0, front, R, chord, cant, 0)[0], 9);
  const pts = kf.finPoints!.map(([x, y]) => [x!, y!] as const);
  const out: { j: number; copy: string; angle: number; points: P3[] }[] = [];
  for (const f of await framesOf(id)) {
    for (let j = 0; j < count; j++) {
      // FinSet.getInstanceAngles: the base rotation plus j turns of 2π/count.
      const angle = f.turn + num(kf, 'rotation') + (2 * Math.PI * j) / count;
      out.push({
        j,
        copy: f.copy,
        angle,
        points: pts.map(([x, y]) => {
          const [px, py, pz] = place(x, y, z, front, R, chord, cant, angle);
          return [px, f.axis[0] + py, f.axis[1] + pz];
        }),
      });
    }
  }
  return { out, count, cant, thickness: num(kf, 'thickness') };
}

const findNode = (id: string): ComponentNode | undefined => walkTree(tree).find((v) => v.id === id)?.node;

const near = (a: readonly number[], b: readonly number[], tol = 1e-6) => a.every((v, i) => Math.abs(v - b[i]!) < tol);

const FIN_SETS = ['mf', 'mff', 'pf', 'pu', 'p2f', 'bf'];

describe('the 3D view places every fin as the kernel does', () => {
  it.each(FIN_SETS)('%s', async (id) => {
    const { out, thickness } = await finsOf(id, 0);
    const pieces = buildPieces(tree).pieces.filter((p) => p.id === id);
    expect(pieces).toHaveLength(out.length);
    const verts = pieces.map((p) => {
      const a = p.geometry.getAttribute('position');
      return Array.from({ length: a.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(a, i).toArray());
    });
    for (const face of [thickness / 2, -thickness / 2]) {
      const { out: placed } = await finsOf(id, face);
      for (const fin of placed) {
        const hit = verts.some((vs) => fin.points.every((p) => vs.some((v) => near(v, p))));
        expect(hit, `${id} fin ${fin.j}${fin.copy}`).toBe(true);
      }
    }
  });
});

/** The points of every polygon in an SVG list, in rocket meters (x, y up). */
const polygons = (nodes: ReactNode[]): [number, number][][] =>
  nodes
    .filter((n): n is ReactElement<{ points: string }> => isValidElement(n) && n.type === 'polygon')
    .map((n) =>
      n.props.points.split(' ').map((pair) => {
        const [x, y] = pair.split(',').map(Number) as [number, number];
        return [x / S, (CY - y) / S] as [number, number];
      }),
    );

describe('the side view projects every fin as the kernel places it', () => {
  // Rolled, so every fin is drawn, as an outline: the roll turns the whole
  // rocket about its axis, a rotate_x of its own.
  const ROLL = 0.25;
  const side = () =>
    buildSchematicShapes({
      chain: tree.components[0]!.children ?? [],
      ctx: { scale: S, cy: CY, x0: 0 },
      scale: S,
      w: 1200,
      h: 600,
      roll: ROLL,
      uid: 't',
      setHoverId: () => {},
    });

  it.each(FIN_SETS)('%s', async (id) => {
    const { out } = await finsOf(id);
    const drawn = polygons(side().wires);
    for (const fin of out) {
      const want = fin.points.map((p) => {
        const [x, y] = rotX(ROLL, p);
        return [x, y] as const;
      });
      const hit = drawn.some((poly) => want.every((w) => poly.some((p) => near(p, w))));
      expect(hit, `${id} fin ${fin.j}${fin.copy}`).toBe(true);
    }
  });
});

describe('the aft view draws every fin as the kernel places it', () => {
  const scene = () => buildAftScene(tree.components, undefined, t).outer;
  /** A kernel-frame point in the aft view's frame: turned +π/2, so 0° is up. */
  const aft = ([, y, z]: P3): [number, number] => [-z, y];
  /** An angle difference brought into (-π, π]. */
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

  it.each(FIN_SETS)('%s', async (id) => {
    const { out, cant, thickness } = await finsOf(id, 0);
    const shapes = scene();
    if (cant === 0) {
      const frames = await framesOf(id);
      for (const fin of out) {
        const s = shapes.find((x) => x.key === `${id}:${fin.j}${fin.copy}`);
        expect(s?.kind, `${id} fin ${fin.j}${fin.copy}`).toBe('fin');
        if (s?.kind !== 'fin') continue;
        expect(wrap(s.angle - Math.PI / 2 - fin.angle)).toBeCloseTo(0, 9);
        const axis = frames.find((f) => f.copy === fin.copy)!.axis;
        expect([s.y, s.z]).toEqual([expect.closeTo(-axis[1], 9), expect.closeTo(axis[0], 9)]);
      }
      return;
    }
    // Canted: the face the cant turns toward the viewer, at +sign(cant)·t/2.
    const { out: faces } = await finsOf(id, Math.sign(cant) * (thickness / 2));
    for (const fin of faces) {
      const s = shapes.find((x) => x.key === `${id}:${fin.j}${fin.copy}:0`);
      expect(s?.kind, `${id} fin ${fin.j}${fin.copy}`).toBe('poly');
      if (s?.kind !== 'poly') continue;
      for (const p of fin.points)
        expect(
          s.points.some((q) => near(q, aft(p))),
          `${id} ${fin.j}${fin.copy}`,
        ).toBe(true);
    }
  });

  it('turns a lug, a rail button and a cluster with the pod or booster they sit in', async () => {
    const k = await kernelOf();
    const shapes = buildAftScene(tree.components, undefined, t);
    const all = [...shapes.outer, ...shapes.inner];
    // A lug and a rail button stand at their own angle in the instance's frame.
    for (const id of ['pl', 'br']) {
      const angle = num(k.get(id)!, 'angleOffset');
      for (const f of await framesOf(id)) {
        const s = all.find((x) => x.key === `${id}:0${f.copy}`)!;
        expect(s, `${id}${f.copy}`).toBeDefined();
        const [ay, az] = [-f.axis[1], f.axis[0]];
        const dir =
          s.kind === 'fin'
            ? s.angle
            : Math.atan2(s.kind === 'circle' ? s.z - az : 0, s.kind === 'circle' ? s.y - ay : 0);
        expect(wrap(dir - Math.PI / 2 - f.turn - angle), `${id}${f.copy}`).toBeCloseTo(0, 9);
      }
    }
    // Each cluster tube at InnerTube.getInstanceOffsets, turned by the instance.
    const places = k.get('pm')!.clusterPoints!;
    expect(places).toHaveLength(2);
    for (const f of await framesOf('pm')) {
      places.forEach(([y, z], i) => {
        const [, ry, rz] = rotX(f.turn, [0, y, z]);
        const s = all.find((x) => x.key === `pm:${i}${f.copy}`);
        expect(s?.kind, `pm ${i}${f.copy}`).toBe('circle');
        if (s?.kind !== 'circle') return;
        expect(s.y).toBeCloseTo(-(f.axis[1] + rz), 9);
        expect(s.z).toBeCloseTo(f.axis[0] + ry, 9);
      });
    }
  });
});
