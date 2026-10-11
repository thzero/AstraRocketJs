import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { catalogPatch } from '../../../src/services/design/treeEdit';
import { isComponentRow, type Component } from '../../../src/services/parts/componentDb';
import { shapeSelect, stationRadius } from '../../../src/tree/shapeProfile';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { kernelGeometry, loadEngine } from '../../testing/kernelGeometry';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A new shape brings its own parameter and clip.
 *
 * `Transition.setShapeType` resets the shape parameter to the new shape's
 * default and the clip to whether the shape can clip, and `loadFromPreset`
 * sets both for a catalog part. A part that kept the old shape's values would
 * fly and draw another profile: a power series picked over an ogive (1.0) is a
 * straight cone, and an ellipsoid transition over an unclipped one stays
 * unclipped.
 *
 * The reference is the kernel's own part of the new shape: built with no
 * parameter and no clip on record, the bridge leaves both where
 * `setShapeType` puts them. The app's profile of the edited node, and the
 * kernel's build of it, both have to match that profile at every station.
 */

/** Where the clip point is found by iteration on both sides, as in geometryParity. */
const PROFILE_TOL = 1e-4;

/** Parts that each hold a parameter and a clip of a shape other than the one chosen. */
const PRIORS: { shape: string; shapeParameter: number; clipped: boolean }[] = [
  { shape: 'ogive', shapeParameter: 0.4, clipped: false },
  { shape: 'power', shapeParameter: 0.3, clipped: false },
  { shape: 'haack', shapeParameter: 1 / 3, clipped: false },
  { shape: 'parabolic', shapeParameter: 0.75, clipped: false },
  { shape: 'ellipsoid', shapeParameter: 0.9, clipped: false },
];

const SHAPES = ['conical', 'ogive', 'ellipsoid', 'power', 'parabolic', 'haack'];

const catalog = (
  JSON.parse(readFileSync(join(__dirname, '../../../public/data/components.generated.json'), 'utf8')) as {
    components: unknown[];
  }
).components.filter(isComponentRow) as Component[];

/** One catalog row for each nose cone and transition shape the catalog offers. */
const rowsByShape = (type: 'nosecone' | 'transition'): Component[] => {
  const seen = new Map<string, Component>();
  for (const p of catalog) if (p.type === type && 'shape' in p && !seen.has(p.shape)) seen.set(p.shape, p);
  return [...seen.values()];
};

/** The part in a stage, behind a tube for a transition. */
const design = (part: ComponentNode): RocketTree =>
  ({
    name: '',
    components: [
      {
        type: 'stage',
        id: 'st',
        children:
          part.type === 'transition'
            ? [{ type: 'bodytube', id: 'tube', outerRadius: 0.05, length: 0.3, thickness: 0.001 }, part]
            : [part],
      },
    ],
  }) as unknown as RocketTree;

/** The same part with no shape parameter and no clip on record. */
const kernelDefaultOf = (node: ComponentNode): ComponentNode => {
  const out = { ...node };
  delete out['shapeParameter'];
  delete out['clipped'];
  return out;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
function mismatches(engine: any, label: string, node: ComponentNode): string[] {
  const reference = kernelGeometry(engine, design(kernelDefaultOf(node))).get('probe')!;
  const flown = kernelGeometry(engine, design(node)).get('probe')!;
  const profile = reference.profile!;
  expect(profile.length).toBeGreaterThan(2);
  const out: string[] = [];
  for (let i = 0; i < profile.length; i++) {
    const x = (reference.length * i) / (profile.length - 1);
    const want = profile[i]!;
    const drawn = stationRadius(node, x);
    const flies = flown.profile![i]!;
    if (Math.abs(drawn - want) > PROFILE_TOL || Math.abs(flies - want) > PROFILE_TOL) {
      out.push(`${label} at x=${x.toFixed(4)}: drawn ${drawn}, flies ${flies}, kernel ${want}`);
      break;
    }
  }
  return out;
}

describe('a catalog pick over a part of another shape', () => {
  for (const type of ['nosecone', 'transition'] as const)
    it(`gives a ${type} the profile of the part's own shape`, async () => {
      const engine = await loadEngine();
      const rows = rowsByShape(type);
      // Each shape the catalog has, and at least one the stale values change.
      expect(rows.length).toBeGreaterThanOrEqual(3);
      const wrong: string[] = [];
      for (const row of rows)
        for (const prior of PRIORS) {
          const before = { type, id: 'probe', ...prior } as ComponentNode;
          const node = { ...before, ...catalogPatch(row, before) } as ComponentNode;
          wrong.push(
            ...mismatches(
              engine,
              `${row.mfr} ${row.partNo} (${'shape' in row ? row.shape : ''}) over ${prior.shape}`,
              node,
            ),
          );
        }
      expect(wrong).toEqual([]);
    });
});

describe('a shape chosen in the panel over a part of another shape', () => {
  const parts: Record<'nosecone' | 'transition', Partial<ComponentNode>> = {
    nosecone: { length: 0.12, aftRadius: 0.03, thickness: 0.002 },
    transition: { length: 0.08, foreRadius: 0.02, aftRadius: 0.05, thickness: 0.002 },
  };
  for (const type of ['nosecone', 'transition'] as const)
    it(`gives a ${type} the profile of the new shape`, async () => {
      const engine = await loadEngine();
      const wrong: string[] = [];
      for (const shape of SHAPES)
        for (const prior of PRIORS) {
          if (prior.shape === shape) continue;
          const before = { type, id: 'probe', ...parts[type], ...prior } as ComponentNode;
          const node = { ...before, ...shapeSelect(before, shape) } as ComponentNode;
          wrong.push(...mismatches(engine, `${type} ${prior.shape} to ${shape}`, node));
        }
      expect(wrong).toEqual([]);
    });

  it('keeps the parameter and clip when the shape is chosen again', () => {
    const before = { type: 'transition', shape: 'power', shapeParameter: 0.3, clipped: false } as ComponentNode;
    expect(shapeSelect(before, 'power')).toEqual({ shape: 'power' });
  });
});
