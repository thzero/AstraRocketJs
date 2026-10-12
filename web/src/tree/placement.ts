import type { ComponentNode } from '../engine/openRocketEngine';
import { clusterPoints } from './cluster';
import { num, positionOf } from './nodeProps';

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
 * puts copy i at `i × instanceSeparation` behind the first (separation 0 by
 * default, so the copies coincide until one is set). Each copy is the part
 * with its axial offset moved by that much, whatever method it is placed by,
 * so a view that draws one part draws them all. Any other part is itself.
 */
export function lineInstances(node: ComponentNode): ComponentNode[] {
  if (!LINE_INSTANCE_TYPES.has(node.type)) return [node];
  const count = Math.max(1, Math.round(num(node, 'instanceCount', 1)));
  if (count === 1) return [node];
  const separation = num(node, 'instanceSeparation', 0);
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
