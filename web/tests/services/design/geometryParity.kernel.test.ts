import { describe, expect, it, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { syncAutoRadii } from '../../../src/services/design/autoRadius';
import { badDimensions } from '../../../src/services/design/requiredComponent';
import { stationRadius } from '../../../src/tree/shapeProfile';
import { parentRadiusOf } from '../../../src/tree/finPlanform';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { kernelGeometry, loadEngine, walkTree, type KernelGeometry } from '../../testing/kernelGeometry';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * The app's own geometry against the kernel's, over generated designs.
 *
 * The app resolves automatic radii, profiles and bores before a run so the
 * schematic, the report, the printable solids and the cut sheets can draw
 * without the kernel. Each of those numbers is a copy of a Java rule, and a
 * copy tested only against hand-picked cases agrees with whatever its author
 * believed. Here every design is built in the real kernel and each resolved
 * number compared, so a rule that differs from `BodyTube`, `Transition`,
 * `RingComponent` or `MassObject` fails on the first design that reaches it.
 *
 * The designs are generated from a fixed seed so a failure reproduces: the
 * report names the seed and the part. They cover the flags that change a
 * part's geometry (`filled`, `flipped` and each automatic flag), two stages,
 * and parts inside tubes, nose cones and transitions.
 */

const DESIGNS = 200;
const TOL = 1e-9;
/**
 * A clipped profile's clip point is found by iteration on both sides, so near
 * the small end the two agree to a few hundredths of a millimeter, not to the
 * last bit. The curves themselves are pinned to the Java in
 * shapeProfile.kernel.test.ts; this checks that each part reads the right one.
 */
const PROFILE_TOL = 1e-4;

/** Deterministic PRNG (mulberry32), so a failing design can be rebuilt from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHAPES = ['conical', 'ogive', 'ellipsoid', 'power', 'parabolic', 'haack'];

function generate(seed: number): RocketTree {
  const r = rng(seed);
  const chance = (p: number) => r() < p;
  const between = (lo: number, hi: number) => lo + r() * (hi - lo);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  let n = 0;
  const id = (type: string) => `${type}${++n}`;
  const radius = () => Math.round(between(0.01, 0.05) * 1e4) / 1e4;

  /** Parts that sit inside an airframe part of outer radius `outer` and length `len`. */
  const internals = (outer: number, len: number, inTube: boolean): ComponentNode[] => {
    const kids: ComponentNode[] = [];
    const at = () => ({ method: 'top', offset: Math.round(between(0, len * 0.8) * 1e4) / 1e4 });
    if (inTube && chance(0.6)) {
      const mountR = Math.round(outer * between(0.3, 0.6) * 1e4) / 1e4;
      const mountLen = Math.round(between(0.3, 0.9) * len * 1e4) / 1e4;
      kids.push({
        type: 'innertube',
        id: id('innertube'),
        length: mountLen,
        outerRadius: mountR,
        thickness: 0.0005,
        position: at(),
        children: chance(0.5)
          ? [
              {
                type: 'engineblock',
                id: id('engineblock'),
                length: 0.005,
                thickness: 0.002,
                outerRadiusAuto: true,
                outerRadius: mountR * 0.9,
                position: { method: 'top', offset: 0 },
              } as unknown as ComponentNode,
            ]
          : [],
      } as unknown as ComponentNode);
    }
    const rings = Math.floor(between(0, 3));
    for (let i = 0; i < rings; i++) {
      kids.push({
        type: 'centeringring',
        id: id('centeringring'),
        length: 0.005,
        outerRadiusAuto: true,
        innerRadiusAuto: chance(0.7),
        outerRadius: outer * 0.9,
        innerRadius: outer * 0.3,
        position: at(),
      } as unknown as ComponentNode);
    }
    if (chance(0.5)) {
      kids.push({
        type: 'bulkhead',
        id: id('bulkhead'),
        length: 0.004,
        outerRadiusAuto: true,
        outerRadius: outer * 0.9,
        position: at(),
      } as unknown as ComponentNode);
    }
    if (inTube && chance(0.4)) {
      kids.push({
        type: 'tubecoupler',
        id: id('tubecoupler'),
        length: Math.round(len * 0.3 * 1e4) / 1e4,
        thickness: 0.001,
        outerRadiusAuto: true,
        outerRadius: outer * 0.9,
        position: at(),
      } as unknown as ComponentNode);
    }
    if (chance(0.4)) {
      kids.push({
        type: 'parachute',
        id: id('parachute'),
        diameter: 0.5,
        cd: 0.8,
        length: 0.03,
        radiusAuto: true,
        radius: outer * 0.5,
        position: at(),
      } as unknown as ComponentNode);
    }
    if (inTube && chance(0.3)) {
      kids.push({
        type: 'tubefinset',
        id: id('tubefinset'),
        finCount: Math.floor(between(3, 9)),
        length: 0.08,
        thickness: 0.0005,
        outerRadiusAuto: true,
        outerRadius: outer * 0.5,
        position: { method: 'bottom', offset: 0 },
      } as unknown as ComponentNode);
    }
    return kids;
  };

  /** A fin set with a tab deeper than any body here, so the kernel's tab limit decides its depth. */
  const fins = (len: number): ComponentNode[] => {
    if (!chance(0.5)) return [];
    const chord = Math.round(between(0.3, 0.9) * len * 1e4) / 1e4;
    return [
      {
        type: 'trapezoidfinset',
        id: id('trapezoidfinset'),
        finCount: 3,
        rootChord: chord,
        tipChord: chord * 0.5,
        sweep: chord * 0.3,
        height: 0.05,
        thickness: 0.003,
        tabHeight: 0.2,
        tabLength: Math.round(chord * between(0.2, 0.9) * 1e4) / 1e4,
        tabOffsetMethod: pick(['top', 'middle', 'bottom']),
        tabOffset: 0,
        position: { method: 'top', offset: Math.round(between(0, len - chord) * 1e4) / 1e4 },
      } as unknown as ComponentNode,
    ];
  };

  const wall = (node: Record<string, unknown>) => {
    if (chance(0.2)) node['filled'] = true;
    else node['thickness'] = Math.round(between(0.0005, 0.003) * 1e5) / 1e5;
  };

  const nose = (): ComponentNode => {
    const aft = radius();
    const len = Math.round(between(0.05, 0.3) * 1e4) / 1e4;
    const node: Record<string, unknown> = {
      type: 'nosecone',
      id: id('nosecone'),
      shape: pick(SHAPES),
      length: len,
      aftRadius: aft,
      aftRadiusAuto: chance(0.4),
      flipped: chance(0.2),
    };
    wall(node);
    // Nothing goes inside a filled part: it has no bore to size a part from.
    // No fins: the kernel mounts fin sets only on body tubes.
    node['children'] = !node['filled'] && chance(0.4) ? internals(aft, len, false) : [];
    return node as unknown as ComponentNode;
  };
  const tube = (): ComponentNode => {
    const outer = radius();
    const len = Math.round(between(0.1, 0.5) * 1e4) / 1e4;
    const node: Record<string, unknown> = {
      type: 'bodytube',
      id: id('bodytube'),
      length: len,
      outerRadius: outer,
      outerRadiusAuto: chance(0.4),
    };
    wall(node);
    node['children'] = [...fins(len), ...(node['filled'] ? [] : internals(outer, len, true))];
    return node as unknown as ComponentNode;
  };
  const transition = (): ComponentNode => {
    const fore = radius();
    const aft = radius();
    const len = Math.round(between(0.03, 0.15) * 1e4) / 1e4;
    const node: Record<string, unknown> = {
      type: 'transition',
      id: id('transition'),
      shape: pick(SHAPES),
      length: len,
      foreRadius: fore,
      aftRadius: aft,
      foreRadiusAuto: chance(0.4),
      aftRadiusAuto: chance(0.4),
    };
    wall(node);
    // No fins: the kernel mounts fin sets only on body tubes.
    node['children'] = !node['filled'] && chance(0.4) ? internals(Math.max(fore, aft), len, false) : [];
    return node as unknown as ComponentNode;
  };
  const axial = () => (chance(0.65) ? tube() : transition());

  const sustainer = [nose()];
  for (let i = 0, k = 1 + Math.floor(r() * 3); i < k; i++) sustainer.push(axial());
  const stages: ComponentNode[] = [{ type: 'stage', id: id('stage'), children: sustainer } as unknown as ComponentNode];
  if (chance(0.4)) {
    const booster: ComponentNode[] = [];
    for (let i = 0, k = 1 + Math.floor(r() * 2); i < k; i++) booster.push(axial());
    stages.push({ type: 'stage', id: id('stage'), children: booster } as unknown as ComponentNode);
  }
  return { components: stages } as unknown as RocketTree;
}

