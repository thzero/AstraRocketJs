import { describe, expect, it, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { syncDerived } from '../../../src/services/design/treeEdit';
import {
  finCutContour,
  finMountOf,
  finOutlinePoints,
  finRootPoints,
  finTabPoints,
  parentRadiusOf,
} from '../../../src/tree/finPlanform';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { kernelGeometry, loadEngine, walkTree, type KernelGeometry } from '../../testing/kernelGeometry';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * The app's fin geometry against the kernel's, at the edges the main
 * generated designs (geometryParity.kernel.test.ts) do not reach.
 *
 * Each design here is built to land on a rule the fin port copies from
 * `FinSet`, `TrapezoidFinSet` and `FreeformFinSet`: a root that runs past the
 * end of a nose cone or transition, or starts ahead of it; a tab past the root
 * or wholly outside the fin; a tab placed by each `AxialMethod`, 'after' and
 * 'absolute' among them; a trapezoid whose tip vanishes or whose sweep is zero
 * or negative; a freeform outline whose first point is off the origin (the
 * kernel moves it there) or whose interior dips inside the body
 * (`clampInteriorPoint` raises it); cant on a nose cone; and fins of every
 * type, canted and tabbed, on tubes and cones inside pod sets. Every fin's
 * root, outline, tab, tab depth limit and cut contour is compared with the
 * kernel's, and each rule has to be reached by enough designs that a
 * generator change cannot quietly stop testing it.
 */

const DESIGNS = 150;
const TOL = 1e-9;
/** A clipped profile's clip point is found by iteration on both sides; see geometryParity.kernel.test.ts. */
const PROFILE_TOL = 1e-4;

type Pt = [number, number];

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
const TAB_METHODS = ['top', 'middle', 'bottom', 'after', 'absolute'] as const;

/** How a generated tab sits against the root. */
type TabPlace = 'on the root' | 'past the root' | 'outside the fin';

/**
 * The offset that puts a tab's front edge at `x0` along a root of `chord`,
 * written out from `AxialMethod.getAsPosition(offset, tabLength, chord)`:
 * TOP and ABSOLUTE take the offset as the position, AFTER adds the chord,
 * BOTTOM adds `chord - tabLength` and MIDDLE half of it.
 */
function tabOffsetFor(method: string, x0: number, tabLength: number, chord: number): number {
  if (method === 'top' || method === 'absolute') return x0;
  if (method === 'after') return x0 - chord;
  if (method === 'bottom') return x0 - (chord - tabLength);
  return x0 - (chord - tabLength) / 2;
}

function generate(seed: number): RocketTree {
  const r = rng(seed);
  const chance = (p: number) => r() < p;
  const between = (lo: number, hi: number) => lo + r() * (hi - lo);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
  let n = 0;
  const id = (type: string) => `${type}${++n}`;

  /** A tab by any method, on the root, hanging past it, or wholly ahead of or behind the fin. */
  const tab = (chord: number): Record<string, unknown> => {
    if (chance(0.1)) return { tabHeight: 0, tabLength: 0 };
    const method = pick(TAB_METHODS);
    const place: TabPlace = pick(['on the root', 'on the root', 'past the root', 'outside the fin']);
    const tabLength = round4(chord * between(0.2, 0.8));
    const x0 =
      place === 'on the root'
        ? between(0, chord - tabLength)
        : place === 'past the root'
          ? chance(0.5)
            ? chord - tabLength * between(0.2, 0.8)
            : -tabLength * between(0.2, 0.8)
          : chance(0.5)
            ? chord + between(0.002, 0.01)
            : -tabLength - between(0.002, 0.01);
    return {
      tabHeight: chance(0.5) ? 0.2 : round4(between(0.002, 0.008)),
      tabLength,
      tabOffsetMethod: method,
      tabOffset: Math.round(tabOffsetFor(method, x0, tabLength, chord) * 1e5) / 1e5,
    };
  };

  /** A cant angle (rad), small enough that half the chord turned by it stays inside `radius`. */
  const cant = (chord: number, radius: number): number => {
    if (!chance(0.4)) return 0;
    const c = round4(between(0.01, 0.08)) * (chance(0.5) ? 1 : -1);
    return (chord / 2) * Math.sin(Math.abs(c)) < radius * 0.9 ? c : 0;
  };

  /**
   * Where a fin of `chord` stands on a part of `len`: inside it, running past
   * its aft end, or starting ahead of its fore end.
   */
  const place = (len: number, chord: number) =>
    pick([
      { method: 'top', offset: round4(between(0, Math.max(len - chord, 0))) },
      { method: 'top', offset: round4(len - chord * between(0.2, 0.7)) },
      { method: 'top', offset: round4(-chord * between(0.1, 0.4)) },
      { method: 'bottom', offset: 0 },
      { method: 'middle', offset: 0 },
    ]);

  /**
   * A freeform outline: its first point off the origin some of the time, and
   * an interior point near the root some of the time, which on a body that
   * widens aft lies inside it.
   */
  const freeformPoints = (chord: number): number[][] => {
    const dx = chance(0.4) ? round4(between(-0.02, 0.02)) : 0;
    const dy = chance(0.4) ? round4(between(-0.01, 0.01)) : 0;
    const low = chance(0.5);
    const pts = [
      [0, 0],
      [round4(chord * between(0.15, 0.4)), low ? 0.0005 : round4(between(0.02, 0.05))],
      [round4(chord * between(0.5, 0.8)), round4(between(0.015, 0.04))],
      [chord, 0],
    ];
    return pts.map(([x, y]) => [round4(x! + dx), round4(y! + dy)]);
  };

  /** A fin set of any type, or freeform only (the one type a nose cone or transition takes). */
  const finSet = (len: number, radius: number, freeformOnly: boolean): ComponentNode => {
    const type = freeformOnly ? 'freeformfinset' : pick(['trapezoidfinset', 'ellipticalfinset', 'freeformfinset']);
    const chord = round4(len * between(0.3, 0.9));
    const common = {
      id: id(type),
      finCount: pick([3, 4]),
      thickness: 0.003,
      ...tab(chord),
      cant: cant(chord, radius),
      position: place(len, chord),
    };
    if (type === 'ellipticalfinset')
      return { type, ...common, rootChord: chord, height: round4(between(0.02, 0.06)) } as unknown as ComponentNode;
    if (type === 'freeformfinset')
      return { type, ...common, points: freeformPoints(chord) } as unknown as ComponentNode;
    const [tipChord, sweep] = pick([
      [0, round4(chord * 0.6)],
      [0.00005, round4(chord * 0.5)],
      [round4(chord * 0.5), 0],
      [round4(chord * 0.5), -round4(chord * between(0.1, 0.4))],
      [round4(chord * 0.4), round4(chord * 0.3)],
    ]) as [number, number];
    return {
      type,
      ...common,
      rootChord: chord,
      tipChord,
      sweep,
      height: round4(between(0.02, 0.06)),
    } as unknown as ComponentNode;
  };

  const wall = (): Record<string, unknown> =>
    chance(0.2) ? { filled: true } : { thickness: round4(between(0.0005, 0.002)) };

  const nose = (radius: number): ComponentNode => {
    const len = round4(between(0.08, 0.25));
    return {
      type: 'nosecone',
      id: id('nosecone'),
      shape: pick(SHAPES),
      length: len,
      aftRadius: radius,
      flipped: chance(0.35),
      ...wall(),
      ...(chance(0.5) ? { clipped: chance(0.5) } : {}),
      // A cone's radius grows from its tip, so a canted root is bounded by the aft radius.
      children: chance(0.85) ? [finSet(len, radius, true)] : [],
    } as unknown as ComponentNode;
  };
  const tube = (radius: number, pods: boolean): ComponentNode => {
    const len = round4(between(0.12, 0.35));
    const kids: ComponentNode[] = [finSet(len, radius, false)];
    if (pods && chance(0.7)) {
      const podR = round4(between(0.008, 0.02));
      const podChain: ComponentNode[] = [];
      if (chance(0.5)) podChain.push(nose(podR));
      podChain.push(tube(podR, false));
      kids.push({
        type: chance(0.7) ? 'podset' : 'parallelstage',
        id: id('assembly'),
        instanceCount: 1 + Math.floor(r() * 3),
        radiusMethod: 'relative',
        radiusOffset: round4(between(0.01, 0.03)),
        angleOffset: 0,
        position: pick([
          { method: 'top', offset: 0 },
          { method: 'bottom', offset: 0 },
          { method: 'middle', offset: 0 },
          { method: 'top', offset: round4(between(0, len * 0.5)) },
        ]),
        children: podChain,
      } as unknown as ComponentNode);
    }
    return {
      type: 'bodytube',
      id: id('bodytube'),
      length: len,
      outerRadius: radius,
      thickness: 0.001,
      children: kids,
    } as unknown as ComponentNode;
  };
  const transition = (fore: number, aft: number): ComponentNode => {
    const len = round4(between(0.04, 0.12));
    return {
      type: 'transition',
      id: id('transition'),
      shape: pick(SHAPES),
      length: len,
      foreRadius: fore,
      aftRadius: aft,
      ...wall(),
      ...(chance(0.5) ? { clipped: chance(0.5) } : {}),
      children: chance(0.85) ? [finSet(len, Math.min(fore, aft), true)] : [],
    } as unknown as ComponentNode;
  };

  const body = round4(between(0.015, 0.04));
  const tail = round4(between(0.015, 0.05));
  const chain = [nose(body), tube(body, true), transition(body, tail), tube(tail, chance(0.5))];
  return { components: [{ type: 'stage', id: id('stage'), children: chain }] } as unknown as RocketTree;
}

/** Consecutive repeats and a closing point equal to the first removed, as a cut path draws them. */
function dedupe(pts: Pt[]): Pt[] {
  const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) <= 1e-12 && Math.abs(a[1] - b[1]) <= 1e-12;
  const out: Pt[] = [];
  for (const p of pts) if (!out.length || !same(out[out.length - 1]!, p)) out.push(p);
  while (out.length > 1 && same(out[0]!, out[out.length - 1]!)) out.pop();
  return out;
}

