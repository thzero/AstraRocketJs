import type { ComponentNode } from '../engine/openRocketEngine';
import { FIN_SET_TYPES, PLANAR_FIN_TYPES, type FinSetType, type PlanarFinSetType } from './componentKinds';
import { KERNEL_DEFAULTS } from './kernelDefaults';
import { countOf, numOpt } from './nodeProps';

/**
 * Tube-fin tube radius (m). When the set carries no explicit outerRadius the
 * kernel's "auto" rule applies: N tubes just touching each other around the
 * body: r = R·sin(π/N) / (1 − sin(π/N)) (TubeFinSet.getOuterRadius).
 */
export function tubeFinRadius(node: ComponentNode, bodyRadius: number): number {
  // `numOpt`, not a hand-rolled typeof check: it carries the Number.isFinite
  // guard documented in nodeProps.ts. `typeof x === 'number' && x > 0` lets
  // Infinity through, which propagates to the schematic's scale and collapses the
  // whole drawing to nothing, where the auto radius still draws something.
  const explicit = numOpt(node, 'outerRadius');
  if (explicit !== undefined && explicit > 0) return explicit;
  // The kernel's default tube-fin count (ComponentFactory, case "tubefinset"),
  // read from the shared defaults table so it cannot drift from the kernel.
  const n = countOf(node, 'finCount', KERNEL_DEFAULTS.tubefinset.finCount);
  // Kernel rule (TubeFinSet.getOuterRadius): fewer than 3 fins auto-size to
  // the body radius, and n=2 would divide by zero below (sin π/2 = 1).
  if (n < 3) return bodyRadius;
  const s = Math.sin(Math.PI / n);
  return (bodyRadius * s) / (1 - s);
}

/**
 * The largest tube radius (m) at which N tubes around a body of radius R
 * don't collide: the touching radius. Undefined (null) below 3 fins:
 * 1–2 tubes can never meet each other around the body.
 */
export function tubeFinMaxRadius(finCount: number, bodyRadius: number): number | null {
  const n = Math.round(finCount);
  if (n < 3) return null;
  const s = Math.sin(Math.PI / n);
  return (bodyRadius * s) / (1 - s);
}

/**
 * The largest fin count for which tubes of radius r around a body of radius R
 * don't collide: N ≤ π / asin(r / (R + r)). Never below 2.
 */
export function tubeFinMaxCount(outerRadius: number, bodyRadius: number): number {
  if (!(outerRadius > 0) || !(bodyRadius > 0)) return 2;
  const ratio = Math.min(1, outerRadius / (bodyRadius + outerRadius));
  return Math.max(2, Math.floor(Math.PI / Math.asin(ratio) + 1e-9));
}

/**
 * Every fin set, tube fins included - the `FIN_SET_TYPES` table in
 * componentKinds.ts, rather than a `type.endsWith('finset')` string test nothing
 * ties to the `ComponentType` union. Mirrors what OpenRocket's FinMarkingGuide
 * collects:
 *
 *     next instanceof FinSet || next instanceof TubeFinSet || …
 *
 * Use this for anything a tube fin genuinely takes part in: drawing it on the
 * airframe, counting it, marking where it goes.
 */
export const isFinSet = (type: string): type is FinSetType => (FIN_SET_TYPES as ReadonlySet<string>).has(type);

/**
 * Fin sets with a flat planform: everything except tube fins.
 *
 * This is exactly OpenRocket's `instanceof FinSet`. `TubeFinSet extends Tube`,
 * not FinSet, so a tube fin cannot reach `PrintableFinSet`
 * (`AbstractPrintable<FinSet>`) and `FinSetPrintStrategy`'s
 * `if (rocketComponent instanceof FinSet)` skips it. Matching on the element
 * name alone would not exclude it, because `<tubefinset>` matches a fin-set
 * string test where TubeFinSet never matches the type.
 *
 * A tube has no planform, so every consumer that produces an outline (a
 * cutting template, a side-view fin shape, a root chord) must use this one.
 * The broad match fabricates a 50 × 30 mm swept trapezoid out of the
 * `rootChord` / `height` / `sweep` defaults for a part that is a tube.
 */
export const isPlanarFinSet = (type: string): type is PlanarFinSetType =>
  (PLANAR_FIN_TYPES as ReadonlySet<string>).has(type);