/**
 * Rules known to disagree with the kernel, each against its finding in
 * docs/AUDIT.md. A rule not listed here fails the test, and so does a listed
 * rule that no longer disagrees: the fix removes its line.
 */
const KNOWN: Record<string, string> = {};

/** One disagreement, grouped by the rule that produced it. */
interface Miss {
  rule: string;
  seed: number;
  part: string;
  app: number | string;
  kernel: number | string;
}

const close = (a: number | undefined, b: number | undefined) =>
  typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= TOL;

/**
 * True when the kernel gives this part no usable size: -1 for two automatic
 * ends that follow each other, 0 for an end that follows a flipped nose cone's
 * tip, or 0 for a ring placed where its parent has no bore. The app blocks a
 * run on a zero dimension, so none of these is a design that flies.
 */
function unresolvedIn(node: ComponentNode, k: KernelGeometry): boolean {
  const ends =
    node.type === 'nosecone'
      ? [Math.max(k.foreRadius ?? 0, k.aftRadius ?? 0)]
      : node.type === 'transition'
        ? [k.foreRadius, k.aftRadius]
        : node.type === 'bodytube' ||
            node.type === 'centeringring' ||
            node.type === 'bulkhead' ||
            node.type === 'tubecoupler' ||
            node.type === 'engineblock'
          ? [k.outerRadius]
          : [];
  return ends.some((v) => typeof v === 'number' && v <= 0);
}

