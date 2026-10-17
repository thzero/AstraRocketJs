import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { KERNEL_AUTO_RADIUS, KERNEL_DEFAULTS, kernelLength } from '../../tree/kernelDefaults';
import { bodyTubeRadius, num, str } from '../../tree/nodeProps';
import { tubeFinRadius } from '../../tree/tubefins';
import { DISC_TYPES } from '../files/componentFormats';
import { COMPONENT_DEFAULTS } from './componentDefaults';
import { boreAround, ringBore, tubeRadii } from './discGeometry';
import { mapTreePreserving, walkNodes, type MapContext } from '../../tree/treeWalk';
import { axialFrames } from '../../tree/axialRebase';
import { isPlanarFinSet } from '../../tree/tubefins';
import { isZero } from '../motors/mathEquals';

/**
 * Diameters that follow the part next door: OpenRocket's **Automatic**
 * checkbox, on a nose cone's base, a transition's two ends and a body tube's
 * outside.
 *
 * The kernel's rules, from `SymmetricComponent`, `Transition` and `BodyTube`:
 *
 * - The part ahead and the part behind are the neighboring symmetric
 *   components (`getPreviousSymmetricComponent`,
 *   `getNextSymmetricComponent`): along the airframe, across stage
 *   boundaries, and across pod sets and side boosters wherever the kernel
 *   counts a part as in line. A pod set or booster on the airframe's axis
 *   (coaxial, or at zero radius) is in line with the airframe, so its parts
 *   and the airframe's are neighbors; a pod's first part may take the tube it
 *   hangs on as the part ahead; and a pod flush with either end of the tube it
 *   hangs on stands in for that tube, through its end part there when that
 *   part is wider, for the part beyond that end. Deciding whether a pod is in
 *   line reads its radius, which reads the tube it stands on, so a neighbor
 *   search can evaluate other tubes partway through.
 * - A transition's automatic fore end takes what the part ahead offers at its
 *   aft end, and its automatic aft end what the part behind offers at its fore
 *   end; with no part there, `DEFAULT_RADIUS`.
 * - An automatic body tube asks the part ahead first and the part behind
 *   second, skipping a neighbor that is itself sizing from this tube, and
 *   falls back to `DEFAULT_RADIUS` (`getAutoOuterRadius`). Whether a
 *   neighboring tube is sizing from this one is whatever that tube last
 *   recorded, so the answer depends on the order the kernel evaluates the
 *   tubes in; {@link resolveAxial} replays that order.
 * - What a part offers (`getFrontAutoRadius`, `getRearAutoRadius`): a cone or
 *   transition offers the end facing the asker unless that end is automatic;
 *   an automatic body tube passes the question on to the part beyond it.
 *
 * A flipped nose cone is a tail cone: its base is the fore end, so an
 * automatic base follows the part ahead of it.
 *
 * Two automatic ends that each follow the other have no answer: the kernel
 * returns -1 for them. The stored radius is kept as it is in that case.
 *
 * Stored as an explicit flag with the resolved number beside it, the same shape
 * as {@link syncAutoShoulders}, rather than as the absence of a radius, which
 * is how the `.ork` spells it. Absence would mean every one of the dozen places
 * that reads a radius to draw, mesh, export or measure has to know the rule and
 * have the chain in hand; the number is kept correct on every edit instead, and
 * only the file writer and the engine bridge care that it was automatic.
 */

type Patch = Partial<Record<string, number | boolean>>;

/** `AxialMethod`, as the bridge reads a position. */
type Axial = 'top' | 'middle' | 'bottom' | 'after' | 'absolute';

/**
 * One component as the kernel holds it while the bridge builds and reads the
 * rocket: its place in the tree, its axial position, and the state the
 * neighbor rules read and write.
 */
interface Part {
  node: ComponentNode | null;
  type: string;
  parent: Part | null;
  /** The children attached so far: the bridge attaches parts one at a time, in tree order. */
  kids: Part[];
  /** Every child in the design. */
  design: Part[];
  /** A body tube, transition or nose cone. */
  symmetric: boolean;
  tube: boolean;
  /** A pod set or booster (`RingInstanceable`). */
  ring: boolean;
  /** A stage, pod set or booster (`ComponentAssembly`). */
  assembly: boolean;
  foreAuto: boolean;
  aftAuto: boolean;
  fore: number;
  aft: number;
  /** `BodyTube.refComp`: the neighbor this tube last took its radius from. */
  ref: Part | null;
  /** `getLength()`. An assembly's is the sum of its parts', and 0 until the rocket is updated. */
  length: number;
  method: Axial;
  offset: number;
  /** `position.x`, from the parent's fore end. */
  x: number;
  radiusMethod: string;
  radiusOffset: number;
  instances: number;
}

const hasRadius = (node: ComponentNode, key: string): boolean => Number.isFinite(node[key]);

const ASSEMBLIES = new Set(['stage', 'podset', 'parallelstage']);
const RINGS = new Set(['podset', 'parallelstage']);
const SYMMETRIC = new Set(['bodytube', 'nosecone', 'transition']);
const AXIAL = new Set<string>(['top', 'middle', 'bottom', 'after', 'absolute']);
const MASS_OBJECTS = new Set(['parachute', 'streamer', 'shockcord', 'masscomponent']);
const RING_PARTS = new Set(['centeringring', 'bulkhead', 'tubecoupler', 'engineblock']);

/**
 * `AxialMethod.getAsPosition`, and for ABSOLUTE `RocketComponent.setAxialOffset`:
 * the offset less the parent's first location, `parentStart`.
 */
