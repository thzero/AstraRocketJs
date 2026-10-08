import { describe, expect, it } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import {
  canConvertToFreeform,
  canSplit,
  canSplitCluster,
  convertToFreeform,
  resetCluster,
  splitCluster,
  splitCount,
  splitInstances,
} from '../../../src/services/design/componentActions';
import { clusterOffsets } from '../../../src/tree/cluster';
import { trapezoidFinPoints } from '../../../src/tree/finPlanform';

/**
 * The config-dialog buttons that change the tree: Convert to freeform, the three
 * Splits, and the cluster Reset. Each replaces the part being edited, so what
 * matters is what survives the replacement and where the pieces land.
 */

const node = (o: Record<string, unknown>): ComponentNode => o as unknown as ComponentNode;

/** A stage holding one body tube, with `kids` inside it. */
const rocket = (kids: ComponentNode[]): RocketTree =>
  ({
    name: 'R',
    components: [
      {
        id: 'st',
        type: 'stage',
        name: 'Sustainer',
        children: [{ id: 'tube', type: 'bodytube', length: 0.4, outerRadius: 0.026, thickness: 0.001, children: kids }],
      },
    ],
  }) as unknown as RocketTree;

const kids = (tree: RocketTree): ComponentNode[] =>
  ((tree.components[0]!.children as ComponentNode[])[0]!.children ?? []) as ComponentNode[];

const fins = (extra: Record<string, unknown> = {}) =>
  node({
    id: 'fins',
    type: 'trapezoidfinset',
    finCount: 3,
    rootChord: 0.05,
    tipChord: 0.03,
    sweep: 0.02,
    height: 0.04,
    thickness: 0.003,
    crossSection: 'rounded',
    cant: 0.05,
    tabLength: 0.02,
    tabHeight: 0.005,
    filletRadius: 0.002,
    materialName: 'Plywood (birch)',
    comment: 'keep me',
    ...extra,
  });

describe('convert to freeform', () => {
  it('is offered for a trapezoid and an elliptical fin set, and nothing else', () => {
    expect(canConvertToFreeform(fins())).toBe(true);
    expect(canConvertToFreeform(node({ type: 'ellipticalfinset' }))).toBe(true);
    // A freeform fin already is one, and a tube fin set has no planform.
    expect(canConvertToFreeform(node({ type: 'freeformfinset' }))).toBe(false);
    expect(canConvertToFreeform(node({ type: 'tubefinset' }))).toBe(false);
    expect(canConvertToFreeform(node({ type: 'bodytube' }))).toBe(false);
  });

  it('keeps the outline the fin already had', () => {
    const out = kids(convertToFreeform(rocket([fins()]), 'fins'))[0]!;
    expect(out.type).toBe('freeformfinset');
    expect(out['points']).toEqual(trapezoidFinPoints(fins()));
  });

  it('drops the four dimensions the outline now describes', () => {
    const out = kids(convertToFreeform(rocket([fins()]), 'fins'))[0]!;
    // Two descriptions of one shape, with nothing keeping them in step.
    for (const k of ['rootChord', 'tipChord', 'sweep', 'height']) expect(out[k]).toBeUndefined();
  });

  it('keeps everything that is not the planform', () => {
    const out = kids(convertToFreeform(rocket([fins()]), 'fins'))[0]!;
    expect(out['finCount']).toBe(3);
    expect(out['thickness']).toBe(0.003);
    expect(out['crossSection']).toBe('rounded');
    expect(out['cant']).toBe(0.05);
    expect(out['tabLength']).toBe(0.02);
    expect(out['filletRadius']).toBe(0.002);
    expect(out['materialName']).toBe('Plywood (birch)');
    expect(out['comment']).toBe('keep me');
    // Same part, so the selection and anything naming it survive.
    expect(out.id).toBe('fins');
  });

  it('is a no-op on a part it cannot convert', () => {
    const t = rocket([node({ id: 'tf', type: 'tubefinset', finCount: 6 })]);
    expect(convertToFreeform(t, 'tf')).toBe(t);
    expect(convertToFreeform(t, 'nope')).toBe(t);
  });
});

describe('split fins', () => {
  it('counts the fins, and refuses a single one', () => {
    expect(splitCount(fins())).toBe(3);
    expect(canSplit(fins())).toBe(true);
    expect(canSplit(fins({ finCount: 1 }))).toBe(false);
    // Not a splittable type at all.
    expect(canSplit(node({ type: 'bodytube', instanceCount: 3 }))).toBe(false);
  });

  it('makes one single-fin set per fin, in place', () => {
    const out = kids(splitInstances(rocket([fins()]), 'fins', 'Fins'));
    expect(out).toHaveLength(3);
    expect(out.map((n) => n['finCount'])).toEqual([1, 1, 1]);
    expect(out.map((n) => n.name)).toEqual(['Fins #1', 'Fins #2', 'Fins #3']);
  });

  it('spreads them around the body from wherever the set was rotated to', () => {
    const out = kids(splitInstances(rocket([fins({ rotation: Math.PI / 6 })]), 'fins', 'Fins'));
    const third = (2 * Math.PI) / 3;
    expect(out.map((n) => n['rotation'])).toEqual([Math.PI / 6, Math.PI / 6 + third, Math.PI / 6 + 2 * third]);
  });

  it('divides an override mass between them', () => {
    // 30 g was a figure for the whole set, not for one fin.
    const out = kids(splitInstances(rocket([fins({ overrideMass: 0.03 })]), 'fins', 'Fins'));
    expect(out.map((n) => n['overrideMass'])).toEqual([0.01, 0.01, 0.01]);
  });

  it('gives every copy but the first a fresh id', () => {
    const out = kids(splitInstances(rocket([fins()]), 'fins', 'Fins'));
    expect(out[0]!.id).toBe('fins'); // keeps the selection
    expect(new Set(out.map((n) => n.id)).size).toBe(3);
  });

  it('splits a booster by its instance count and angle offset', () => {
    const t = rocket([]);
    const withBooster = {
      ...t,
      components: [
        ...t.components,
        node({ id: 'bst', type: 'parallelstage', instanceCount: 2, angleOffset: 0, children: [] }),
      ],
    } as RocketTree;
    const out = splitInstances(withBooster, 'bst', 'Booster').components.filter((n) => n.type === 'parallelstage');
    expect(out).toHaveLength(2);
    expect(out.map((n) => n['instanceCount'])).toEqual([1, 1]);
    expect(out.map((n) => n['angleOffset'])).toEqual([0, Math.PI]);
  });

  it('is a no-op on a single instance', () => {
    const t = rocket([fins({ finCount: 1 })]);
    expect(splitInstances(t, 'fins', 'Fins')).toBe(t);
  });
});

