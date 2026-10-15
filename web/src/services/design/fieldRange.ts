import type { ComponentNode } from '../../engine/openRocketEngine';
import { KERNEL_DEFAULTS, KERNEL_DEPLOYMENT, KERNEL_SEPARATION } from '../../tree/kernelDefaults';
import { MAX_CANT, MAX_FIN_COUNT, MAX_INSTANCE_COUNT, MAX_LINE_COUNT, num, str } from '../../tree/nodeProps';
import { shapeIsClippable, shapeParamDefault, shapeParamMax, shapeUsesParameter } from '../../tree/shapeProfile';
import { clusterCount } from '../../tree/cluster';
import { axialLength } from '../../tree/position';
import type { DimensionBounds } from './linkedDimensions';
import type { Field } from './componentFields';

/** The lowest and highest value a field's box lets the node store, in the node's own units. */
export type FieldRange = { min?: number; max?: number };

/**
 * The shape a nose cone or transition falls back to when the node carries
 * none: `ComponentFactory` reads ogive for a nose cone and conical for a
 * transition.
 */
const defaultShape = (node: ComponentNode): string =>
  str(node, 'shape', node.type === 'nosecone' ? 'ogive' : 'conical');

/**
 * Whether a declared field applies to this particular node, as opposed to being
 * declared for its type. Every one of these would otherwise be a control that
 * sets a value nothing reads.
 *
 * Shared by the panel's `visibleFields` and `sectionFields`, which partition a
 * type's fields between them: a test in only one of the two would hide a row in
 * the dimension list and leave the same row on a section heading.
 */
export function fieldApplies(node: ComponentNode, f: Field): boolean {
  /**
   * Drop the shape parameter for shapes that do not use one. For a
   * power/haack/ogive/parabolic shape it changes the whole profile, and the
   * mesh, report, schematic, 3D view and both .ork paths all read it.
   */
  if (f.key === 'shapeParameter') return shapeUsesParameter(defaultShape(node));
  /**
   * Same for the clipped flag. `Transition.isClipped()` returns false outright
   * for a shape that cannot be clipped (conical, ogive, parabolic), so on those
   * the checkbox would set a value the kernel and both views ignore: a control
   * that does nothing.
   */
  if (f.key === 'clipped') return shapeIsClippable(defaultShape(node));
  /**
   * A filled part is solid, so it has no wall and no bore. The desktop grays
   * both out; a one-column panel drops them, which also stops the bore row
   * offering to write a thickness the kernel is ignoring.
   */
  if (f.key === 'thickness' || f.key === 'innerDiameter') return node['filled'] !== true;
  /**
   * The cluster's spacing and roll, both ways of stating the spacing, and the
   * angle the group sits at describe where the other tubes go. A single tube
   * has no others: `clusterCount` is 1 and every consumer ignores all three.
   */
  if (f.key === 'clusterScale' || f.key === 'clusterSeparation' || f.key === 'clusterRotation') {
    return clusterCount(str(node, 'cluster', 'single')) > 1;
  }
  return true;
}

/**
 * Automatic values only the kernel knows: a shock cord's cord follows the
 * rocket's length, a parachute's lines follow its canopy, and a recovery
 * device's drag coefficient follows its shape. None is written back to the
 * node; on Auto the panel shows the kernel's figure (`componentInfo`) instead.
 */
export const KERNEL_AUTO_KEYS: ReadonlySet<string> = new Set(['cordLength', 'lineLength', 'cd']);

/**
 * A field's bounds with the limits that come from the design around the part:
 * a fin tab is at most as deep as its parent's radius at the fin
 * (`tree/finPlanform.parentRadiusOf`), which the kernel clamps it to.
 */
export function liveBounds(f: Field, tabDepth: number | null): DimensionBounds | undefined {
  return f.key === 'tabHeight' && tabDepth != null && Number.isFinite(tabDepth)
    ? { ...f.bounds, max: () => tabDepth }
    : f.bounds;
}

/**
 * What a numeric field flies as when the node does not carry its key: the
 * field's own `whenAbsent`, the shape's default parameter, else the kernel's
 * default from `tree/kernelDefaults`, which is the one table every app-side
 * fallback reads.
 */
function absentValue(node: ComponentNode, f: Field): number | undefined {
  if (f.whenAbsent !== undefined) return f.whenAbsent;
  // Per shape (Transition.Shape's default parameter), as the drawing reads it.
  if (f.key === 'shapeParameter') return shapeParamDefault(defaultShape(node));
  const tables: Record<string, unknown>[] = [
    (KERNEL_DEFAULTS as Record<string, Record<string, unknown>>)[node.type] ?? {},
    KERNEL_DEPLOYMENT,
    KERNEL_SEPARATION,
  ];
  for (const t of tables) if (typeof t[f.key] === 'number') return t[f.key] as number;
  return undefined;
}