function asPosition(method: Axial, offset: number, inner: number, outer: number, parentStart: number): number {
  switch (method) {
    case 'absolute':
      return offset - parentStart;
    case 'middle':
      return offset + (outer - inner) / 2;
    case 'bottom':
      return offset + outer - inner;
    case 'after':
      return outer + offset;
    default:
      return offset;
  }
}

/** `RocketComponent.setAxialOffset` snaps a position within a micrometer to zero. */
const snap = (x: number): number => (Math.abs(x) < 1e-6 ? 0 : x);

/**
 * How deeply tube evaluations may nest. Each level is a pod's in-line check
 * reading the tube the pod hangs on, so a real design nests a few levels; past
 * this the resolver keeps the stored radii rather than recurse without end.
 */
const MAX_DEPTH = 400;

class TooDeep extends Error {}

/** A part as `ComponentFactory.create` and the kernel constructors leave it, before it is attached. */
function partOf(node: ComponentNode | null, type: string): Part {
  const n = node ?? ({} as ComponentNode);
  const r = (key: string) => num(n, key, 0);
  const raw = n.position as { method?: unknown; offset?: unknown } | null | undefined;
  const placed = raw !== null && typeof raw === 'object';
  const rawMethod = placed && typeof raw.method === 'string' ? raw.method.toLowerCase() : '';
  const offset = placed && typeof raw.offset === 'number' && Number.isFinite(raw.offset) ? raw.offset : 0;
  const ring = RINGS.has(type);
  const assembly = ASSEMBLIES.has(type);
  const symmetric = SYMMETRIC.has(type);
  // A body part follows the one before it (AxialMethod.AFTER) unless placed;
  // a pod set or booster sits at the bottom of its parent unless placed, and
  // is never AFTER (ComponentAssembly.setAxialMethod).
  let method: Axial = AXIAL.has(rawMethod) ? (rawMethod as Axial) : placed ? 'top' : 'after';
  if (ring) method = !placed ? 'bottom' : method === 'after' ? 'top' : method;
  if (type === 'stage') method = 'after';
  const p: Part = {
    node,
    type,
    parent: null,
    kids: [],
    design: [],
    symmetric,
    tube: type === 'bodytube',
    ring,
    assembly: assembly || type === 'rocket',
    foreAuto: false,
    aftAuto: false,
    fore: 0,
    aft: 0,
    ref: null,
    // Only a body part's length places anything the neighbor rules read.
    length: symmetric ? num(n, 'length', kernelLength(n.type) ?? 0) : 0,
    method,
    offset,
    // Placed before it has a parent, a part's position is its offset as given.
    x: !ring && placed ? snap(offset) : 0,
    radiusMethod: ring ? str(n, 'radiusMethod', 'relative').toLowerCase().replace(/_/g, '') : 'coaxial',
    radiusOffset: 0,
    instances: ring ? Math.max(1, Math.floor(num(n, 'instanceCount', 2))) : 1,
  };
  // PodSet.setRadiusOffset keeps the offset for RELATIVE and FREE and clamps it
  // to zero for the others, which do not read it.
  if (p.radiusMethod === 'relative' || p.radiusMethod === 'free') p.radiusOffset = num(n, 'radiusOffset', 0);
  if (type === 'bodytube') {
    const auto = n['outerRadiusAuto'] === true;
    const radius = bodyTubeRadius(n);
    Object.assign(p, { foreAuto: auto, aftAuto: auto, fore: radius, aft: radius });
  } else if (type === 'nosecone') {
    // `aftRadius` is the base wherever it sits; flipped, the base is in front.
    const auto = n['aftRadiusAuto'] === true;
    Object.assign(
      p,
      n['flipped'] === true
        ? { fore: r('aftRadius'), aft: 0, foreAuto: auto, aftAuto: false }
        : { fore: 0, aft: r('aftRadius'), foreAuto: false, aftAuto: auto },
    );
  } else if (type === 'transition') {
    Object.assign(p, {
      fore: r('foreRadius'),
      aft: r('aftRadius'),
      // An end with no radius is automatic, as ComponentFactory builds it.
      foreAuto: n['foreRadiusAuto'] === true || !hasRadius(n, 'foreRadius'),
      aftAuto: n['aftRadiusAuto'] === true || !hasRadius(n, 'aftRadius'),
    });
  }
  return p;
}

/**
 * The rocket the bridge builds from the tree (`OpenRocketEngine.buildRocket`):
 * the stages under the rocket, or one stage holding the whole tree when it has
 * none. Nothing is attached yet.
 */
function rocketOf(components: readonly ComponentNode[]): { rocket: Part; staged: boolean } {
  const rocket = partOf(null, 'rocket');
  const make = (node: ComponentNode, parent: Part): Part => {
    const p = partOf(node, node.type);
    p.parent = parent;
    p.design = (node.children ?? []).map((c) => make(c, p));
    return p;
  };
  const staged = components.some((c) => c.type === 'stage');
  if (staged) {
    rocket.design = components.map((c) => make(c, rocket));
  } else {
    const stage = partOf(null, 'stage');
    stage.parent = rocket;
    stage.design = components.map((c) => make(c, stage));
    rocket.design = [stage];
  }
  return { rocket, staged };
}

