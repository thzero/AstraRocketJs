import type { ComponentNode } from '../engine/openRocketEngine';
import { clusterPoints } from './cluster';
import { countOf, num, positionOf } from './nodeProps';
import { defaultSeparation } from './kernelDefaults';

/**
 * Where the copies of one part sit, as the kernel flies them, for the views to
 * draw: every copy along the body, and every place across it.
 */

/**
 * The parts the kernel repeats along the body (`LineInstanceable`, less the
 * ring-instanced fin and pod sets): `RadiusRingComponent` (centering rings and
 * bulkheads), `LaunchLug` and `RailButton`.
 */
const LINE_INSTANCE_TYPES: ReadonlySet<string> = new Set(['centeringring', 'bulkhead', 'launchlug', 'railbutton']);

/**
 * One node per copy of a part repeated along the body: `getInstanceOffsets`
 * puts copy i at `i × instanceSeparation` behind the first. A node with no
 * spacing of its own flies the kernel's (`defaultSeparation`): a lug's or rail
 * button's constructor spacing, and 0 for a ring part, whose copies coincide.
 * Each copy is the part with its axial offset moved by that much, whatever
 * method it is placed by, so a view that draws one part draws them all. Any other part is itself.
 */
export function lineInstances(node: ComponentNode): ComponentNode[] {
  if (!LINE_INSTANCE_TYPES.has(node.type)) return [node];
  const count = countOf(node, 'instanceCount', 1);
  if (count === 1) return [node];
  const separation = num(node, 'instanceSeparation', defaultSeparation(node.type));
  const pos = positionOf(node);
  return Array.from({ length: count }, (_, i) =>
    i === 0 ? node : { ...node, position: { ...pos, offset: pos.offset + i * separation } },
  );
}

/**
 * Where an internal part sits across its parent, in the kernel's frame
 * (y = r cos θ, z = r sin θ): an inner tube once per cluster place, as
 * `InnerTube.getClusterPoints` puts them (its pattern turned by
 * `clusterRotation − radialDirection`, then shifted by its own radial offset),
 * and any other part once, at its `radialPosition` in its `radialDirection`.
 */
export function placementOffsets(node: ComponentNode, tubeOuterRadius: number): { y: number; z: number }[] {
  const radialPosition = num(node, 'radialPosition', 0);
  const radialDirection = num(node, 'radialDirection', 0);
  if (node.type === 'innertube') {
    return clusterPoints(
      node['cluster'] as string | undefined,
      tubeOuterRadius,
      num(node, 'clusterScale', 1),
      num(node, 'clusterRotation', 0),
      radialPosition,
      radialDirection,
    ).map((p) => ({
      y: p.radialPosition * Math.cos(p.radialDirection),
      z: p.radialPosition * Math.sin(p.radialDirection),
    }));
  }
  return [{ y: radialPosition * Math.cos(radialDirection), z: radialPosition * Math.sin(radialDirection) }];
}

/**
 * A place across the parent, `{ y, z }` in the kernel's frame, turned about the
 * axis by `angle` (rad): `Transformation.rotate_x` (Transformation.java:263-271).
 * Every part inside a pod or booster instance is turned by that instance's
 * angle (FlightConfiguration.java:466-472), and a view's roll turns the rest.
 */
export function turnedOffset(off: { y: number; z: number }, angle: number): { y: number; z: number } {
  if (angle === 0) return { y: off.y, z: off.z };
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { y: off.y * c - off.z * s, z: off.y * s + off.z * c };
}
