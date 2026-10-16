import type { ComponentNode } from '../engine/openRocketEngine';
import { ASSEMBLY_TYPES, isChainType, type AssemblyType } from './componentKinds';
import { kernelLength } from './kernelDefaults';
import { bodyTubeRadius, chainOuterRadius, num } from './nodeProps';

/**
 * Geometry helpers for off-axis assemblies (PodSet / ParallelStage), shared
 * by the 2D schematic and the 3D view so both agree on where a pod sits. All SI
 * (meters, radians). Mirrors the kernel: instances ring the parent axis at
 * y = r·cosθ, z = r·sinθ (PodSet getInstanceOffsets), and the `relative`
 * radius is a gap from the parent surface.
 */

/**
 * Total axial length of the assembly's own body chain (m): its chain members
 * (a mini nose→body→transition stack), per the one `CHAIN_TYPES` table in
 * componentKinds.ts rather than a local copy of it. A member with no `length`
 * counts at the kernel's default for its type, as `partLength` reads it
 * (position.ts imports this module, so the rule is repeated here).
 */
export function assemblyChainLength(pod: ComponentNode): number {
  return (pod.children ?? [])
    .filter((c) => isChainType(c.type))
    .reduce((s, c) => s + num(c, 'length', kernelLength(c.type) ?? 0), 0);
}

/** Largest outer radius among the assembly's own body chain (m). */
export function assemblyBoundingRadius(pod: ComponentNode): number {
  let r = 0;
  for (const c of pod.children ?? []) r = Math.max(r, chainOuterRadius(c));
  return r;
}

/**
 * Distance (m) from the parent centerline to the assembly's centerline,
 * `RadiusMethod.getRadius`:
 * - `relative` (default): `radiusOffset` is a gap from the parent surface, so
 *   the resolved radius = offset + parentOuterRadius + assemblyBoundingRadius
 *   (offset 0 ⇒ the pod just touches the airframe).
 * - `surface`: touching the parent surface, whatever the offset:
 *   parentOuterRadius + assemblyBoundingRadius.
 * - `free`: `radiusOffset` is measured straight from the parent centerline.
 * - `coaxial`: on the parent's axis, 0.
 *
 * `parentOuterRadius` is the parent's radius when the parent is a body tube
 * and 0 for any other parent: the kernel adds a parent's radius only for a
 * `BodyTube` ({@link assemblyParentRadius}).
 */
export function resolveAssemblyRadius(pod: ComponentNode, parentOuterRadius: number): number {
  const offset = num(pod, 'radiusOffset', 0);
  const method = typeof pod['radiusMethod'] === 'string' ? pod['radiusMethod'] : 'relative';
  if (method === 'free') return offset;
  if (method === 'coaxial') return 0;
  if (method === 'surface') return parentOuterRadius + assemblyBoundingRadius(pod);
  return offset + parentOuterRadius + assemblyBoundingRadius(pod);
}

/**
 * The parent radius an assembly is placed against: a body tube's outer
 * radius, and 0 for a stage, nose cone, transition or anything else, which
 * `RadiusMethod` does not add (it reads `BodyTube.getOuterRadius` only).
 */
export function assemblyParentRadius(parent: ComponentNode | null | undefined): number {
  return parent?.type === 'bodytube' ? bodyTubeRadius(parent) : 0;
}

export interface RingInstance {
  y: number;
  z: number;
  angle: number;
}

/**
 * The `count` instance centers around the parent axis at `radius`, spaced
 * evenly from `angleOffset` (rad). y = r·cosθ, z = r·sinθ, the kernel's
 * PodSet convention. The 2D view projects `y` and ignores `z`.
 */
export function ringInstanceOffsets(count: number, radius: number, angleOffset = 0): RingInstance[] {
  const n = Math.max(1, Math.round(count));
  const out: RingInstance[] = [];
  for (let i = 0; i < n; i++) {
    const angle = angleOffset + (2 * Math.PI * i) / n;
    out.push({ y: radius * Math.cos(angle), z: radius * Math.sin(angle), angle });
  }
  return out;
}

/**
 * Whether a type is an off-axis assembly. A type guard over the
 * `ASSEMBLY_TYPES` table (componentKinds.ts), so a caller holding a
 * `ComponentType` gets `AssemblyType` back instead of a bare boolean over a
 * string comparison that nothing tied to the union.
 */
export function isAssembly(type: string): type is AssemblyType {
  return (ASSEMBLY_TYPES as ReadonlySet<string>).has(type);
}