describe('split cluster', () => {
  const tube = (extra: Record<string, unknown> = {}) =>
    node({
      id: 'mount',
      type: 'innertube',
      name: 'Mount',
      length: 0.07,
      outerRadius: 0.0095,
      thickness: 0.0005,
      motorMount: true,
      cluster: '4-ring',
      clusterScale: 1,
      clusterRotation: 0,
      children: [node({ id: 'block', type: 'engineblock', length: 0.003 })],
      ...extra,
    });

  it('is offered only for a cluster of more than one', () => {
    expect(canSplitCluster(tube())).toBe(true);
    expect(canSplitCluster(tube({ cluster: 'single' }))).toBe(false);
    expect(canSplitCluster(node({ type: 'bodytube', cluster: '4-ring' }))).toBe(false);
  });

  it('makes one single tube per cluster position', () => {
    const out = kids(splitCluster(rocket([tube()]), 'mount', 'Mount'));
    expect(out).toHaveLength(4);
    expect(out.map((n) => n['cluster'])).toEqual(['single', 'single', 'single', 'single']);
    expect(out.map((n) => n.name)).toEqual(['Mount #1', 'Mount #2', 'Mount #3', 'Mount #4']);
  });

  it('pins each tube where the cluster drew it', () => {
    const out = kids(splitCluster(rocket([tube()]), 'mount', 'Mount'));
    const want = clusterOffsets('4-ring', 0.0095, 1, 0);
    out.forEach((n, i) => {
      const { y, z } = want[i]!;
      // Stated as a distance and a direction, the way the file carries it.
      expect(n['radialPosition'] as number).toBeCloseTo(Math.hypot(y, z), 12);
      expect(n['radialDirection'] as number).toBeCloseTo(Math.atan2(z, y), 12);
    });
  });

  it('keeps an off-center cluster off center', () => {
    // The kernel rotates the pattern by clusterRotation - radialDirection and
    // then adds the tube's own offset, so the tubes stay where they were drawn.
    const out = kids(splitCluster(rocket([tube({ radialPosition: 0.005, radialDirection: 0 })]), 'mount', 'Mount'));
    const want = clusterOffsets('4-ring', 0.0095, 1, 0);
    out.forEach((n, i) => {
      const y = want[i]!.y + 0.005;
      expect(n['radialPosition'] as number).toBeCloseTo(Math.hypot(y, want[i]!.z), 12);
    });
  });

  it('clears the spacing and roll, which no longer describe anything', () => {
    const out = kids(splitCluster(rocket([tube({ clusterScale: 1.4, clusterRotation: 0.5 })]), 'mount', 'Mount'));
    expect(out.map((n) => n['clusterScale'])).toEqual([1, 1, 1, 1]);
    expect(out.map((n) => n['clusterRotation'])).toEqual([0, 0, 0, 0]);
  });

  it('duplicates what was attached, with fresh ids', () => {
    // The warning on the desktop's own tooltip: four tubes, four engine blocks.
    const out = kids(splitCluster(rocket([tube()]), 'mount', 'Mount'));
    const blocks = out.flatMap((n) => (n.children ?? []) as ComponentNode[]);
    expect(blocks.map((b) => b.type)).toEqual(['engineblock', 'engineblock', 'engineblock', 'engineblock']);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(4);
  });

  it('is a no-op on a single tube', () => {
    const t = rocket([tube({ cluster: 'single' })]);
    expect(splitCluster(t, 'mount', 'Mount')).toBe(t);
  });
});

describe('reset a cluster', () => {
  const tube = (extra: Record<string, unknown>) =>
    node({ id: 'mount', type: 'innertube', length: 0.07, outerRadius: 0.0095, cluster: '3-ring', ...extra });

  it('puts the spacing and roll back, and leaves the pattern alone', () => {
    const out = kids(resetCluster(rocket([tube({ clusterScale: 1.6, clusterRotation: 0.4 })]), 'mount'))[0]!;
    expect(out['clusterScale']).toBe(1);
    expect(out['clusterRotation']).toBe(0);
    expect(out['cluster']).toBe('3-ring');
  });

  it('is a no-op when there is nothing to reset', () => {
    const t = rocket([tube({ clusterScale: 1, clusterRotation: 0 })]);
    expect(resetCluster(t, 'mount')).toBe(t);
  });
});
