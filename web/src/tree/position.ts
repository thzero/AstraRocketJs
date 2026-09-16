import type { ComponentNode, ComponentPosition, RocketTree } from '../engine/openRocketEngine';
import { assemblyChainLength, isAssembly } from './assembly.js';
import { num } from './nodeProps';

/**
 * Axial-position math shared by the 2D schematic (drag) and the property
 * panel (slider snapping). All SI. "start" = a child's leading edge measured
 * from its parent's leading edge.
 */

/**
 * Root chord of a freeform fin: the axial span between the FIRST and LAST
 * points, both of which sit on the body.
 *
 * This matches the kernel exactly — `FreeformFinSet.length = last.x - first.x`.
 * It is deliberately NOT the furthest-aft point (`Math.max`): a fin whose tip
 * trailing corner overhangs the root reaches further aft than its root chord
 * does, and using that overhang puts a bottom- or middle-anchored fin forward
 * of its true station by exactly the overhang — so the app would draw the fin
 * somewhere the engine does not fly it.
 *
 * Exported because four other modules need the same number (the report
 * geometry, the fin-station table, the solid mesh and the 3D view). They each
 * had their own `Math.max` copy, and so disagreed with the schematic about
 * where one fin sits.
 */
export function freeformRootChord(pts: [number, number][] | undefined, fallback = 0.05): number {
  const p = pts ?? [];
  const first = p[0];
  const last = p[p.length - 1];
  const root = first && last && Number.isFinite(first[0]) && Number.isFinite(last[0]) ? last[0] - first[0] : 0;
  return root > 0 ? root : fallback;
}

/**
 * A freeform fin's outline, translated so its first point is the origin.
 *
 * This is what the kernel actually flies. `FreeformFinSet.setPoints()` — the
 * entry point our bridge uses (ComponentFactory.java:211) — does
 *
 *     final CoordinateIF delta = newPoints.get(0).multiply(-1);
 *     if (IGNORE_SMALLER_THAN < delta.length2()) newPoints = translatePoints(newPoints, delta);
 *
 * translating by -p0 in BOTH axes, and it does not touch the axial offset.
 * (`clampFirstPoint()`, which additionally folds xDelta into the offset, is the
 * desktop GUI's per-point edit path, not ours.)
 *
 * The app read the raw points instead, while placing the through-the-wall TAB
 * in root-relative coordinates via `finTabFront(node, root)` with
 * `root = last.x - first.x`. The two agree only when `points[0].x === 0`, and
 * `FreeformFinEditor` lets the first vertex be dragged off it — so a fin whose
 * outline began at x = 20 mm had its tab cut 20 mm out of place on the 1:1 PDF
 * template and in the exported STL, on a part that has to pass through a slot.
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

/** A component's axial extent used for positioning (fins use root chord). */
export function axialLength(n: ComponentNode): number {
  if (n.type === 'freeformfinset') {
    return freeformRootChord(n['points'] as [number, number][] | undefined);
  }
  if (n.type === 'trapezoidfinset' || n.type === 'ellipticalfinset') {
    return num(n, 'rootChord', 0.05);
  }
  if (isAssembly(n.type)) return assemblyChainLength(n);
  return num(n, 'length', num(n, 'packedLength', 0.025));
}

export function startFromPosition(pos: ComponentPosition, childLen: number, pLen: number): number {
  switch (pos.method) {
    case 'middle':
      return (pLen - childLen) / 2 + pos.offset;
    case 'bottom':
      return pLen - childLen + pos.offset;
    case 'absolute':
      return pos.offset;
    case 'top':
    default:
      return pos.offset;
  }
}

export function offsetForStart(
  method: ComponentPosition['method'],
  start: number,
  childLen: number,
  pLen: number,
): number {
  switch (method) {
    case 'middle':
      return start - (pLen - childLen) / 2;
    case 'bottom':
      return start - (pLen - childLen);
    case 'absolute':
      return start;
    case 'top':
    default:
      return start;
  }
}