/**
 * The automatic radii of the airframe parts, keyed by node.
 *
 * An automatic body tube remembers which neighbor it last took its radius from
 * (`BodyTube.refComp`, set in `getAutoOuterRadius`), and a neighbor deciding
 * whether it may use that tube reads the remembered one
 * (`usesPreviousCompAutomatic`, `usesNextCompAutomatic`). Nothing resets it, so
 * a tube's radius depends on every earlier evaluation of it and of its
 * neighbors, including the ones a neighbor search makes on its own (deciding
 * whether a pod is in line reads the tube it stands on). The kernel's answer
 * is therefore replayed call for call, in the order the bridge produces it:
 *
 * 1. Building (`ComponentFactory.attachChildren`), each part is attached in
 *    tree order, so a part evaluated then sees only what is attached before
 *    it. A tube is evaluated while it is built when a part attached inside it
 *    reads its radius: a tabbed fin set (`FinSet.setTabHeight` clamps to the
 *    body), an automatic tube fin set given a wall (`TubeFinSet.setThickness`),
 *    or an automatic coupler or engine block, directly or inside automatic
 *    ones (`ThicknessRingComponent.setThickness` clamps to the bore). Leaving
 *    the default radial method on a pod set or booster reads the tube it
 *    stands on (`PodSet.setRadiusMethod`). Until the rocket is updated, every
 *    part sits where it was placed before it had a parent, and an assembly
 *    has no length.
 * 2. Finishing the build (`createFlightConfiguration`, `enableEvents`), the
 *    whole airframe is in place. Five passes of the active-instance walk
 *    (`FlightConfiguration.getActiveContextListAt`) visit each pod set's or
 *    booster's parts once per copy; a fin set or tube fin set reads its body
 *    and a pod set or booster placed against its parent's surface reads the
 *    parent tube and its own widest part. Then each part is updated in tree
 *    order, which moves it to its real position, and every launch lug and rail
 *    button reads its tube (`LaunchLug.componentChanged`,
 *    `RailButton.componentChanged`); then four more passes of the walk.
 * 3. Settling (the bridge's `settleAutoRadii`), every symmetric part's two
 *    ends are read front to back, once per symmetric part and once more, so a
 *    tube no longer remembers a neighbor from the build that it does not use.
 * 4. Reading the geometry back part by part in tree order
 *    (`getComponentGeometry`) evaluates each automatic tube many times over,
 *    and the parts sized from a body read it again. The evaluation a tube's
 *    own read reports is the radius kept here.
 *
 * Where a part's position along a transition matters to which end it reads,
 * both ends are read.
 */
