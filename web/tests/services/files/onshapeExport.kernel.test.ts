// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentInfo, RocketTree } from '../../../src/engine/openRocketEngine';
import { importOrk } from '../../../src/services/files/orkFile';
import { exportOnshape, type OnshapeComponent } from '../../../src/services/files/onshapeExport';
import { kernelGeometry, loadEngine, type KernelGeometry } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * The Onshape payload describes the rocket the kernel flies.
 *
 * Each shipped example is built in the kernel and exported, and every number
 * the feature builds a part from is checked against the kernel's own: where
 * each part starts (`getComponentInfo`), the resolved radii, fin outlines,
 * cluster and pod placements (`getComponentGeometry`), and the volume of each
 * nose cone and transition section, which at the part's density has to weigh
 * what the kernel weighs it at.
 */

const EXAMPLES = [
  'a-simple-model-rocket.ork',
  '3d-printable-nose-cone-and-fins.ork',
  'clustered-motors.ork',
  'dual-parachute-deployment.ork',
  'parallel-booster-staging.ork',
  'pods-airframes-and-winglets.ork',
  'three-stage-low-power-rocket.ork',
  'tube-fin-rocket.ork',
  'two-stage-high-power-rocket.ork',
];

const load = (file: string): RocketTree => {
  const bytes = readFileSync(resolve(process.cwd(), 'public/examples', file));
  return importOrk(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer).tree;
};

/** The kernel's figures in the shape the store hands the exporter. */
const figuresOf =
  (k: Map<string, KernelGeometry>) =>
  (id: string): ComponentInfo | undefined => {
    const g = k.get(id);
    return g ? ({ mass: g.mass, length: g.settledLength, positionX: g.positionX } as ComponentInfo) : undefined;
  };

/** A payload part with its rocket-frame front, laid out as the feature's `resolveTransform` lays it. */
interface Placed {
  comp: OnshapeComponent;
  start: number;
}

function place(stages: OnshapeComponent[]): Placed[] {
  const out: Placed[] = [];
  const visit = (kids: OnshapeComponent[], parentStart: number) => {
    let chained = parentStart;
    for (const c of kids) {
      const p = c.params as { length?: number; rootChord?: number; packedLength?: number };
      const length = p.length ?? p.rootChord ?? p.packedLength ?? 0;
      const start = c.position.axialMethod === 'after' ? chained : parentStart + c.position.axialOffset;
      if (c.position.axialMethod === 'after') chained += length;
      out.push({ comp: c, start });
      visit(c.children, start);
    }
  };
  visit(stages, 0);
  return out;
}

/** The kernel id a cluster copy was made from. */
const sourceId = (id: string): string => id.replace(/-cluster\d+(\.\d+)*$/, '');

/**
 * `2π ∬ r dA` over the closed section: the outer outline fore to aft, then the
 * bore back aft to fore, by Green's theorem one segment at a time.
 */
function revolvedVolume(outer: [number, number][], inner: [number, number][]): number {
  const ring = [...outer, ...[...inner].reverse()];
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [r1, y1] = ring[i]!;
    const [r2, y2] = ring[(i + 1) % ring.length]!;
    sum += ((y2 - y1) * (r1 * r1 + r1 * r2 + r2 * r2)) / 6;
  }
  return 2 * Math.PI * Math.abs(sum);
}

interface Section {
  profile: [number, number][];
  innerProfile: [number, number][];
}

