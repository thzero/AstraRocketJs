import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { bodyTubeRadius, countOf, num, numOpt } from '../../tree/nodeProps';
import { isFinSet, tubeFinRadius } from '../../tree/tubefins';
import {
  FREEFORM_FALLBACK,
  bodyRadiusAt,
  finCutContour,
  finMount,
  finPointsWithRoot,
  finSpan,
  type FinParent,
} from '../../tree/finPlanform';
import { nodeShape, outerProfile, profileEnds } from '../../tree/shapeProfile';
// From `tree/position`, the one home of the axial placement formula;
// `tree/schematicGeometry` re-exports the same `axialStart`.
import { axialChain, axialStart, partLength } from '../../tree/position';
import {
  assemblyChainLength,
  assemblyParentRadius,
  isAssembly,
  resolveAssemblyRadius,
  ringInstanceOffsets,
} from '../../tree/assembly';

/**
 * Geometry for the PDF report, all in millimeters, so the PDF (built in mm)
 * can draw templates at true 1:1 and the side view to scale. Vector only.
 */

export type Pt = [number, number];
// Imported, not redeclared: this is the one unit constant shared by every
// dimensional export.
import { M_TO_MM } from '../../prefs/units';
import { KERNEL_DEFAULTS } from '../../tree/kernelDefaults';

/**
 * A fin's cut outline (mm): the outline, the root along its parent and the tab
 * folded in below, as {@link finCutContour} gives it for the STL and the DXF.
 */
// Not `| null`: there is no input this returns null for; a degenerate freeform
// outline prints the shared placeholder. Tube fins, the one fin type with no
// planform, are filtered out before this is reached (isPlanarFinSet).
export function finPlanformMm(node: ComponentNode, parent: FinParent = null): { pts: Pt[]; count: number } {
  const height = finSpan(node);
  // The outline comes from the one fin-geometry module (tree/finPlanform.ts), so
  // the 1:1 cutting template, the DXF and the fin the kernel flies are the same
  // shape. Sampling an elliptical curve here instead yields a sine arch.
  const contour = finCutContour(node, parent) ?? FREEFORM_FALLBACK;
  // Flip to the PDF's frame: the body surface under the fin front sits at
  // y = height and the span rises toward 0, so the template prints tip-up.
  const pts: Pt[] = contour.map(([x, y]) => [x * M_TO_MM, (height - y) * M_TO_MM]);
  return { pts, count: countOf(node, 'finCount', 3) };
}

/** A revolved part's side outline (mm), centered on its own centerline. */
export function profileMm(
  node: ComponentNode,
  foreR: number,
  aftR: number,
): { w: number; h: number; pts: Pt[] } | null {
  const len = partLength(node);
  if (len <= 0) return null;
  const clipped = typeof node['clipped'] === 'boolean' ? node['clipped'] : undefined;
  const prof = outerProfile(nodeShape(node), numOpt(node, 'shapeParameter'), len, foreR, aftR, 80, undefined, clipped);
  const maxR = Math.max(...prof.map(([, r]) => r), aftR, foreR);
  const h = maxR * 2 * M_TO_MM;
  const cy = h / 2;
  const top: Pt[] = prof.map(([x, r]) => [x * M_TO_MM, cy - r * M_TO_MM]);
  const bot: Pt[] = [...prof].reverse().map(([x, r]) => [x * M_TO_MM, cy + r * M_TO_MM]);
  return { w: len * M_TO_MM, h, pts: [...top, ...bot] };
}

/**
 * Whole-rocket side view (mm) about the centerline (y = 0, +up): one closed
 * airframe silhouette (nose → body → transition, top edge then mirrored bottom)
 * plus a filled fin polygon on the top and bottom of each fin set. Filled, so
 * it reads as a solid rocket rather than loose lines.
 */