function resolveAxial(
  components: readonly ComponentNode[],
  out: Map<ComponentNode, Patch>,
  neighbors?: Map<ComponentNode, Neighbors>,
): void {
  const { rocket, staged } = rocketOf(components);
  /** Changes to any `refComp`, so a repeated read can stop once the state settles. */
  let changes = 0;
  let depth = 0;
  /** Parts whose `getComponentLocations` the kernel has cached. */
  const located = new Set<Part>();

  const lengthOf = (p: Part): number => p.length;
  const parentLength = (p: Part): number => (p.parent && p.parent.type !== 'rocket' ? lengthOf(p.parent) : 0);
  /** A part's front from the rocket's origin: `getComponentLocations()[0].getX()`. */
  const frontOf = (p: Part): number => (p.parent ? frontOf(p.parent) + p.x : 0);
  const parentFront = (p: Part): number => (p.parent ? frontOf(p.parent) : 0);
  /** `RocketComponent.getAxialOffset(TOP)` and `(BOTTOM)`; a pod set snaps a near-zero offset to zero. */
  const offsetTop = (p: Part): number => {
    const v = p.x;
    return p.type === 'podset' && Math.abs(v) < 1e-8 ? 0 : v;
  };
  const offsetBottom = (p: Part): number => {
    const v = p.x + lengthOf(p) - parentLength(p);
    return p.type === 'podset' && Math.abs(v) < 1e-8 ? 0 : v;
  };

  /**
   * `RadiusMethod.getRadius(asm.parent, part, asm.radiusOffset)`: how far the
   * assembly's axis sits from its parent's. RELATIVE and SURFACE add the
   * parent tube's radius and, for the assembly itself, its widest part.
   */
  const ringRadius = (asm: Part, part: Part): number => {
    switch (asm.radiusMethod) {
      case 'free':
        return asm.radiusOffset;
      case 'relative':
      case 'surface': {
        let r = asm.radiusMethod === 'relative' ? asm.radiusOffset : 0;
        if (asm.parent?.tube) r += outerRadius(asm.parent);
        if (part.ring) r += boundingRadius(part);
        return r;
      }
      default:
        return 0;
    }
  };

  /** `ComponentAssembly.getBoundingRadius`: the widest body tube or transition end. */
  const boundingRadius = (asm: Part): number => {
    let r = 0;
    for (const c of asm.kids) {
      if (c.tube) r = Math.max(r, outerRadius(c));
      else if (c.symmetric) {
        const fore = foreRadius(c);
        r = Math.max(r, Math.max(fore, aftRadius(c)));
      }
    }
    return r;
  };

  /** `SymmetricComponent.inline`, called on `self`. */
  const inline = (self: Part, candidate: Part): boolean => {
    if (self.parent === candidate.parent) return true;
    const own = self.parent!;
    if (own.ring && !isZero(ringRadius(own, self))) return false;
    const theirs = candidate.parent!;
    if (theirs.ring) {
      // A tube's own pods are never in line with it while it is automatic:
      // their radius would read the tube's radius, which is being worked out.
      if (theirs.parent === self && (self.aftAuto || self.foreAuto)) return false;
      return isZero(ringRadius(theirs, candidate));
    }
    return true;
  };

  /**
   * Where the neighbor walks start: the part's parent, the parent's parent,
   * the parent's index among its siblings, and the index `step` from the
   * part's own. Null when the part is not two levels down.
   */
  const placeOf = (self: Part, step: -1 | 1) => {
    const parent = self.parent;
    const grand = parent?.parent;
    if (!parent || !grand) return null;
    return { parent, grand, i: grand.kids.indexOf(parent), j: parent.kids.indexOf(self) + step };
  };

  /** `SymmetricComponent.getPreviousSymmetricComponent`. */
  const previous = (self: Part): Part | null => {
    const place = placeOf(self, -1);
    if (!place) return null;
    const { parent, grand } = place;
    let { i, j } = place;
    while (i >= 0) {
      const at = grand.kids[i]!;
      if (at.assembly) {
        for (; j >= 0; j--) {
          const sibling = at.kids[j]!;
          if (sibling.symmetric && inline(self, sibling)) return previousFromAssembly(sibling, sibling, 0);
        }
      }
      i--;
      if (i >= 0) j = grand.kids[i]!.kids.length - 1;
    }
    // A part of an assembly hung on a tube in line with it follows that tube
    // if it starts behind the tube's fore end, and otherwise what precedes it.
    if (grand.symmetric && inline(self, grand)) {
      return offsetTop(parent) + offsetTop(self) > 0 ? grand : previous(grand);
    }
    return null;
  };

  /**
   * `SymmetricComponent.getPreviousSymmetricComponentFromComponentAssembly`:
   * an in-line assembly on `parent` whose last part ends flush with it and is
   * wider stands in for it.
   */
  const previousFromAssembly = (parent: Part | null, prev: Part | null, flush: number): Part | null => {
    if (!prev) return parent;
    if (!parent) return prev;
    let max = prev.aftAuto ? 0 : aftRadius(prev);
    let found: Part | null = prev;
    for (const asm of parent.kids.filter((k) => k.assembly)) {
      if (asm.kids.length === 0) continue;
      const last = asm.kids[asm.kids.length - 1]!;
      if (!(last.symmetric && inline(parent, last))) continue;
      const deviation = flush + offsetBottom(asm);
      if (isZero(deviation) && !last.aftAuto && aftRadius(last) > max) {
        found = last;
        max = aftRadius(found);
      }
      found = previousFromAssembly(last, found, deviation);
      if (found && !found.aftAuto) max = aftRadius(found);
    }
    return found;
  };

  /** `SymmetricComponent.getNextSymmetricComponent`. */
  const next = (self: Part): Part | null => {
    const place = placeOf(self, 1);
    if (!place) return null;
    const { parent, grand } = place;
    let { i, j } = place;
    for (; i < grand.kids.length; i++, j = 0) {
      const at = grand.kids[i]!;
      if (!at.assembly) continue;
      for (; j < at.kids.length; j++) {
        const sibling = at.kids[j]!;
        if (sibling.symmetric && inline(self, sibling)) return nextFromAssembly(sibling, sibling, 0);
      }
    }
    // The first in-line part of an assembly hung on this part, or what follows it.
    for (const child of self.kids) {
      if (!child.assembly) continue;
      for (const grandchild of child.kids) {
        if (grandchild.symmetric && inline(self, grandchild)) {
          return offsetBottom(parent) + offsetBottom(self) < 0 ? grandchild : next(grandchild);
        }
      }
    }
    return null;
  };

  /**
   * `SymmetricComponent.getNextSymmetricComponentFromComponentAssembly`: an
   * in-line assembly on `parent` whose first part starts flush with it and is
   * wider stands in for it.
   */
  const nextFromAssembly = (parent: Part | null, nxt: Part | null, flush: number): Part | null => {
    if (!nxt) return parent;
    if (!parent) return nxt;
    let max = nxt.foreAuto ? 0 : foreRadius(nxt);
    let found: Part | null = nxt;
    for (const asm of parent.kids.filter((k) => k.assembly)) {
      if (asm.kids.length === 0) continue;
      const first = asm.kids[0]!;
      if (!(first.symmetric && inline(parent, first))) continue;
      const deviation = flush + offsetTop(asm);
      if (isZero(deviation) && !first.foreAuto && foreRadius(first) > max) {
        found = first;
        max = foreRadius(found);
      }
      found = nextFromAssembly(first, found, deviation);
      if (found && !found.foreAuto) max = foreRadius(found);
    }
    return found;
  };

  /** `usesNextCompAutomatic`: a tube by what it remembers, a cone or transition by its flag. */
  const usesNext = (c: Part): boolean => (c.tube ? c.aftAuto && c.ref === next(c) : c.aftAuto);
  const usesPrevious = (c: Part): boolean => (c.tube ? c.foreAuto && c.ref === previous(c) : c.foreAuto);

  /** `getFrontAutoRadius`: what `c` offers the part behind it. */
  const frontAuto = (c: Part): number => {
    if (c.tube) {
      if (!c.aftAuto) return c.aft;
      const p = previous(c);
      return p ? frontAuto(p) : -1;
    }
    return c.aftAuto ? -1 : c.aft;
  };
  /** `getRearAutoRadius`: what `c` offers the part ahead of it. */
  const rearAuto = (c: Part): number => {
    if (c.tube) {
      if (!c.foreAuto) return c.fore;
      const n = next(c);
      return n ? rearAuto(n) : -1;
    }
    return c.foreAuto ? -1 : c.fore;
  };

  /** `BodyTube.getAutoOuterRadius` (BodyTube.java:91-110). */
  const autoOuterRadius = (t: Part): number => {
    if (++depth > MAX_DEPTH) throw new TooDeep();
    try {
      const remember = (c: Part) => {
        if (t.ref !== c) changes++;
        t.ref = c;
      };
      let r = -1;
      let c = previous(t);
      if (c && !usesNext(c)) {
        r = frontAuto(c);
        remember(c);
      }
      if (r < 0) {
        c = next(t);
        if (c && !usesPrevious(c)) {
          r = rearAuto(c);
          remember(c);
        }
      }
      return r < 0 ? KERNEL_AUTO_RADIUS : r;
    } finally {
      depth--;
    }
  };
  /** `BodyTube.getOuterRadius`: only an automatic tube evaluates anything. */
  const outerRadius = (t: Part): number => (t.foreAuto ? autoOuterRadius(t) : t.fore);
  /** `getForeRadius`: `Transition.getAutoForeRadius` for an automatic end. */
  const foreRadius = (c: Part): number => {
    if (c.tube) return outerRadius(c);
    if (!c.foreAuto) return c.fore;
    const p = previous(c);
    return p ? frontAuto(p) : KERNEL_AUTO_RADIUS;
  };
  /** `getAftRadius`: `Transition.getAutoAftRadius` for an automatic end. */
  const aftRadius = (c: Part): number => {
    if (c.tube) return outerRadius(c);
    if (!c.aftAuto) return c.aft;
    const n = next(c);
    return n ? rearAuto(n) : KERNEL_AUTO_RADIUS;
  };
  /** `SymmetricComponent.getRadius(x)` somewhere along the part: a transition reads both ends. */
  const radiusAlong = (s: Part): void => {
    if (s.tube) outerRadius(s);
    else if (s.symmetric) {
      foreRadius(s);
      aftRadius(s);
    }
  };

  const nearest = (p: Part, test: (a: Part) => boolean): Part | null => {
    for (let a = p.parent; a; a = a.parent) if (test(a)) return a;
    return null;
  };
  const isAutoRing = (p: Part): boolean =>
    (p.type === 'tubecoupler' || p.type === 'engineblock') &&
    (p.node!['outerRadiusAuto'] === true || !hasRadius(p.node!, 'outerRadius'));
  const autoTubeFins = (p: Part): boolean =>
    p.type === 'tubefinset' && (p.node!['outerRadiusAuto'] === true || !hasRadius(p.node!, 'outerRadius'));

  /** `getComponentLocations`, cached per part: a pod set or booster reads its radius computing it. */
  const locate = (p: Part): void => {
    if (located.has(p)) return;
    if (p.parent) locate(p.parent);
    if (p.ring) ringRadius(p, p);
    located.add(p);
  };
  /**
   * An automatic ring's outside (`ThicknessRingComponent.getOuterRadius`,
   * `RadiusRingComponent.getOuterRadius`): where it sits in its parent, then
   * the parent's bore at its two faces.
   */
  const ringOuter = (ring: Part): void => {
    const host = ring.parent;
    if (!host) return;
    locate(host);
    locate(ring);
    for (let face = 0; face < 2; face++) {
      if (isAutoRing(host)) ringOuter(host);
      else radiusAlong(host);
    }
  };
  /** `TubeFinSet.getBodyRadius`: the nearest body part above it. */
  const tubeFinBody = (p: Part): void => {
    const body = nearest(p, (a) => a.symmetric);
    if (body) radiusAlong(body);
  };

  // 1. The build, part by part (ComponentFactory.attachChildren).
  const attach = (parent: Part): void => {
    for (const p of parent.design) {
      parent.kids.push(p);
      const n = p.node;
      if (n) {
        // applyWallThickness
        if (isAutoRing(p)) ringOuter(p);
        if (autoTubeFins(p) && Number.isFinite(n['thickness'])) tubeFinBody(p);
        // applyAssembly: setRadiusMethod reads the radius through the
        // default method, RELATIVE, which adds the parent tube's.
        if (p.ring) {
          p.x = n.position ? snap(asPosition(p.method, p.offset, 0, lengthOf(parent), frontOf(parent))) : 0;
          if (p.radiusMethod !== 'relative' && parent.tube) outerRadius(parent);
        }
        // applyFinTabs: setTabHeight clamps to FinSet.getMaxTabHeight, which
        // reads the body four times, at the fin's front and the tab's two ends.
        if (isPlanarFinSet(p.type) && num(n, 'tabHeight', 0) > 0 && num(n, 'tabLength', 0) > 0 && parent.symmetric) {
          for (let end = 0; end < 4; end++) radiusAlong(parent);
        }
      }
      attach(p);
    }
  };

  // 2. The active-instance walk: an assembly's parts once per copy.
  const instancePass = (): void => {
    const visit = (p: Part): void => {
      if (p.ring && (p.radiusMethod === 'relative' || p.radiusMethod === 'surface')) ringRadius(p, p);
      if (isPlanarFinSet(p.type) && p.parent?.symmetric) radiusAlong(p.parent);
      if (p.type === 'tubefinset') tubeFinBody(p);
      // A copy that changes no remembered neighbor leaves the state as it
      // found it, so every further copy repeats it exactly and is skipped.
      for (let copy = 0; copy < p.instances; copy++) {
        const before = changes;
        for (const k of p.kids) visit(k);
        if (changes === before) break;
      }
    };
    visit(rocket);
  };
  /** The given number of passes, stopping early on the same grounds as a copy. */
  const instancePasses = (count: number): void => {
    for (let pass = 0; pass < count; pass++) {
      const before = changes;
      instancePass();
      if (changes === before) return;
    }
  };
  /** `RocketComponent.setAfter`: just behind the part before it, or at the parent's fore end. */
  const setAfter = (p: Part): void => {
    const siblings = p.parent!.kids;
    const i = siblings.indexOf(p);
    const before = i > 0 ? siblings[i - 1]! : null;
    p.x = before ? before.x + lengthOf(before) : 0;
  };
  /** `update()` as `componentChanged` runs it: the part moves to where it belongs. */
  const update = (p: Part): void => {
    if (p.type === 'rocket') return;
    if (p.assembly) {
      // ComponentAssembly.updateBounds, then its own place, then its parts'.
      p.length = p.kids.filter((k) => k.method === 'after').reduce((s, k) => s + lengthOf(k), 0);
      if (p.method === 'after') setAfter(p);
      else p.x = snap(asPosition(p.method, p.offset, lengthOf(p), parentLength(p), parentFront(p)));
      for (const k of p.kids) if (k.method === 'after') setAfter(k);
    } else if (p.method === 'after') setAfter(p);
    else p.x = snap(asPosition(p.method, p.offset, lengthOf(p), parentLength(p), parentFront(p)));
  };
  const changed = (p: Part): void => {
    located.delete(p);
    update(p);
    if (p.type === 'launchlug') {
      const body = nearest(p, (a) => a.symmetric);
      if (body) {
        locate(body);
        locate(p);
        radiusAlong(body);
        radiusAlong(body);
      }
    }
    if (p.type === 'railbutton') {
      const body = nearest(p, (a) => a.tube);
      if (body) outerRadius(body);
    }
    for (const k of p.kids) changed(k);
  };

  /** Repeat one read's evaluations until they stop changing anything, at most `times`. */
  const settle = (times: number, read: () => void): void => {
    for (let i = 0; i < times; i++) {
      const before = changes;
      read();
      if (changes === before) return;
    }
  };

  /**
   * One pass of the bridge's settleAutoRadii: every symmetric part's two ends
   * read front to back (a tube's both through getOuterRadius). Each pass
   * corrects one more tube of a run, counted from its fixed end, in what it
   * remembers of the neighbor it sizes from.
   */
  const settleAutoRadii = (p: Part): void => {
    if (p.tube) {
      outerRadius(p);
      outerRadius(p);
    } else if (p.symmetric) {
      foreRadius(p);
      aftRadius(p);
    }
    for (const k of p.kids) settleAutoRadii(k);
  };

  // 4. The first read, part by part in tree order (getComponentGeometry).
  /** What each part's own read reports: a tube's radius, a cone's or transition's two ends. */
  const reads = new Map<Part, { radius: number; fore: number; aft: number }>();
  const read = (p: Part): void => {
    const n = p.node;
    if (n && p.type !== 'stage') {
      if (p.tube) {
        // getForeRadius, getAftRadius, eleven profile stations of getRadius
        // and getInnerRadius, then the getOuterRadius it reports.
        if (p.foreAuto) {
          settle(24, () => outerRadius(p));
          const radius = outerRadius(p);
          reads.set(p, { radius, fore: radius, aft: radius });
          outerRadius(p);
        }
      } else if (p.symmetric) {
        const fore = foreRadius(p);
        const aft = aftRadius(p);
        reads.set(p, { radius: 0, fore, aft });
        settle(22, () => radiusAlong(p));
      } else if (isPlanarFinSet(p.type) && p.parent?.symmetric) {
        const parent = p.parent;
        settle(4, () => radiusAlong(parent));
      } else if (autoTubeFins(p)) {
        settle(2, () => tubeFinBody(p));
      } else if (RING_PARTS.has(p.type) && (n['outerRadiusAuto'] === true || isAutoRing(p))) {
        settle(4, () => ringOuter(p));
      } else if (MASS_OBJECTS.has(p.type) && n['radiusAuto'] === true && p.parent) {
        const parent = p.parent;
        // MassObject.getMaxParentRadius: a body's ends or bore, or a ring's bore.
        settle(4, () => (isAutoRing(parent) ? ringOuter(parent) : radiusAlong(parent)));
      }
    }
    for (const k of p.kids) read(k);
  };

  try {
    // A design with stages builds them first and finishes the configuration
    // after; one without builds its parts after, so those passes see nothing.
    if (staged) attach(rocket);
    else rocket.kids.push(rocket.design[0]!);
    instancePasses(3);
    if (!staged) attach(rocket.kids[0]!);
    located.delete(rocket);
    instancePasses(2);
    for (const k of rocket.kids) changed(k);
    instancePasses(4);
    const symmetric = (q: Part): number => (q.symmetric ? 1 : 0) + q.kids.reduce((n, k) => n + symmetric(k), 0);
    for (let pass = symmetric(rocket); pass >= 0; pass--) settleAutoRadii(rocket);
    read(rocket);
    if (neighbors) {
      const record = (p: Part): void => {
        if (p.symmetric && p.node) {
          const before = previous(p);
          const after = next(p);
          neighbors.set(p.node, {
            previous: before?.node ?? null,
            next: after?.node ?? null,
            previousOffers: before ? frontAuto(before) : -1,
            nextOffers: after ? rearAuto(after) : -1,
          });
        }
        for (const k of p.kids) record(k);
      };
      record(rocket);
    }
  } catch (e) {
    // Nested past the limit: the stored radii stay as they are.
    if (e instanceof TooDeep) return;
    throw e;
  }

  for (const [p, r] of reads) {
    const node = p.node!;
    const patch: Patch = {};
    if (p.tube) {
      patch['outerRadius'] = r.radius;
    } else {
      const fore = p.foreAuto ? r.fore : null;
      const aft = p.aftAuto ? r.aft : null;
      if (node.type === 'nosecone') {
        const base = node['flipped'] === true ? fore : aft;
        if (base !== null && base >= 0) patch['aftRadius'] = base;
      } else {
        if (fore !== null && fore >= 0) Object.assign(patch, { foreRadius: fore, foreRadiusAuto: true });
        if (aft !== null && aft >= 0) Object.assign(patch, { aftRadius: aft, aftRadiusAuto: true });
      }
    }
    if (Object.keys(patch).length) out.set(node, patch);
  }
}