/**
 * The cut outline of one fin from the kernel's own pieces: the outline
 * (`FinSet.getFinPoints`), then the root (`getRootPoints`) walked from the
 * trailing edge forward, with the tab (`getTabPoints`) cut in where the root
 * passes it and root points inside the tab span left out. A tab wholly ahead
 * of the fin or wholly behind it is left off (`isTabBeyondFin`, and
 * `generateContinuousFinAndTabShape` returns the fin alone).
 */
function kernelCutOutline(k: KernelGeometry, chord: number): Pt[] | null {
  const pts = (xs: [number | null, number | null][] | undefined): Pt[] | null =>
    xs && xs.every(([x, y]) => typeof x === 'number' && typeof y === 'number') ? (xs as Pt[]) : null;
  const fin = pts(k.finPoints);
  const root = pts(k.rootPoints);
  if (!fin || !root) return null;
  const back = [...root].reverse();
  const tab = k.tabPoints ? pts(k.tabPoints) : undefined;
  if (tab === null) return null;
  const beyond = tab && ((tab[0]![0] > chord && tab[3]![0] > chord) || (tab[0]![0] < 0 && tab[3]![0] < 0));
  if (!tab || beyond) return dedupe([...fin, ...back]);
  const x0 = tab[0]![0];
  const x1 = tab[3]![0];
  return dedupe([
    ...fin,
    ...back.filter(([x]) => x > x1),
    tab[3]!,
    tab[2]!,
    tab[1]!,
    tab[0]!,
    ...back.filter(([x]) => x < x0),
  ]);
}