/** Compare one resolved design with the kernel's geometry for it. */
function compare(
  seed: number,
  tree: RocketTree,
  kernel: Map<string, KernelGeometry>,
): { misses: Miss[]; unresolved: number } {
  const misses: Miss[] = [];
  // A part whose own radius disagrees, or that the kernel left unresolved:
  // whatever sits inside it is sized from the wrong number, so it is not
  // checked again under a second rule.
  const skip = new Set<string>();
  let unresolved = 0;
  const noSize = new Set<string>();
  let id = '';
  const check = (rule: string, app: unknown, k: number | undefined) => {
    const a = typeof app === 'number' ? app : NaN;
    if (!close(a, k)) {
      misses.push({ rule, seed, part: id, app: a, kernel: k ?? 'none' });
      skip.add(id);
    }
  };
  for (const visit of walkTree(tree)) {
    const { node, parent, parentId } = visit;
    id = visit.id;
    const k = kernel.get(id);
    if (!k) continue;
    if (parent && skip.has(parentId)) {
      skip.add(id);
      if (noSize.has(parentId)) noSize.add(id);
      continue;
    }
    // A part the kernel gives no usable size is counted and left out, along
    // with whatever it holds and the pre-run check's verdict on it.
    if (unresolvedIn(node, k)) {
      unresolved += 1;
      noSize.add(id);
      skip.add(id);
      continue;
    }
    const auto = (flag: string) => node[flag] === true;
    // Parts sized from their parent are reported per parent type, because a
    // tube, a nose cone and a transition each offer their bore differently.
    const inside = parent ? ` in a ${parent.type}` : '';
    switch (node.type) {
      case 'nosecone': {
        // The base is the aft end, or the fore end when the cone is turned round.
        const base = Math.max(k.foreRadius ?? 0, k.aftRadius ?? 0);
        check(
          auto('aftRadiusAuto') ? 'nose cone automatic base radius' : 'nose cone base radius',
          node['aftRadius'],
          base,
        );
        break;
      }
      case 'transition':
        check(
          auto('foreRadiusAuto') ? 'transition automatic fore radius' : 'transition fore radius',
          node['foreRadius'],
          k.foreRadius,
        );
        check(
          auto('aftRadiusAuto') ? 'transition automatic aft radius' : 'transition aft radius',
          node['aftRadius'],
          k.aftRadius,
        );
        break;
      case 'bodytube':
        check(
          auto('outerRadiusAuto') ? 'body tube automatic radius' : 'body tube radius',
          node['outerRadius'],
          k.outerRadius,
        );
        break;
      case 'centeringring':
        check(`centering ring automatic outer radius${inside}`, node['outerRadius'], k.outerRadius);
        if (auto('innerRadiusAuto'))
          check(`centering ring automatic bore${inside}`, node['innerRadius'], k.innerRadius);
        break;
      case 'bulkhead':
        check(`bulkhead automatic outer radius${inside}`, node['outerRadius'], k.outerRadius);
        break;
      case 'tubecoupler':
        check(`tube coupler automatic outer radius${inside}`, node['outerRadius'], k.outerRadius);
        break;
      case 'engineblock':
        check(`engine block automatic outer radius${inside}`, node['outerRadius'], k.outerRadius);
        break;
      case 'tubefinset':
        check('tube fin automatic radius', node['outerRadius'], k.outerRadius);
        break;
      case 'trapezoidfinset':
        check(`fin tab depth limit${inside}`, parentRadiusOf(tree, id), k.maxTabHeight);
        break;
      case 'parachute':
        check(`parachute automatic packed radius${inside}`, node['radius'], k.radius);
        break;
    }
    // The profile every drawing, mesh and report reads, station by station.
    if ((node.type === 'nosecone' || node.type === 'transition') && k.profile && !skip.has(id)) {
      const len = k.length;
      const rule = node['flipped'] === true ? 'flipped nose cone profile' : `${node.type} profile`;
      for (let i = 0; i < k.profile.length; i++) {
        const x = (len * i) / (k.profile.length - 1);
        const kr = k.profile[i] ?? undefined;
        const ar = stationRadius(node, x);
        if (!(typeof kr === 'number' && Math.abs(ar - kr) <= PROFILE_TOL)) {
          misses.push({ rule, seed, part: `${id} at x=${x.toFixed(4)}`, app: ar, kernel: kr ?? 'none' });
          break;
        }
      }
    }
  }
  // The kernel built and resolved this design, so the pre-run check must let it fly.
  for (const bad of badDimensions(tree)) {
    if (noSize.has(bad.id ?? '')) continue;
    const node = walkTree(tree).find((w) => w.id === bad.id)?.node;
    const flag = node?.['filled'] === true ? 'filled ' : '';
    misses.push({
      rule: `run blocked on a ${flag}${bad.type} (${bad.field})`,
      seed,
      part: bad.id ?? bad.type,
      app: 'blocked',
      kernel: 'builds',
    });
  }
  return { misses, unresolved };
}