/** The symmetric parts ahead of and behind one, as the kernel finds them. */
export interface Neighbors {
  previous: ComponentNode | null;
  next: ComponentNode | null;
  /**
   * The radius the part ahead offers at its aft end (`getFrontAutoRadius`) and
   * the part behind at its fore end (`getRearAutoRadius`): an automatic tube
   * passes the question on to the part beyond it. -1 where there is no part or
   * no fixed radius to offer.
   */
  previousOffers: number;
  nextOffers: number;
}

/**
 * Every airframe part's neighbors once the bridge has built the design
 * (`SymmetricComponent.getPreviousSymmetricComponent` and
 * `getNextSymmetricComponent`), keyed by the nodes of `components`: across
 * stages, through pod sets and boosters in line with the airframe, and through
 * an assembly flush with a tube's end, by the same walk the automatic radii
 * use. A part missing from the map has no neighbor the walk could settle.
 */
export function symmetricNeighbors(components: readonly ComponentNode[]): Map<ComponentNode, Neighbors> {
  const neighbors = new Map<ComponentNode, Neighbors>();
  resolveAxial(components, new Map(), neighbors);
  return neighbors;
}

/**
 * A mass object's packed radius and length once its automatic radius is `r`.
 *
 * The kernel keeps the packed volume, not the length: `MassObject.setRadius`
 * and `setLength` store `radius^2 * length`, and with the radius automatic
 * `getRadius` takes the parent's room and sets `length = volume / radius^2`.
 * So a chute packed 50.8 mm across and 178.6 mm long, set into a 96 mm bore,
 * comes out about 50 mm long. The bridge rebuilds the volume from the radius
 * and length it is sent, so both are written here as the kernel settles them.
 *
 * A node with no radius or length on record is read at the kernel's own
 * defaults for the part, which is what the bridge builds it with.
 */