/** A coordinate as the report prints it; the kernel sends NaN as null. */
const fmt = (v: number | null) => (typeof v === 'number' ? v.toFixed(6) : String(v));

/** The first point where two outlines part by more than `tol`, or null when they match. */
function outlineMiss(app: Pt[] | null, kernel: Pt[] | null, tol: number): string | null {
  if (!app || !kernel) return `app ${app ? app.length : 'none'} points, kernel ${kernel ? kernel.length : 'none'}`;
  if (app.length !== kernel.length) return `${app.length} points against ${kernel.length}`;
  for (let i = 0; i < app.length; i++) {
    const [ax, ay] = app[i]!;
    const [kx, ky] = kernel[i]!;
    if (!(Math.abs(ax - kx) <= tol && Math.abs(ay - ky) <= tol))
      return `point ${i}: app (${fmt(ax)}, ${fmt(ay)}), kernel (${fmt(kx)}, ${fmt(ky)})`;
  }
  return null;
}

const clippedProfile = (node: ComponentNode | null): boolean =>
  !!node &&
  (node.type === 'transition' || node.type === 'nosecone') &&
  node['clipped'] !== false &&
  ['ellipsoid', 'power', 'haack'].includes(String(node['shape']));

/** The root chord a fin set's outline closes on, as the kernel reads it (`getLength`). */
const chordOf = (k: KernelGeometry): number => {
  const pts = (k.finPoints ?? []) as Pt[];
  return pts.length ? pts[pts.length - 1]![0] : 0;
};