export function rocketSideView(tree: RocketTree): { w: number; h: number; body: Pt[]; fins: Pt[][]; pods: Pt[][] } {
  const chain = axialChain(tree);
  const fins: Pt[][] = [];
  /** One closed silhouette per off-axis assembly instance, beside the airframe. */
  const pods: Pt[][] = [];
  let maxUp = 0.001;
  let maxX = 0;

  /**
   * The parent's outer radius at a station `lx` along it (meters, local),
   * `SymmetricComponent.getRadius`. A child stands at the radius under its own
   * station, not at the parent's aft end.
   */
  const radiusSampler = (node: ComponentNode) => (lx: number) => bodyRadiusAt(node, lx) ?? 0;

  /**
   * A fin set's silhouette, mirrored about the centerline it is mounted on.
   *
   * `cy` is that centerline: 0 for the airframe, and the instance offset for a
   * fin on a pod, so a booster's fins straddle the booster rather than the
   * rocket's own axis.
   */
  const addFins = (
    node: ComponentNode,
    parent: ComponentNode,
    pStart: number,
    pLen: number,
    radiusAt: (lx: number) => number,
    cy: number,
  ) => {
    const push = (plan: Pt[], topR: number) => {
      fins.push(plan.map(([px, py]) => [px * M_TO_MM, (cy + py) * M_TO_MM]));
      fins.push(plan.map(([px, py]) => [px * M_TO_MM, (cy - py) * M_TO_MM])); // mirror below
      maxUp = Math.max(maxUp, Math.abs(cy) + topR);
    };

    if (node.type === 'tubefinset') {
      // A tube fin is a tube: in side view a rectangle 2*rt tall standing on the
      // body surface and running the tube's own length. Same silhouette the 2D
      // schematic draws (schematicShapes.tsx).
      //
      // Its span is its length, not a rootChord (it has none), with the
      // kernel's default when unset (ComponentFactory builds a tube fin set
      // 100 mm long). The span also picks the station the body radius is sampled
      // at, so a wrong span would draw the tubes floating off, or buried in, a
      // boat tail's taper.
      const len = num(node, 'length', KERNEL_DEFAULTS.tubefinset.length);
      const s0 = axialStart(node, len, pStart, pLen);
      const R = radiusAt(s0 - pStart);
      const rt = tubeFinRadius(node, R);
      const topR = R + 2 * rt;
      push(
        [
          [s0, R],
          [s0, topR],
          [s0 + len, topR],
          [s0 + len, R],
        ],
        topR,
      );
      return;
    }

    const mount = finMount(node, parent, pStart);
    if (!mount) return;
    const height = finSpan(node);
    const start = pStart + mount.front;
    const R = mount.radiusAt(mount.front);
    // The outline and the root along the parent's own profile, from the one
    // fin-geometry module (tree/finPlanform.ts), lifted by the radius under the
    // fin front (`FinSet.getFinFront().getY()`): on a taper the root follows the
    // body.
    const outline = finPointsWithRoot(node, mount) ?? FREEFORM_FALLBACK;
    push(
      outline.map(([px, py]) => [start + px, R + py]),
      R + height,
    );
  };

  // `walkChain` and `emitAssembly` are mutually recursive (a pod has its own
  // chain, and that chain can carry pods of its own), so they are function
  // declarations rather than consts.

  /**
   * Walk one nose-to-tail chain and return its top profile as `(x, radius)` in
   * meters, plus where it ends. Fin sets and off-axis assemblies hanging off it
   * are emitted into the shared collectors as we go.
   *
   * `cy` is the centerline this chain is drawn about: 0 for the airframe, the
   * instance offset for a pod.
   */
  function walkChain(nodes: ComponentNode[], xStart: number, cy: number): { profile: Pt[]; endX: number } {
    const profile: Pt[] = [];
    let x = xStart;
    let chainMaxR = 0.001;

    const revolve = (node: ComponentNode, foreR: number, aftR: number, len: number) => {
      const shape = nodeShape(node);
      const clipped = typeof node['clipped'] === 'boolean' ? node['clipped'] : undefined;
      for (const [px, r] of outerProfile(
        shape,
        numOpt(node, 'shapeParameter'),
        len,
        foreR,
        aftR,
        60,
        undefined,
        clipped,
      )) {
        profile.push([x + px, r]);
        chainMaxR = Math.max(chainMaxR, r);
      }
    };

    const emitChildren = (n: ComponentNode, hostLen: number, radiusAt: (lx: number) => number) => {
      const hostStart = x;
      for (const c of n.children ?? []) {
        const t = String(c.type);
        if (isFinSet(t)) addFins(c, n, hostStart, hostLen, radiusAt, cy);
        else if (isAssembly(t)) emitAssembly(c, n, hostStart, hostLen, cy);
      }
    };

    for (const n of nodes) {
      const len = partLength(n);
      if (n.type === 'nosecone' || n.type === 'transition') {
        // A flipped nose cone is a tail cone: its base is the fore end.
        const { fore: foreR, aft: aftR } = profileEnds(n);
        revolve(n, foreR, aftR, len);
        // Transitions host fin sets too (treeEdit.canHost allows freeform fins on
        // one), so a boat-tail-mounted fin set is drawn from here; skipping it
        // would show a finless rocket in the side view, with no warning.
        emitChildren(n, len, radiusSampler(n));
        x += len;
      } else if (n.type === 'bodytube') {
        const R = bodyTubeRadius(n);
        profile.push([x, R], [x + len, R]);
        chainMaxR = Math.max(chainMaxR, R);
        emitChildren(n, len, radiusSampler(n));
        x += len;
      }
      // A stage or a pod holds body components only (`AxialStage.isCompatible`,
      // `PodSet.isCompatible`), so an assembly is never a chain member here: the
      // kernel refuses to build such a tree.
    }

    maxUp = Math.max(maxUp, Math.abs(cy) + chainMaxR);
    maxX = Math.max(maxX, x);
    return { profile, endX: x };
  }

  /**
   * One off-axis assembly: its own chain, drawn once per ring instance beside
   * the airframe, exactly as the 2D schematic draws it (schematicShapes.tsx,
   * the `isAssembly` branch). The side view projects `y` and ignores depth `z`.
   *
   * Without this the PDF's whole-rocket figure would show a strap-on booster
   * cluster as a single plain tube, silently disagreeing with the screen.
   *
   * `host` is the part the pod is attached to: the kernel adds a host's radius
   * only for a body tube (`assemblyParentRadius`).
   */
  function emitAssembly(pod: ComponentNode, host: ComponentNode, hostStart: number, hostLen: number, cy: number) {
    const podLen = assemblyChainLength(pod);
    const podStart = axialStart(pod, podLen, hostStart, hostLen);
    const podRadius = resolveAssemblyRadius(pod, assemblyParentRadius(host));
    const count = countOf(pod, 'instanceCount', 2);
    for (const off of ringInstanceOffsets(count, podRadius, num(pod, 'angleOffset', 0))) {
      const center = cy + off.y;
      const { profile } = walkChain(pod.children ?? [], podStart, center);
      if (profile.length < 2) continue;
      pods.push([
        ...profile.map(([px, r]) => [px * M_TO_MM, (center + r) * M_TO_MM] as Pt),
        ...[...profile].reverse().map(([px, r]) => [px * M_TO_MM, (center - r) * M_TO_MM] as Pt),
      ]);
    }
  }

  const main = walkChain(chain, 0, 0);
  // Close the silhouette: top edge forward to aft, then the mirrored bottom back.
  const body: Pt[] = [
    ...main.profile.map(([px, r]) => [px * M_TO_MM, r * M_TO_MM] as Pt),
    ...[...main.profile].reverse().map(([px, r]) => [px * M_TO_MM, -r * M_TO_MM] as Pt),
  ];
  return { w: maxX * M_TO_MM, h: 2 * maxUp * M_TO_MM, body, fins, pods };
}
