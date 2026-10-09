import type { ComponentNode, ComponentPosition, RocketTree } from '../engine/openRocketEngine';
import { assemblyChainLength, isAssembly } from './assembly.js';
import { isChainType } from './componentKinds';
import { FIN_DEFAULTS, kernelLength } from './kernelDefaults';
import { num, positionOf } from './nodeProps';

/**
 * Axial-position math shared by the 2D schematic (drag) and the property
 * panel (slider snapping). All SI. "start" = a child's leading edge measured
 * from its parent's leading edge.
 */

/**
 * Root chord of a freeform fin: the axial span between the first and last
 * points, both of which sit on the body.
 *
 * This matches the kernel exactly: `FreeformFinSet.length = last.x - first.x`.
 * It is deliberately not the furthest-aft point (`Math.max`): a fin whose tip
 * trailing corner overhangs the root reaches further aft than its root chord
 * does, and using that overhang puts a bottom- or middle-anchored fin forward
 * of its true station by exactly the overhang, so the app would draw the fin
 * somewhere the engine does not fly it.
 *
 * Exported so every module that needs the number (the report geometry, the
 * fin-station table, the solid mesh, the 3D view) agrees with the schematic
 * about where one fin sits.
 */
export function freeformRootChord(
  pts: [number, number][] | undefined,
  fallback: number = FIN_DEFAULTS.rootChord,
): number {
  const p = pts ?? [];
  const first = p[0];
  const last = p[p.length - 1];
  const root = first && last && Number.isFinite(first[0]) && Number.isFinite(last[0]) ? last[0] - first[0] : 0;
  return root > 0 ? root : fallback;
}

/**
 * A freeform fin's outline, translated so its first point is the origin.
 *
 * This is what the kernel actually flies. `FreeformFinSet.setPoints()`, the
 * entry point our bridge uses (ComponentFactory, case "freeformfinset"), does
 *
 *     final CoordinateIF delta = newPoints.get(0).multiply(-1);
 *     if (IGNORE_SMALLER_THAN < delta.length2()) newPoints = translatePoints(newPoints, delta);
 *
 * translating by -p0 in both axes, and it does not touch the axial offset.
 * (`clampFirstPoint()`, which additionally folds xDelta into the offset, is the
 * desktop GUI's per-point edit path, not ours.)
 *
 * The through-the-wall tab is placed in root-relative coordinates (`finTabSpan`,
 * which measures from the root chord rather than from the first point). Raw
 * points agree with that only when `points[0].x === 0`, and `FreeformFinEditor`
 * lets the first vertex be dragged off it, so reading raw points would cut the
 * tab of a fin whose outline begins at x = 20 mm 20 mm out of place on the 1:1
 * PDF template and in the exported STL, on a part that has to pass through a slot.
 */
export function normalizeFreeformPoints(pts: [number, number][] | undefined): [number, number][] {
  const p = pts ?? [];
  const p0 = p[0];
  if (!p0 || !Number.isFinite(p0[0]) || !Number.isFinite(p0[1])) return p;
  if (p0[0] === 0 && p0[1] === 0) return p; // already the kernel's invariant
  return p.map(([x, y]) => [x - p0[0], y - p0[1]]);
}

/** A freeform node's outline in kernel coordinates. */
export function freeformPoints(n: ComponentNode): [number, number][] {
  return n.type === 'freeformfinset' ? normalizeFreeformPoints(n['points'] as [number, number][] | undefined) : [];
}

/**
 * A part's own `length`, else the kernel's length for its type, else 0 for a
 * type the factory reads none for. Not the positioning extent (fins and
 * assemblies differ there): see {@link axialLength}.
 */
export function partLength(n: ComponentNode): number {
  return num(n, 'length', kernelLength(n.type) ?? 0);
}

/** A component's axial extent used for positioning (fins use root chord). */
export function axialLength(n: ComponentNode): number {
  if (n.type === 'freeformfinset') {
    return freeformRootChord(n['points'] as [number, number][] | undefined);
  }
  if (n.type === 'trapezoidfinset' || n.type === 'ellipticalfinset') {
    return num(n, 'rootChord', FIN_DEFAULTS.rootChord);
  }
  if (isAssembly(n.type)) return assemblyChainLength(n);
  // `length` only. A recovery device's packed length arrives in it too:
  // orkImport reads <packedlength> straight into `length`, and the Java
  // factory reads the same key back out, so there is no separate
  // `packedLength` key to fall back to.
  //
  // The fallback is the kernel's per-type default, not one number for every
  // type. A single 0.025 (the parachute / streamer / shock-cord value) would
  // lay out a bulkhead or centering ring that lost its `length` at 25 mm where
  // the engine flies 2 mm, and a tube fin set at 25 mm where it flies 100 mm.
  // Types the factory reads no length for (a rail button, a stage) resolve to
  // 0, which is the kernel's own RocketComponent.length initial value.
  return partLength(n);
}

/**
 * The rocket's top-level components with every stage flattened into its
 * children, in nose-to-tail order (sustainer first, boosters after). A
 * top-level node that is not a stage (a legacy flat tree) passes through.
 */
export function axialChain(tree: RocketTree): ComponentNode[] {
  return tree.components.flatMap((n) => (n.type === 'stage' ? (n.children ?? []) : [n]));
}