/**
 * The edge cases one fin set exercises, each a suffix of its rule names, read
 * from the node as the app holds it and from the kernel's own pieces.
 */
function edges(node: ComponentNode, k: KernelGeometry, parentLength: number, front: number): string[] {
  const out: string[] = [];
  const chord = chordOf(k);
  if (front + chord > parentLength + 1e-9) out.push('root past the aft end');
  if (front < -1e-9) out.push('root ahead of the fore end');
  if (k.tabPoints) {
    const tab = k.tabPoints as Pt[];
    const [x0, x1] = [tab[0]![0], tab[3]![0]];
    const method = typeof node['tabOffsetMethod'] === 'string' ? node['tabOffsetMethod'] : 'middle';
    out.push(`tab by ${method}`);
    if ((x0 > chord && x1 > chord) || (x0 < 0 && x1 < 0)) out.push('tab outside the fin');
    else if (x0 < -1e-9 || x1 > chord + 1e-9) out.push('tab past the root');
  }
  if (node.type === 'trapezoidfinset') {
    const tip = Number(node['tipChord']);
    const sweep = Number(node['sweep']);
    if (tip <= 0.0001) out.push('vanishing tip');
    if (sweep === 0) out.push('zero sweep');
    if (sweep < 0) out.push('negative sweep');
  }
  if (node.type === 'freeformfinset') {
    const first = (node['points'] as number[][])[0]!;
    if (first[0] !== 0 || first[1] !== 0) out.push('first point off the origin');
  }
  if (typeof node['cant'] === 'number' && node['cant'] !== 0) out.push('canted');
  return out;
}

/**
 * A tab the kernel cuts deeper than the limit it settles at (`getMaxTabHeight`)
 * would fly a tab the body has no room for; `settleFinTabs` re-clamps each tab
 * once its fin set stands at its station. `KNOWN` holds accepted disagreements,
 * each with its reason.
 */
const DEEP_TAB = 'tab deeper than the kernel limit it settles at';
const KNOWN: Record<string, string> = {};

interface Miss {
  rule: string;
  design: string;
  part: string;
}

