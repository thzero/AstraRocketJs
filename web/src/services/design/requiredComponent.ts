import type { RocketTree } from '../../engine/openRocketEngine';
import { walkNodes } from '../../tree/treeWalk';
import { finCant } from '../../tree/nodeProps';
import { finMountOf, finRootChord } from '../../tree/finPlanform';
import { isPlanarFinSet } from '../../tree/tubefins';

/**
 * The component values the kernel cannot fly, so the run refuses them.
 *
 * Lives here rather than in the property panel because two different places
 * need the same answer: the panel, to mark the field, and the run path, to
 * refuse a design built on one. A list in the panel would leave the editor and
 * the Run button deciding "is this valid" separately, and free to disagree.
 *
 * Desktop and the kernel take a zero for nearly every dimension. A nose cone,
 * body tube or transition of no length or radius builds and flies, with at most
 * the low-priority ZERO_VOLUME_BODY warning (BarrowmanCalculator.checkGeometry):
 * the bundled pods example carries its stabilizer on a body tube whose length,
 * radius and wall are all 0. Inner tubes, rings, couplers, lugs, fins of no
 * chord or span, and recovery devices of no size fly the same way. So only these
 * are refused, each one a value the simulation stops on:
 *
 * - a fin count or an instance count of 0, which the bridge refuses when it
 *   builds the rocket ("must be a whole number in 1..8");
 * - a rail button of no diameter or height and a tube fin set of no length,
 *   whose mass properties the kernel computes as NaN, which stops the
 *   simulation.
 *
 * A value the part does not carry is the kernel's default, which flies.
 */
export const REQUIRED_COMPONENT_FIELDS: Record<string, readonly string[]> = {
  trapezoidfinset: ['finCount'],
  ellipticalfinset: ['finCount'],
  freeformfinset: ['finCount'],
  tubefinset: ['finCount', 'length'],
  centeringring: ['instanceCount'],
  bulkhead: ['instanceCount'],
  launchlug: ['instanceCount'],
  railbutton: ['outerDiameter', 'height', 'instanceCount'],
  podset: ['instanceCount'],
  parallelstage: ['instanceCount'],
};

/** A part named by a design check: enough to select it and to label it. */
export interface NamedPart {
  /** Node id, when the part has one; enough to select it in the tree. */
  id?: string;
  type: string;
  /** The part's own name, empty when it has none (the reader labels it). */
  name: string;
}

/** One dimension of one part that cannot be what it currently is. */
export interface BadDimension extends NamedPart {
  field: string;
}

/** True when this value is a usable dimension. Zero is not; nor is a blank. */
export const isDimension = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Every value in the tree the kernel cannot fly ({@link REQUIRED_COMPONENT_FIELDS}),
 * depth first so the order matches the component tree the user is looking at.
 * An absent value is the kernel's default and is not one of them.
 */
export function badDimensions(tree: RocketTree): BadDimension[] {
  const out: BadDimension[] = [];
  for (const n of walkNodes(tree.components ?? [])) {
    for (const field of REQUIRED_COMPONENT_FIELDS[n.type] ?? []) {
      if (n[field] != null && !isDimension(n[field])) {
        out.push({ id: n.id, type: n.type, name: typeof n.name === 'string' ? n.name : '', field });
      }
    }
  }
  return out;
}

/** Stations along the forward half of the root at which the cant reach is checked. */
const CANT_STEPS = 100;

/**
 * Every fin set whose cant turns the front half of its root through the body.
 *
 * The kernel turns a canted fin about the middle of its root and drops each
 * root point back onto the body by `r - sqrt(r^2 - dz^2)`, with
 * `dz = sin|cant| * (x - xCenter)` and `r` the body radius at the turned
 * station `xCenter + (x - xCenter) * |cos(cant)|` (`FinSet.getFinCantYOffset`,
 * FinSet.java:1264-1302, called for each root station from `getMountPoints`,
 * FinSet.java:1198, with the station held to the parent). It guards only
 * `dz >= r`, which a negative `dz` never meets, so a forward station where
 * `|dz|` reaches `r` takes the square root of a negative number and the fin
 * flies NaN points. On a body tube that is `(rootChord / 2) * sin|cant| >= r`.
 * The cant is the one the kernel flies, clamped to `MAX_CANT`.
 */
export function overturnedFins(tree: RocketTree): NamedPart[] {
  const out: NamedPart[] = [];
  for (const n of walkNodes(tree.components ?? [])) {
    if (!isPlanarFinSet(n.type) || !n.id) continue;
    const cant = finCant(n);
    if (cant === 0) continue;
    const mount = finMountOf(tree, n.id);
    if (!mount) continue;
    const xStart = mount.front;
    const xEnd = xStart + finRootChord(n);
    if ((xStart > mount.length && xEnd > mount.length) || (xStart < 0 && xEnd < 0)) continue;
    const xCenter = (xStart + xEnd) / 2;
    const sin = Math.abs(Math.sin(cant));
    const cos = Math.abs(Math.cos(cant));
    for (let i = 0; i < CANT_STEPS; i++) {
      const x = Math.min(Math.max(xStart + ((xCenter - xStart) * i) / CANT_STEPS, 0), mount.length);
      const dx = x - xCenter;
      if (dx >= 0) break;
      if (sin * -dx >= mount.radiusAt(xCenter + dx * cos)) {
        out.push({ id: n.id, type: n.type, name: typeof n.name === 'string' ? n.name : '' });
        break;
      }
    }
  }
  return out;
}