function packedAtRadius(node: ComponentNode, r: number): Patch {
  const stored = num(
    node,
    'radius',
    node.type === 'masscomponent' ? COMPONENT_DEFAULTS.masscomponent.radius : COMPONENT_DEFAULTS.recovery.packedRadius,
  );
  if (stored === r) return { radius: r };
  const length = num(node, 'length', kernelLength(node.type) ?? 0);
  return { radius: r, length: (stored * stored * length) / (r * r) };
}

/**
 * Whether a centering ring's bore follows the mount through it. A ring with no
 * bore of its own is built by `new CenteringRing()`, whose inner radius is
 * automatic, so the kernel resolves it as it does a ring marked automatic.
 */
const ringBoreAuto = (node: ComponentNode): boolean =>
  node.type === 'centeringring' && (node['innerRadiusAuto'] === true || typeof node['innerRadius'] !== 'number');

/**
 * The rules that look at a part's parent rather than at its neighbors.
 *
 * A ring, coupler, bulkhead or engine block fills the bore of the part it sits
 * in, at its own two faces (`boreAround`), and a centering ring's own bore is
 * the motor mount running through it (`ringBore`). The resolved numbers are
 * stored, so the DXF sheet, the print solids and the drawings read them. A
 * tube fin set with no diameter is sized by the kernel from the body radius
 * and the fin count (`TubeFinSet.getOuterRadius`, ported in tree/tubefins.ts).
 */