/** One line per rule: how many designs it failed on, and the first example. */
function report(misses: Miss[]): string[] {
  const byRule = new Map<string, Miss[]>();
  for (const m of misses) byRule.set(m.rule, [...(byRule.get(m.rule) ?? []), m]);
  return [...byRule.entries()]
    .filter(([rule]) => !(rule in KNOWN))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rule, ms]) => {
      const seeds = new Set(ms.map((m) => m.seed)).size;
      const e = ms[0]!;
      return `${rule}: ${seeds} of ${DESIGNS} designs; e.g. seed ${e.seed}, ${e.part}: app ${e.app}, kernel ${e.kernel}`;
    });
}

describe('app geometry matches the kernel', () => {
  it(`over ${DESIGNS} generated designs`, async () => {
    const engine = await loadEngine();
    const misses: Miss[] = [];
    let unresolved = 0;
    for (let seed = 1; seed <= DESIGNS; seed++) {
      const tree = syncAutoRadii(generate(seed));
      const r = compare(seed, tree, kernelGeometry(engine, tree));
      misses.push(...r.misses);
      unresolved += r.unresolved;
    }
    expect(report(misses)).toEqual([]);
    const failing = new Set(misses.map((m) => m.rule));
    expect(Object.keys(KNOWN).filter((rule) => !failing.has(rule))).toEqual([]);
    // Most parts resolve; a generator that produced mostly unresolved pairs
    // would leave this test checking nothing.
    expect(unresolved).toBeLessThan(DESIGNS);
  });
});