function compare(design: string, tree: RocketTree, kernel: Map<string, KernelGeometry>) {
  const misses: Miss[] = [];
  const checked = new Map<string, number>();
  let noAnswer = 0;
  const visits = walkTree(tree);
  const parentOf = new Map(visits.map((v) => [v.id, v.parent]));
  const parentIdOf = new Map(visits.map((v) => [v.id, v.parentId]));
  for (const { node, id, parent } of visits) {
    if (!node.type.endsWith('finset') || node.type === 'tubefinset' || !parent) continue;
    const k = kernel.get(id);
    const kp = kernel.get(parentIdOf.get(id) ?? '');
    if (!k || !kp) continue;
    // A parent the kernel gives no radius has no surface to stand a fin on.
    if (!(Math.max(kp.foreRadius ?? 0, kp.aftRadius ?? 0, kp.outerRadius ?? 0) > 0)) continue;
    const grand = parentOf.get(parentIdOf.get(id) ?? '');
    const where =
      ` on a ${parent['flipped'] === true ? 'flipped ' : ''}${parent.type}` +
      (grand && (grand.type === 'podset' || grand.type === 'parallelstage') ? ` in a ${grand.type}` : '');
    const mount = finMountOf(tree, id);
    if (!mount) {
      misses.push({ rule: `${node.type} mount${where}`, design, part: id });
      continue;
    }
    // The kernel has no answer (NaN) where a canted root, turned about its
    // midpoint, reaches past the body (`FinSet.getFinCantYOffset`): not a fin
    // that flies, so it is counted and left out.
    const nan = (xs: KernelGeometry['finPoints']) => (xs ?? []).some(([x, y]) => x === null || y === null);
    if (nan(k.rootPoints) || nan(k.finPoints) || nan(k.tabPoints)) {
      noAnswer++;
      continue;
    }
    const tol = clippedProfile(parent) ? PROFILE_TOL : TOL;
    const tags = edges(node, k, mount.length, mount.front);
    // A tab the kernel cuts deeper than its own settled limit: see DEEP_TAB.
    const kTab = k.tabPoints as Pt[] | undefined;
    const overDeep =
      !!kTab &&
      typeof k.maxTabHeight === 'number' &&
      Math.min(kTab[0]![1], kTab[3]![1]) - kTab[1]![1] > k.maxTabHeight + 1e-9;
    const note = (rule: string, miss: string | null, tabbed = false) => {
      checked.set(rule, (checked.get(rule) ?? 0) + 1);
      for (const tag of tags) {
        const tagged = `${rule}, ${tag}`;
        checked.set(tagged, (checked.get(tagged) ?? 0) + 1);
      }
      if (miss && tabbed && overDeep) misses.push({ rule: DEEP_TAB, design, part: `${id}, ${miss}` });
      else if (miss)
        misses.push({ rule: `${rule}${tags.length ? ` (${tags.join(', ')})` : ''}`, design, part: `${id}, ${miss}` });
    };
    const limit = parentRadiusOf(tree, id);
    // Only a fin set with a tab has a limit to compare: without one the bridge
    // leaves the kernel's initial tab in place, which nothing cuts.
    if (k.tabPoints)
      note(
        `${node.type} tab depth limit${where}`,
        typeof limit === 'number' && typeof k.maxTabHeight === 'number' && Math.abs(limit - k.maxTabHeight) <= tol
          ? null
          : `app ${limit}, kernel ${k.maxTabHeight}`,
      );
    const pieces: [string, Pt[] | null, KernelGeometry['finPoints']][] = [
      [`${node.type} root points${where}`, finRootPoints(node, mount), k.rootPoints],
      [`${node.type} outline points${where}`, finOutlinePoints(node, mount), k.finPoints],
      [`${node.type} tab points${where}`, finTabPoints(node, mount), k.tabPoints],
    ];
    for (const [rule, app, kernelPts] of pieces) {
      if (!app && !kernelPts) continue;
      note(rule, outlineMiss(app, (kernelPts as Pt[] | undefined) ?? null, tol), rule.includes(' tab points'));
    }
    const app = finCutContour(node, mount);
    note(
      `${node.type} cut outline${where}`,
      outlineMiss(app ? dedupe(app) : null, kernelCutOutline(k, chordOf(k)), tol),
      true,
    );
    // `FreeformFinSet.clampInteriorPoint`: an interior point inside the body is
    // raised to its surface, so the kernel's outline differs from the stated one.
    if (node.type === 'freeformfinset') {
      const stated = node['points'] as number[][];
      const [ox, oy] = stated[0]!;
      const flown = (k.finPoints ?? []) as Pt[];
      const raised = stated
        .slice(1, -1)
        .some(
          (p, i) =>
            flown[i + 1] &&
            Math.abs(flown[i + 1]![1] - (p[1]! - oy!)) > 1e-9 &&
            Math.abs(flown[i + 1]![0] - (p[0]! - ox!)) < 1e-9,
        );
      if (raised)
        checked.set(
          `freeformfinset interior point raised to the body${where}`,
          (checked.get(`freeformfinset interior point raised to the body${where}`) ?? 0) + 1,
        );
    }
  }
  return { misses, checked, noAnswer };
}

