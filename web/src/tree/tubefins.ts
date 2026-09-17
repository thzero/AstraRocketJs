import type { ComponentNode } from '../engine/openRocketEngine';
import { num, numOpt } from './nodeProps';

/**
 * Tube-fin tube radius (m). When the set carries no explicit outerRadius the
 * kernel's "auto" rule applies: N tubes just touching each other around the
 * body — r = R·sin(π/N) / (1 − sin(π/N)) (TubeFinSet.getOuterRadius).
 */
export function tubeFinRadius(node: ComponentNode, bodyRadius: number): number {
  // `numOpt`, not a hand-rolled typeof check: the module already imports the
  // shared readers, and they carry the Number.isFinite guard nodeProps.ts:14
  // documents as load-bearing. `typeof x === 'number' && x > 0` lets Infinity
  // through, which propagates to the schematic's scale and collapses the whole
  // drawing to nothing, where a fallback would at least have drawn something.
  const explicit = numOpt(node, 'outerRadius');
  if (explicit !== undefined && explicit > 0) return explicit;
  const n = Math.max(1, Math.round(num(node, 'finCount', 6)));
  // Kernel rule (TubeFinSet.getOuterRadius): fewer than 3 fins auto-size to
  // the body radius — and n=2 would divide by zero below (sin π/2 = 1).
  if (n < 3) return bodyRadius;
  const s = Math.sin(Math.PI / n);
  return (bodyRadius * s) / (1 - s);
}

/**
 * The largest tube radius (m) at which N tubes around a body of radius R
 * don't collide — the touching radius. Undefined (null) below 3 fins:
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
 * Every fin set, tube fins included — the `.ork` element names that end in
 * "finset". Mirrors what OpenRocket's FinMarkingGuide collects:
 *
 *     next instanceof FinSet || next instanceof TubeFinSet || …
 *
 * Use this for anything a tube fin genuinely takes part in: drawing it on the
 * airframe, counting it, marking where it goes.
 */
export const isFinSet = (type: string): boolean => type.endsWith('finset');

/**
 * Fin sets with a FLAT planform — everything except tube fins.
 *
 * This is exactly OpenRocket's `instanceof FinSet`. `TubeFinSet extends Tube`,
 * NOT FinSet, so a tube fin cannot reach `PrintableFinSet`
 * (`AbstractPrintable<FinSet>`) and `FinSetPrintStrategy`'s
 * `if (rocketComponent instanceof FinSet)` skips it. OpenRocket's type system
 * made the mistake impossible; matching on the element name alone reintroduced
 * it, because `<tubefinset>` collides on the string where TubeFinSet never
 * collided on the type.
 *
 * A tube has no planform, so every consumer that produces an OUTLINE — a
 * cutting template, a side-view fin shape, a root chord — must use this one.
 * The broad match fabricates a 50 × 30 mm swept trapezoid out of the
 * `rootChord` / `height` / `sweep` defaults for a part that is a tube.
 */
export const isPlanarFinSet = (type: string): boolean => isFinSet(type) && type !== 'tubefinset';