/**
 * Rewrites every 'absolute' axial position (rocket-origin frame — only file
 * importers produce it) into the equivalent parent-relative 'top' offset.
 * The UI edits positions in the parent frame only: leaving 'absolute' in the
 * tree makes the schematic/property panel (parent frame) disagree with the
 * engine (rocket frame), so geometry drawn ≠ geometry simulated.
 */
export function resolveAbsolutePositions(tree: RocketTree): RocketTree {
  let changed = false;
  const chainTypes = new Set(['nosecone', 'bodytube', 'transition']);

  const fixChildren = (parent: ComponentNode, pStart: number, pLen: number): ComponentNode => {
    if (!parent.children?.length) return parent;
    const children = parent.children.map((child) => {
      let next = child;
      const pos = (child.position ?? { method: 'top', offset: 0 }) as ComponentPosition;
      if (pos.method === 'absolute') {
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
        } as ComponentNode;
      }
      const cLen = axialLength(next);
      const nextPos = (next.position ?? { method: 'top', offset: 0 }) as ComponentPosition;
      const start = pStart + startFromPosition(nextPos, cLen, pLen);
      return fixChildren(next, start, cLen);
    });
    return { ...parent, children } as ComponentNode;
  };

  // Stages flatten into one nose-to-tail chain; chain members stack
  // sequentially (their own position field is not used for layout).
  let x = 0;
  const components = tree.components.map((stage) => {
    const kids = stage.type === 'stage' ? (stage.children ?? []) : [stage];
    const fixedKids = kids.map((n) => {
      const len = chainTypes.has(n.type) ? num(n, 'length', 0) : 0;
      const fixed = fixChildren(n, x, len);
      x += len;
      return fixed;
    });
    return stage.type === 'stage' ? ({ ...stage, children: fixedKids } as ComponentNode) : fixedKids[0]!;
  });
  return changed ? { ...tree, components } : tree;
}

/**
 * Candidate snap starts for a child inside its parent: the parent's ends and
 * middle, plus alignment with every sibling's ends — that's where parts sit
 * in the real airframe (centering rings at motor-tube and fin-root ends,
 * couplers butted against tubes, etc.).
 */
export function anchorStarts(parent: ComponentNode, child: ComponentNode): number[] {
  const pLen = num(parent, 'length', 0.2);
  const cLen = axialLength(child);
  const anchors = new Set<number>([0, pLen - cLen, (pLen - cLen) / 2]);
  for (const sib of parent.children ?? []) {
    if (sib.id === child.id) continue;
    const sLen = axialLength(sib);
    const pos = (sib.position ?? { method: 'top', offset: 0 }) as ComponentPosition;
    const sStart = startFromPosition(pos, sLen, pLen);
    anchors.add(sStart); // align leading edges
    anchors.add(sStart + sLen - cLen); // align trailing edges
    anchors.add(sStart - cLen); // butt in front of the sibling
    anchors.add(sStart + sLen); // butt behind the sibling
    // Fin tabs: centering rings butt against the tab's front/rear edges in
    // real builds (the tab passes through the wall between the rings).
    const tabH = num(sib, 'tabHeight', 0);
    const tabLen = num(sib, 'tabLength', 0);
    if (sib.type.endsWith('finset') && tabH > 0 && tabLen > 0) {
      const method = typeof sib['tabOffsetMethod'] === 'string' ? (sib['tabOffsetMethod'] as string) : 'middle';
      const off = num(sib, 'tabOffset', 0);
      const tabFront =
        sStart + (method === 'top' ? off : method === 'bottom' ? off + sLen - tabLen : off + (sLen - tabLen) / 2);
      anchors.add(tabFront - cLen); // butt in front of the tab
      anchors.add(tabFront + tabLen); // butt behind the tab
      anchors.add(tabFront); // align with tab front
      anchors.add(tabFront + tabLen - cLen); // align with tab rear
    }
  }
  return [...anchors].sort((a, b) => a - b);
}

/** Snaps a desired start to the nearest anchor within epsilon (else unchanged). */
export function snapStart(desired: number, anchors: number[], epsilon: number): number {
  let best = desired;
  let bestDist = epsilon;
  for (const a of anchors) {
    const d = Math.abs(a - desired);
    if (d < bestDist) {
      best = a;
      bestDist = d;
    }
  }
  return best;
}