function parentDerived(node: ComponentNode, parent: ComponentNode | null, parentStart: number): void {
  if (!parent) return;
  if (node.type === 'tubefinset') {
    const body = parent.type === 'bodytube' ? bodyTubeRadius(parent) : num(parent, 'outerRadius', NaN);
    if (node['outerRadiusAuto'] === true) {
      // The stored radius is the last resolved one, not a size the user chose:
      // `tubeFinRadius` returns any stored radius as is, so it is left out here.
      if (Number.isFinite(body) && body > 0)
        node['outerRadius'] = tubeFinRadius({ ...node, outerRadius: undefined }, body);
    }
    // A tube fin set with no wall of its own takes its parent's, once: the
    // TubeFinSet constructor leaves the wall unset, and attached to a tube the
    // part reports that tube's wall, which it then keeps when the tube's wall
    // changes (desktop 24.12 and the kernel alike). A filled tube reports its
    // radius as its wall (`SymmetricComponent.getThickness`, the rule
    // `autoShoulder` reads a solid part by), and `TubeFinSet.setThickness`
    // clamps whatever it is handed to the fin tube's own radius, resolved
    // above. Stored here, the panel, the drawing and the file state the wall
    // that flies.
    if (tubeFinWallFromParent(node)) {
      const wall = parent['filled'] === true ? body : num(parent, 'thickness', parentWallDefault(parent.type));
      const outer = num(node, 'outerRadius', NaN);
      if (Number.isFinite(wall)) node['thickness'] = Number.isFinite(outer) ? Math.min(wall, outer) : wall;
    }
    return;
  }
  // A mass object's automatic packed radius is the room its parent gives it:
  // `MassObject.getMaxParentRadius`.
  if (node['radiusAuto'] === true) {
    const r =
      parent.type === 'nosecone'
        ? num(parent, 'aftRadius', 0)
        : parent.type === 'transition'
          ? Math.max(num(parent, 'foreRadius', 0), num(parent, 'aftRadius', 0))
          : (tubeRadii(parent)?.innerR ?? 0);
    if (r > 0) Object.assign(node, packedAtRadius(node, r));
  }
  if (!DISC_TYPES.has(node.type)) return;
  if (node['outerRadiusAuto'] === true) {
    const outer = boreAround(node, parent, parentStart);
    // Zero where the parent has no bore there, as at a nose cone's tip: the
    // kernel's answer, which the pre-run check then reports.
    if (outer !== null) node['outerRadius'] = outer;
  }
  if (ringBoreAuto(node)) {
    node['innerRadius'] = ringBore(node, parent, num(node, 'outerRadius', 0), parentStart);
  }
}