/**
 * Where a motor's forward end sits (m, same frame as `mountStart`): flush
 * with the mount's aft end, pushed aft by the mount's `motorOverhang`. The
 * kernel's `getMotorPosition` in InnerTube and BodyTube returns
 * `getLength() - motor.getLength() + getMotorOverhang()` relative to the
 * mount's front; this adds the mount's own start.
 */
export function motorSeatStart(mount: ComponentNode, mountStart: number, mountLen: number, motorLen: number): number {
  return mountStart + mountLen - motorLen + num(mount, 'motorOverhang', 0);
}

/**
 * A child's leading edge in the rocket frame: the parent's start plus the
 * child's parent-relative start. The one reader the report geometry and the
 * schematic share, so the PDF cannot place a part where the drawing does not.
 */
export function axialStart(child: ComponentNode, childLen: number, pStart: number, pLen: number): number {
  return pStart + startFromPosition(positionOf(child), childLen, pLen);
}

export function startFromPosition(pos: ComponentPosition, childLen: number, pLen: number): number {
  switch (pos.method) {
    case 'middle':
      return (pLen - childLen) / 2 + pos.offset;
    case 'bottom':
      return pLen - childLen + pos.offset;
    case 'absolute':
      return pos.offset;
    // 'after' is resolved to 'top' on load (resolveFilePositions) because it is
    // relative to a sibling, which this function is not given. Reaching here
    // means an unresolved tree; the offset is the kernel's zero, so it lands at
    // the parent's top.
    case 'after':
    case 'top':
    default:
      return pos.offset;
  }
}

/**
 * Rewrites every axial position the editor cannot work in ('absolute', the
 * rocket-origin frame, and 'after', the previous-sibling frame, both of which
 * only file importers produce) into the equivalent parent-relative 'top'
 * offset.
 * The UI edits positions in the parent frame only: leaving 'absolute' in the
 * tree makes the schematic/property panel (parent frame) disagree with the
 * engine (rocket frame), so geometry drawn ≠ geometry simulated.
 */
export function resolveFilePositions(tree: RocketTree): RocketTree {
  let changed = false;

  const fixChildren = (parent: ComponentNode, pStart: number, pLen: number): ComponentNode => {
    if (!parent.children?.length) return parent;
    // Aft end of the previous sibling, in the parent's frame: what 'after' means.
    let prevEndRel = 0;
    const children = parent.children.map((child) => {
      let next = child;
      // Validated, not cast: a file can carry a string offset or a method the
      // union does not know, and neither must reach the arithmetic below as-is.
      const pos = positionOf(child);
      if (pos.method === 'after') {
        changed = true;
        // AxialMethod.AFTER: the aft end of the previous sibling, or 0 for the
        // first child, and the stored offset is ignored because the kernel
        // forces it to zero (RocketComponent.setAfter). We use the previous
        // sibling rather than the previous active one: configuration activity
        // is not modeled here, and an inactive sibling is rare.
        const resolved = prevEndRel;
        next = {
          ...child,
          position: { method: 'top', offset: resolved, ork: { method: 'after', offset: pos.offset, resolved } },
        };
      } else if (pos.method === 'absolute') {
        changed = true;
        const resolved = pos.offset - pStart;
        // Keep what the file said so the exporter can write it back unchanged.
        next = {
          ...child,
          position: {
            method: 'top',
            offset: resolved,
            ork: { method: 'absolute', offset: pos.offset, resolved },
          },
        };
      }
      const cLen = axialLength(next);
      const relStart = startFromPosition(positionOf(next), cLen, pLen);
      prevEndRel = relStart + cLen;
      return fixChildren(next, pStart + relStart, cLen);
    });
    return { ...parent, children };
  };

  // Stages flatten into one nose-to-tail chain; chain members stack
  // sequentially (their own position field is not used for layout).
  //
  // A stage child that is not a chain member (a podset, a parallel stage, a
  // stage-level mass component) does not consume axial space in the chain, but
  // it does have its own length and its own position against the stage. Each
  // one is walked with its own extent, anchored where its position puts it in
  // the stage. Walking it with a parent length of 0 would make
  // `startFromPosition` resolve a `middle` child to -childLen/2, forward of the
  // assembly's own nose, so an `after` sibling would chain off a wrong station
  // and an `absolute` child would be rebased against the wrong origin.
  let x = 0;
  const components = tree.components.map((stage) => {
    const kids = stage.type === 'stage' ? (stage.children ?? []) : [stage];
    const stageStart = x;
    // The stage's axial extent is its chain members; that is what an off-axis
    // child's own `middle`/`bottom` position is measured against.
    // partLength: a member with no length key is laid out at the kernel's
    // length for its type, the length it is drawn and flown at.
    const stageLen = kids.reduce((sum, n) => sum + (isChainType(n.type) ? partLength(n) : 0), 0);
    const fixedKids = kids.map((n) => {
      if (isChainType(n.type)) {
        const len = partLength(n);
        const fixed = fixChildren(n, x, len);
        x += len;
        return fixed;
      }
      const own = axialLength(n);
      return fixChildren(n, stageStart + startFromPosition(positionOf(n), own, stageLen), own);
    });
    return stage.type === 'stage' ? { ...stage, children: fixedKids } : fixedKids[0]!;
  });
  return changed ? { ...tree, components } : tree;
}