/**
 * What the property panel shows for a field, before any kernel figure replaces
 * it (a field on Auto that only the kernel resolves).
 *
 * `fieldReadback.kernel.test.ts` holds this to what the kernel builds from the
 * same node: the panel has to show the value that flies, including for a key
 * the node does not carry (see `absentValue`). Undefined for kinds that store no node key of their
 * own (`text`, `bore`, `derived`).
 */
export function fieldValue(node: ComponentNode, f: Field): number | boolean | string | undefined {
  switch (f.kind) {
    case 'select':
      return typeof node[f.key] === 'string' ? (node[f.key] as string) : (f.fallback ?? f.options[0]);
    case 'bool':
      // An absent clip flag flies as the shape's own: Transition.setShapeType
      // sets clipped to isClippable().
      if (f.key === 'clipped' && typeof node[f.key] !== 'boolean') return shapeIsClippable(defaultShape(node));
      return node[f.key] === true;
    case 'length': {
      // A wall the part's radius has since shrunk below flies at that radius:
      // the kernel's setters clamp to the bound the field carries. A body tube
      // is the exception, built through the BodyTube(length, radius,
      // thickness) constructor (ComponentFactory), which takes the wall as given.
      const v = num(node, f.key, absentValue(node, f));
      const hi = node.type === 'bodytube' ? undefined : f.bounds?.max?.(node);
      return hi !== undefined && Number.isFinite(hi) && v > hi ? hi : v;
    }
    case 'count':
    case 'number':
    case 'angle':
    case 'mass':
    case 'distance':
      return num(node, f.key, absentValue(node, f));
    default:
      return undefined;
  }
}

/**
 * What the property panel lets a field hold, from the rest of the part.
 *
 * The panel's boxes stop here, and `fieldReadback.kernel.test.ts` sends these
 * limits to the kernel: every value the panel can store has to be one the
 * kernel keeps, or the panel shows a number the part does not fly. `bounds`
 * replaces the field's own: both the panel and the test pass `liveBounds`,
 * which adds a fin tab's depth limit from the design around the part.
 *
 * The floor is 0 where nothing sets one, as `NumberField` floors an entry; an
 * absent `max` is no ceiling. Kinds with no numeric box (select, text, bool,
 * and the `bore` and `derived` rows, which write other keys) have no range.
 */
export function fieldRange(node: ComponentNode, f: Field, bounds: DimensionBounds | undefined = f.bounds): FieldRange {
  switch (f.kind) {
    case 'count':
      // Every fin type's count is `finCount`, and the kernel builds at most 8.
      // Shroud lines take the bridge's own ceiling, which the importers share.
      // A parachute may have no shroud lines (Parachute.setLineCount takes 0,
      // and the desktop spinner starts there); every other count is at least one.
      return {
        min: f.key === 'lineCount' ? 0 : 1,
        max: f.key === 'finCount' ? MAX_FIN_COUNT : f.key === 'lineCount' ? MAX_LINE_COUNT : MAX_INSTANCE_COUNT,
      };
    case 'number':
      // The shape parameter has a shape-dependent ceiling the kernel enforces
      // (Shape.maxParameter: haack tops out at LV-Haack, 1/3).
      return f.key === 'shapeParameter' ? { min: 0, max: shapeParamMax(defaultShape(node)) } : { min: 0 };
    case 'angle':
      // Fin cant stops at the kernel's +/-15 deg, which is where the desktop
      // spinner stops. A lug's or rail button's angle stops at 180 deg:
      // LaunchLug.setAngleOffset and RailButton.setAngleOffset clamp to
      // [-pi, pi] rather than wrapping as the other angle setters do
      // (reducePi), so 270 would show and save as 270 and fly as 180.
      if (f.key === 'cant') return { min: -MAX_CANT, max: MAX_CANT };
      if (f.key === 'angleOffset' && (node.type === 'launchlug' || node.type === 'railbutton'))
        return { min: -Math.PI, max: Math.PI };
      return { min: -Math.PI };
    case 'length': {
      if (f.signedWithinLength) {
        const span = axialLength(node);
        return { min: -span, max: span };
      }
      // A bound on a radius the node does not store is no bound.
      const lo = bounds?.min?.(node);
      const hi = bounds?.max?.(node);
      return {
        min: lo === undefined || !Number.isFinite(lo) ? 0 : lo,
        ...(hi === undefined || !Number.isFinite(hi) ? {} : { max: hi }),
      };
    }
    case 'mass':
    case 'distance':
      return { min: 0 };
    default:
      return {};
  }
}