/** The parts whose outer radius is automatic when the node states none. */
const KEYLESS_AUTO_OUTER: ReadonlySet<string> = new Set([...DISC_TYPES, 'tubefinset']);

/** A tube fin set that states no wall, so takes its parent's. */
const tubeFinWallFromParent = (node: ComponentNode): boolean =>
  node.type === 'tubefinset' && !Number.isFinite(node['thickness']);

/** A parent's wall when its node states none: the kernel's for its type. */
const parentWallDefault = (type: string): number =>
  (KERNEL_DEFAULTS as Record<string, { thickness?: number } | undefined>)[type]?.thickness ?? NaN;

/**
 * Resolve every automatic diameter in the tree against its current neighbors.
 *
 * Runs after each tree edit, so widening a body tube moves the transition
 * plugged into it in the same keystroke. Returns the same arrays and nodes
 * where nothing changed.
 */
export function syncAutoRadii(tree: RocketTree): RocketTree {
  // The airframe first, from the stored radii of the parts it follows; then
  // everything sized from a parent, pre-order below.
  const axial = new Map<ComponentNode, Patch>();
  resolveAxial(tree.components, axial);
  // Where each part starts, for the parts placed `absolute` (from the nose tip).
  // Lengths alone decide it, and resolving radii changes none.
  const frames = axialFrames(tree);
  const resolve = (n: ComponentNode, { parent }: MapContext): ComponentNode => {
    let node = n;
    // A ring part or tube fin set with no outer radius is built automatic
    // (`ComponentFactory` sets no radius, or `setOuterRadiusAutomatic` on a
    // coupler), so it is marked so here and sized below, and the panel, the
    // drawings and the file state the radius it flies with.
    if (KEYLESS_AUTO_OUTER.has(node.type) && !hasRadius(node, 'outerRadius') && node['outerRadiusAuto'] !== true) {
      node = { ...node, outerRadiusAuto: true };
    }
    // Rings, tube fins and packed devices take their size from what they are
    // inside, not from the part beside them, so they resolve against the
    // parent rather than through the neighbor rules.
    if (
      node['outerRadiusAuto'] === true ||
      ringBoreAuto(node) ||
      node['radiusAuto'] === true ||
      tubeFinWallFromParent(node)
    ) {
      const before = {
        outer: node['outerRadius'],
        inner: node['innerRadius'],
        r: node['radius'],
        wall: node['thickness'],
      };
      const draft = { ...node };
      parentDerived(draft, parent, (parent?.id ? frames.get(parent.id)?.start : undefined) ?? 0);
      if (
        draft['outerRadius'] !== before.outer ||
        draft['innerRadius'] !== before.inner ||
        draft['radius'] !== before.r ||
        draft['thickness'] !== before.wall
      ) {
        node = draft;
      }
    }
    const patch = axial.get(n);
    if (patch && Object.entries(patch).some(([k, v]) => node[k] !== v)) node = { ...node, ...patch };
    return node;
  };
  // Pre-order: children last, so each one sees a parent whose own radius is
  // already resolved. Resolved inside-out, a disc inside an automatic-radius
  // coupler would take the coupler's bare default instead of its real bore (on
  // a 3-inch airframe, a bulkhead 24.00 mm across rather than 72.2), and the
  // schematic, the DXF and the printed template would all repeat it. Every
  // coupler the Add menu makes is automatic.
  const components = mapTreePreserving(tree.components, resolve, 'pre');
  return components === tree.components ? tree : { ...tree, components };
}

/** Whether any transition here has an end with no radius on record. */
function hasKeylessEnd(nodes: readonly ComponentNode[]): boolean {
  for (const n of walkNodes(nodes)) {
    if (n.type === 'transition' && !(hasRadius(n, 'foreRadius') && hasRadius(n, 'aftRadius'))) return true;
  }
  return false;
}

/**
 * The design as the drawings read it: every transition end with no radius on
 * record resolved by {@link syncAutoRadii}, as the bridge flies it (an absent
 * end is automatic to `ComponentFactory`). A tree from an edit or an import has
 * been through `syncAutoRadii` already and comes back as it is, so this costs a
 * walk. The drawings then read each end with `profileEnds`, and the neighbor
 * rule has one copy, here.
 */
export function withKernelEnds(tree: RocketTree): RocketTree {
  return hasKeylessEnd(tree.components) ? syncAutoRadii(tree) : tree;
}

/**
 * {@link withKernelEnds} for an axial chain already flattened out of its stages
 * (`axialChain`). The kernel's neighbor search crosses stage boundaries, so one
 * stage holding the whole chain resolves the same way the stages would.
 */
export function chainWithKernelEnds(chain: ComponentNode[]): ComponentNode[] {
  if (!hasKeylessEnd(chain)) return chain;
  const stage = { type: 'stage', id: 'chain', children: chain } as ComponentNode;
  return syncAutoRadii({ name: '', components: [stage] }).components[0]?.children ?? chain;
}