describe('app fin geometry matches the kernel at the edges', () => {
  it(`over ${DESIGNS} generated designs`, async () => {
    const engine = await loadEngine();
    const misses: Miss[] = [];
    const checked = new Map<string, number>();
    let noAnswer = 0;
    for (let seed = 1; seed <= DESIGNS; seed++) {
      const tree = syncDerived(generate(seed));
      const r = compare(`seed ${seed}`, tree, kernelGeometry(engine, tree));
      misses.push(...r.misses);
      noAnswer += r.noAnswer;
      for (const [rule, count] of r.checked) checked.set(rule, (checked.get(rule) ?? 0) + count);
    }
    const byRule = new Map<string, Miss[]>();
    for (const m of misses) byRule.set(m.rule, [...(byRule.get(m.rule) ?? []), m]);
    const report = [...byRule.entries()]
      .filter(([rule]) => !(rule in KNOWN))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([rule, ms]) => `${rule}: ${ms.length} fins; e.g. ${ms[0]!.design}, ${ms[0]!.part}`);
    expect(report).toEqual([]);
    // A known disagreement that no design reaches any more is fixed: remove it.
    expect(Object.keys(KNOWN).filter((rule) => !byRule.has(rule))).toEqual([]);
    // Most canted roots have an answer; a generator that produced mostly
    // unanswerable ones would leave this test checking nothing.
    expect(noAnswer).toBeLessThan(DESIGNS / 5);
    // Every edge is reached by enough designs that a generator change cannot
    // quietly stop testing it.
    for (const rule of [
      'freeformfinset root points on a nosecone, root past the aft end',
      'freeformfinset root points on a flipped nosecone, root past the aft end',
      'freeformfinset root points on a transition, root past the aft end',
      'freeformfinset root points on a transition, root ahead of the fore end',
      'freeformfinset root points on a nosecone, canted',
      'freeformfinset root points on a flipped nosecone, canted',
      'trapezoidfinset tab points on a bodytube, tab past the root',
      'trapezoidfinset cut outline on a bodytube, tab outside the fin',
      'freeformfinset cut outline on a transition, tab past the root',
      'freeformfinset cut outline on a nosecone, tab outside the fin',
      'trapezoidfinset tab points on a bodytube, tab by after',
      'trapezoidfinset tab points on a bodytube, tab by absolute',
      'freeformfinset tab points on a transition, tab by after',
      'freeformfinset tab points on a transition, tab by absolute',
      'ellipticalfinset tab points on a bodytube',
      'ellipticalfinset tab points on a bodytube, tab by after',
      'trapezoidfinset outline points on a bodytube, vanishing tip',
      'trapezoidfinset outline points on a bodytube, zero sweep',
      'trapezoidfinset outline points on a bodytube, negative sweep',
      'freeformfinset outline points on a bodytube, first point off the origin',
      'freeformfinset outline points on a transition, first point off the origin',
      'freeformfinset interior point raised to the body on a transition',
      'freeformfinset interior point raised to the body on a nosecone',
      'trapezoidfinset cut outline on a bodytube in a podset',
      'ellipticalfinset cut outline on a bodytube in a podset',
      'freeformfinset cut outline on a bodytube in a podset',
      'freeformfinset cut outline on a nosecone in a podset',
      'trapezoidfinset root points on a bodytube in a podset, canted',
      'trapezoidfinset tab points on a bodytube in a parallelstage',
    ]) {
      expect(checked.get(rule) ?? 0, rule).toBeGreaterThan(5);
    }
  });
});
