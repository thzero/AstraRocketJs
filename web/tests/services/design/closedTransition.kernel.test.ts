// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { catalogPatch, defaultNode } from '../../../src/services/design/treeEdit';
import { badDimensions } from '../../../src/services/design/requiredComponent';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import type { Component } from '../../../src/services/parts/componentDb';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { kernelGeometry, loadEngine } from '../../testing/kernelGeometry';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A transition that closes to a point at one end is a part the kernel builds
 * and flies, so the run check lets it through. So is one closed at both ends,
 * which the kernel builds with no volume.
 */
const design = (transition: ComponentNode): RocketTree =>
  ({
    components: [
      {
        type: 'stage',
        id: 's',
        children: [
          { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.0125, thickness: 0.001 },
          { type: 'bodytube', id: 'b', length: 0.3, outerRadius: 0.0125, thickness: 0.0003 },
          { ...transition, id: 't' },
        ],
      },
    ],
  }) as unknown as RocketTree;

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
const flies = (engine: any, tree: RocketTree): { mass: number; cg: number; error?: string } => {
  engine.reset();
  return JSON.parse(engine.getStaticInfo(engine.buildRocket(JSON.stringify(tree)))) as {
    mass: number;
    cg: number;
    error?: string;
  };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('a transition with one end at 0', () => {
  it('is a typed tail cone the kernel flies and the run check passes', async () => {
    const tree = design({
      ...defaultNode('transition'),
      length: 0.05,
      foreRadius: 0.0125,
      foreRadiusAuto: false,
      aftRadius: 0,
      aftRadiusAuto: false,
      thickness: 0.001,
    });
    const engine = await loadEngine();
    const k = kernelGeometry(engine, tree).get('t')!;
    expect(k.foreRadius).toBeCloseTo(0.0125, 12);
    expect(k.aftRadius).toBe(0);
    const info = flies(engine, tree);
    expect(info.error).toBeUndefined();
    expect(info.mass).toBeGreaterThan(0);
    expect(badDimensions(tree)).toEqual([]);
  });

  it('is the SEMROC BC-08542 [R] catalog part, picked as the catalog states it', async () => {
    const rows = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/components.generated.json'), 'utf8'))
      .components as (Component & { partNo: string })[];
    const row = rows.find((r) => r.type === 'transition' && r.partNo === 'BC-08542 [R]')!;
    const node = { ...defaultNode('transition'), ...catalogPatch(row, defaultNode('transition')) } as ComponentNode;
    expect(node['foreRadius']).toBe(0);
    const tree = design(node);
    const engine = await loadEngine();
    expect(kernelGeometry(engine, tree).get('t')!.foreRadius).toBe(0);
    expect(flies(engine, tree).error).toBeUndefined();
    expect(badDimensions(tree)).toEqual([]);
  });

  it('lets a transition with both ends at 0 through, as the kernel builds it', async () => {
    const tree = design({
      ...defaultNode('transition'),
      foreRadius: 0,
      foreRadiusAuto: false,
      aftRadius: 0,
      aftRadiusAuto: false,
    });
    const engine = await loadEngine();
    expect(flies(engine, tree).error).toBeUndefined();
    expect(badDimensions(tree)).toEqual([]);
  });
});