describe.each(EXAMPLES)('the Onshape payload of %s', (file) => {
  const setup = async () => {
    const tree = load(file);
    const k = kernelGeometry(await loadEngine(), tree, { fields: true });
    const { payload } = exportOnshape({ name: 'x', tree, figures: figuresOf(k) });
    return { k, placed: place(payload.rocket.components) };
  };

  it('starts every part where the kernel does', async () => {
    const { k, placed } = await setup();
    let checked = 0;
    for (const { comp, start } of placed) {
      if (comp.type === 'stage') continue;
      const kx = k.get(sourceId(comp.id))?.positionX;
      if (kx === undefined) continue;
      expect(start, `${comp.name} (${comp.type})`).toBeCloseTo(kx, 9);
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('weighs each nose cone and transition at the kernel mass', async () => {
    const { k, placed } = await setup();
    let checked = 0;
    for (const { comp } of placed) {
      if (comp.type !== 'nosecone' && comp.type !== 'transition') continue;
      if (comp.overrideMass !== undefined || !comp.material) continue;
      const p = comp.params as unknown as Section & { shoulderProfile: { fore: Section | null; aft: Section | null } };
      const sections = [p, p.shoulderProfile.fore, p.shoulderProfile.aft].filter((s): s is Section => s !== null);
      const volume = sections.reduce((v, s) => v + revolvedVolume(s.profile, s.innerProfile), 0);
      const kernel = k.get(comp.id)!.mass!;
      expect(Math.abs(volume * comp.material.density - kernel) / kernel, comp.name).toBeLessThan(1e-3);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('rolls every fin set, lug, rail button and pod as the kernel does', async () => {
    const { k, placed } = await setup();
    for (const { comp } of placed) {
      const fields = k.get(sourceId(comp.id))?.fields;
      if (!fields) continue;
      const key = comp.type.endsWith('finset') ? 'rotation' : 'angleOffset';
      const roll = fields[key];
      if (typeof roll !== 'number') continue;
      const label = `${comp.name} (${comp.type})`;
      expect(comp.position.angleOffset, label).toBeCloseTo(roll, 9);
      if (comp.type !== 'podset' && comp.type !== 'parallelstage')
        expect(comp.position.angleMethod, label).toBe('relative');
    }
  });

  it('sizes every part as the kernel resolves it', async () => {
    const { k, placed } = await setup();
    for (const { comp } of placed) {
      const g = k.get(sourceId(comp.id));
      if (!g) continue;
      const p = comp.params as Record<string, unknown>;
      const label = `${comp.name} (${comp.type})`;
      switch (comp.type) {
        case 'bodytube':
        case 'innertube':
        case 'tubecoupler':
        case 'centeringring':
        case 'bulkhead':
        case 'engineblock':
        case 'tubefinset':
          expect(p['outerRadius'], label).toBeCloseTo(g.outerRadius!, 9);
          if (comp.type !== 'tubefinset' && comp.type !== 'bodytube')
            expect(p['innerRadius'], label).toBeCloseTo(g.innerRadius!, 9);
          break;
        case 'nosecone':
        case 'transition':
          expect(p['foreRadius'], label).toBeCloseTo(g.foreRadius!, 9);
          expect(p['aftRadius'], label).toBeCloseTo(g.aftRadius!, 9);
          break;
        case 'railbutton':
          expect(p['outerDiameter'], label).toBeCloseTo(g.outerDiameter!, 9);
          expect(p['innerDiameter'], label).toBeCloseTo(g.innerDiameter!, 9);
          expect(p['totalHeight'], label).toBeCloseTo(g.totalHeight!, 9);
          break;
        case 'parachute':
        case 'streamer':
        case 'shockcord':
        case 'masscomponent':
          expect(p['packedLength'], label).toBeCloseTo(g.settledLength!, 9);
          expect(p['packedRadius'], label).toBeCloseTo(g.radius!, 9);
          if (comp.material) {
            const r = p['packedRadius'] as number;
            const volume = Math.PI * r * r * (p['packedLength'] as number);
            expect(comp.material.density * volume, label).toBeCloseTo(g.mass!, 9);
          }
          break;
        case 'podset':
        case 'parallelstage':
          expect(comp.position.radiusMethod, label).toBe('free');
          expect(comp.position.radiusOffset, label).toBeCloseTo(g.instanceRadius!, 9);
          break;
        default:
          break;
      }
      if (comp.type !== 'stage') expect(comp.mass, label).toBe(g.mass);
    }
  });

  it('outlines every fin as the kernel does', async () => {
    const { k, placed } = await setup();
    for (const { comp } of placed) {
      if (!['trapezoidfinset', 'ellipticalfinset', 'freeformfinset'].includes(comp.type)) continue;
      const p = comp.params as { planform?: [number, number][]; points?: [number, number][] };
      const outline = p.planform ?? p.points!;
      const kernel = k.get(comp.id)!.finPoints!;
      expect(outline.length, comp.name).toBe(kernel.length);
      outline.forEach(([x, y], i) => {
        expect(x, `${comp.name} point ${i}`).toBeCloseTo(kernel[i]![0]!, 9);
        expect(y, `${comp.name} point ${i}`).toBeCloseTo(kernel[i]![1]!, 9);
      });
    }
  });

  it('puts each tube of a cluster where the kernel does', async () => {
    const { k, placed } = await setup();
    const copies = new Map<string, [number, number][]>();
    for (const { comp } of placed) {
      if (comp.type !== 'innertube') continue;
      const { radialPosition: r, radialDirection: d } = comp.position;
      const id = sourceId(comp.id);
      copies.set(id, [...(copies.get(id) ?? []), [r * Math.cos(d), r * Math.sin(d)]]);
    }
    for (const [id, points] of copies) {
      const kernel = k.get(id)!.clusterPoints!;
      expect(points.length, id).toBe(kernel.length);
      for (const [y, z] of kernel) {
        expect(
          points.some(([py, pz]) => Math.abs(py - y) < 1e-9 && Math.abs(pz - z) < 1e-9),
          `${id}: (${y}, ${z})`,
        ).toBe(true);
      }
    }
  });
});
