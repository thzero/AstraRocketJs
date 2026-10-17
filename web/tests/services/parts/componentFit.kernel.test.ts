import { describe, expect, it, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { syncDerived } from '../../../src/services/design/treeEdit';
import { isComponentRow, type Component, type TubeComponent } from '../../../src/services/parts/componentDb';
import { boreClears, emptyQuery, fitRuleFor, queryComponents } from '../../../src/services/parts/componentFilter';
import { fitContextFor } from '../../../src/services/parts/componentFit';
import { readData } from '../../testing/dataDir';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { kernelGeometry, loadEngine, type KernelGeometry } from '../../testing/kernelGeometry';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

const catalog: Component[] = readData<{ components: unknown[] }>('components.generated.json').components.filter(
  isComponentRow,
);

const stage = (id: string, children: ComponentNode[]) => ({ id, type: 'stage', children }) as unknown as ComponentNode;
const part = (id: string, type: string, extra: Record<string, unknown> = {}, children: ComponentNode[] = []) =>
  ({ id, type, length: 0.1, ...extra, children }) as unknown as ComponentNode;

/**
 * Desktop's "Match fore diameter" and "Match aft diameter", written out from
 * `ComponentPresetChooserDialog.getFilterCheckboxes` and
 * `ComponentPresetRowFilter` in the 24.12 release jar (`javap -c`):
 *
 * - for a symmetric part with a previous symmetric part, and a fore diameter
 *   column (OUTER_DIAMETER or FORE_OUTER_DIAMETER), keep the rows whose fore
 *   column is within `max(0.05 * d, 0.001)` of `d = previous.getAftRadius() * 2`;
 * - for its aft column (OUTER_DIAMETER or AFT_OUTER_DIAMETER), the same against
 *   `next.getForeRadius() * 2`, where a flipped nose cone takes the previous
 *   part instead of the next;
 * - a row is kept strictly inside the band, and both filters apply together.
 *
 * The radii are the kernel's, built through the bridge. The neighbors are the
 * airframe parts on either side in each design's single stack, read in order
 * across the stage boundary.
 */
const foreColumn = (p: Component): number | null =>
  p.type === 'bodytube' ? p.outerDiameter : p.type === 'transition' ? p.foreOuterDiameter : null;
const aftColumn = (p: Component): number | null =>
  p.type === 'bodytube' || p.type === 'nosecone'
    ? p.outerDiameter
    : p.type === 'transition'
      ? p.aftOuterDiameter
      : null;
const within = (d: number, v: number) => Math.abs(d - v) < Math.max(0.05 * d, 0.001);

const kernelAft = (g: KernelGeometry, type: string) => (type === 'bodytube' ? g.outerRadius! : g.aftRadius!);
const kernelFore = (g: KernelGeometry, type: string) => (type === 'bodytube' ? g.outerRadius! : g.foreRadius!);

/** Each design and its airframe in order, nose first. */
const designs: { what: string; tree: RocketTree; stack: string[] }[] = [
  {
    what: 'a two-stage rocket with automatic tubes and a transition',
    stack: ['nose', 'tube', 'shoulder', 'aftTube', 'booster'],
    tree: {
      components: [
        stage('s1', [
          part('nose', 'nosecone', { shape: 'ogive', aftRadius: 0.0124 }),
          part('tube', 'bodytube', { outerRadius: 0.02, outerRadiusAuto: true, thickness: 0.0005, length: 0.3 }),
          part('shoulder', 'transition', {
            shape: 'conical',
            foreRadius: 0.01,
            foreRadiusAuto: true,
            aftRadius: 0.0205,
            thickness: 0.001,
          }),
          part('aftTube', 'bodytube', { outerRadius: 0.0205, thickness: 0.0005, length: 0.3 }),
        ]),
        stage('s2', [part('booster', 'bodytube', { outerRadius: 0.0331, thickness: 0.0005, length: 0.3 })]),
      ],
    } as unknown as RocketTree,
  },
  {
    what: 'a tail cone, a nose cone flipped',
    stack: ['nose', 'tube', 'tail'],
    tree: {
      components: [
        stage('s1', [
          part('nose', 'nosecone', { shape: 'ogive', aftRadius: 0.0331 }),
          part('tube', 'bodytube', { outerRadius: 0.0331, thickness: 0.0005, length: 0.3 }),
          part('tail', 'nosecone', { shape: 'conical', aftRadius: 0.0331, flipped: true }),
        ]),
      ],
    } as unknown as RocketTree,
  },
];

describe("the picker's diameter match", () => {
  it.each(designs)('keeps the rows desktop keeps on $what', async ({ tree: raw, stack }) => {
    const tree = syncDerived(raw);
    const nodes = new Map<string, ComponentNode>();
    const walk = (ns: readonly ComponentNode[]) => {
      for (const n of ns) {
        nodes.set(n.id!, n);
        walk(n.children ?? []);
      }
    };
    walk(tree.components);
    const geo = kernelGeometry(await loadEngine(), tree);
    let compared = 0;
    for (const [i, id] of stack.entries()) {
      const node = nodes.get(id)!;
      const prevId = stack[i - 1];
      const nextId = stack[i + 1];
      const flipped = node.type === 'nosecone' && node['flipped'] === true;
      const aftSide = flipped ? prevId : nextId;
      const fore = prevId ? kernelAft(geo.get(prevId)!, nodes.get(prevId)!.type) * 2 : null;
      const aft = aftSide ? kernelFore(geo.get(aftSide)!, nodes.get(aftSide)!.type) * 2 : null;

      const rows = catalog.filter((p) => p.type === node.type);
      const filters: ((p: Component) => boolean)[] = [];
      if (fore != null && rows.some((p) => foreColumn(p) != null)) filters.push((p) => within(fore, foreColumn(p)!));
      if (aft != null) filters.push((p) => within(aft, aftColumn(p)!));
      const fit = fitContextFor(tree, id);
      if (filters.length === 0) {
        expect(fitRuleFor(node.type as Component['type'], fit), id).toBeNull();
        continue;
      }
      const want = rows.filter((p) => filters.every((f) => f(p)));
      const got = queryComponents(rows, { ...emptyQuery, fitsOnly: true, showLegacy: true }, node.type as never, fit);
      const key = (p: Component) => `${p.mfr}|${p.partNo}|${JSON.stringify(p)}`;
      expect(got.map((r) => key(r.part)).sort(), id).toEqual(want.map(key).sort());
      compared += want.length;
    }
    expect(compared).toBeGreaterThan(0);
  });
});

/**
 * The motor mount a centering ring has to go over: the kernel's automatic bore
 * for a ring at the same place, `CenteringRing.getInnerRadius`, the widest inner
 * tube whose span overlaps the ring's.
 */
describe("the picker's centering ring bore", () => {
  const tree = syncDerived({
    components: [
      stage('s1', [
        part('nose', 'nosecone', { shape: 'ogive', aftRadius: 0.0331 }),
        part('tube', 'bodytube', { outerRadius: 0.0331, thickness: 0.0008, length: 0.5 }, [
          part('mmt29', 'innertube', {
            outerRadius: 0.0152,
            thickness: 0.0005,
            length: 0.15,
            position: { method: 'top', offset: 0 },
          }),
          part('mmt54', 'innertube', {
            outerRadius: 0.0272,
            thickness: 0.0005,
            length: 0.15,
            position: { method: 'bottom', offset: 0 },
          }),
          part('foreRing', 'centeringring', { length: 0.005, position: { method: 'top', offset: 0.05 } }),
          part('aftRing', 'centeringring', { length: 0.005, position: { method: 'bottom', offset: -0.05 } }),
          part('midRing', 'centeringring', { length: 0.005, position: { method: 'top', offset: 0.25 } }),
        ]),
      ]),
    ],
  } as unknown as RocketTree);
  const rings = catalog.filter((p): p is TubeComponent => p.type === 'centeringring');

  it('has rings on two different mounts and one on none', async () => {
    const geo = kernelGeometry(await loadEngine(), tree);
    const [fore, aft, mid] = ['foreRing', 'aftRing', 'midRing'].map((id) => geo.get(id)!.innerRadius!);
    expect(fore).toBeGreaterThan(0);
    expect(aft).toBeGreaterThan(fore!);
    expect(mid).toBe(0);
  });

  it.each(['foreRing', 'aftRing', 'midRing'])('measures %s against the mount the kernel centers it on', async (id) => {
    const geo = kernelGeometry(await loadEngine(), tree);
    const bore = geo.get(id)!.innerRadius!;
    const fit = fitContextFor(tree, id)!;
    if (bore > 0) expect(fit.mountOuter).toBeCloseTo(bore * 2, 12);
    else expect(fit.mountOuter).toBeUndefined();
    // Every ring offered goes over that mount: no bore smaller than it, past
    // nominal rounding, and none so wide it centers nothing.
    for (const p of rings) {
      if (!boreClears(p, fit) || p.innerDiameter == null || bore === 0) continue;
      expect(p.innerDiameter, `${p.mfr} ${p.partNo}`).toBeGreaterThanOrEqual(bore * 2 - 0.0005);
      expect(p.innerDiameter, `${p.mfr} ${p.partNo}`).toBeLessThanOrEqual(bore * 2 + 0.002);
    }
    if (bore > 0) expect(rings.some((p) => p.innerDiameter != null && boreClears(p, fit))).toBe(true);
  });
});
