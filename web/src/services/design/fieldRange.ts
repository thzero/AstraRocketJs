import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
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
  /**
   * The deploy altitude is read by the altitude event only, and the separation
   * altitude by the two altitude events (DeploymentConfiguration.isActivationEvent,
   * StageSeparationConfiguration): under any other event the box would set a
   * number nothing reads. The desktop grays both out there. The stored value
   * stays on the node, so it is back when the event is.
   */
  if (f.key === 'deployAltitude') return str(node, 'deployEvent', KERNEL_DEPLOYMENT.deployEvent) === 'altitude';
  /**
   * What the tube does for a motor needs it to be a mount: desktop's Motor tab
   * grays these out until the box is ticked, and `<motormount>`, which carries
   * them in the file, is written only for a mount (`motorMountParams`). A motor
   * that never ignites has no time to count a delay from, so the delay goes
   * there too, as on the configuration's ignition control.
   */
  if (f.key === 'motorOverhang' || f.key === 'ignitionEvent' || f.key === 'ignitionDelay') {
    if (node['motorMount'] !== true) return false;
    return f.key !== 'ignitionDelay' || str(node, 'ignitionEvent', 'automatic') !== 'never';
  }
  if (f.key === 'separationAltitude') {
    return str(node, 'separationEvent', KERNEL_SEPARATION.separationEvent).startsWith('altitude');
  }
  return true;
}

/**
 * A recovery device's deploy event that only a stage with another below it can
 * see: a flight fires it when the stage under the device separates, so on the
 * bottom (or only) stage no event ever matches it and the device never opens.
 * Desktop's ParachuteConfig and StreamerConfig remove it from the list on the
 * last stage.
 */
export const LOWER_STAGE_SEPARATION = 'lower_stage_separation';

/**
 * Whether the stage holding the part has a stage below it: the part's
 * enclosing stage (the nearest stage or booster above it, or the part itself)
 * is not the last of the design's stages in tree order, which is the order the
 * kernel numbers them in (Rocket.trackStage). False for a part the design does
 * not hold.
 */
export function hasStageBelow(tree: RocketTree, id: string): boolean {
  const stages: string[] = [];
  let enclosing: string | undefined;
  const visit = (nodes: readonly ComponentNode[], stageId: string | undefined) => {
    for (const n of nodes) {
      const own = (n.type === 'stage' || n.type === 'parallelstage') && typeof n.id === 'string' ? n.id : undefined;
      if (own !== undefined) stages.push(own);
      const here = own ?? stageId;
      if (n.id === id) enclosing = here;
      visit(n.children ?? [], here);
    }
  };
  visit(tree.components ?? [], undefined);
  return enclosing !== undefined && stages.indexOf(enclosing) < stages.length - 1;
}

/**
 * The options a select field offers this node, from its declared list.
 * `stageBelow` is whether the part's stage has one below it ({@link hasStageBelow});
 * undefined when the part is not in a design (a saved part), which offers the
 * whole list. A value the node already carries stays on offer whatever the
 * stage, so an imported file shows as itself rather than as the first option.
 */
export function fieldOptions(
  node: ComponentNode,
  f: Extract<Field, { kind: 'select' }>,
  stageBelow: boolean | undefined,
): string[] {
  if (f.key !== 'deployEvent' || stageBelow !== false || node[f.key] === LOWER_STAGE_SEPARATION) return f.options;
  return f.options.filter((o) => o !== LOWER_STAGE_SEPARATION);
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
 * the node does not carry (see `absentValue`). Undefined for kinds that store
 * no node key of their own (`text`, `bore`, `derived`).
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
 * The floor is 0 where nothing sets one and the kernel or the bridge refuses
 * or clamps a negative value; an absent `min` or `max` is no bound, and the
 * box takes any number there. Kinds with no numeric box (select, text, bool,
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
      // A radial direction takes any angle: the kernel wraps it
      // (RingComponent.setRadialDirection, MassObject.setRadialDirection) and
      // the desktop spinner is unbounded. Every other angle wraps in the kernel
      // too (FinSet.setAngleOffset, InnerTube.setClusterRotation,
      // ParallelStage.setAngleOffset) and the desktop spinners stop at
      // -180..180, a whole turn, so no angle is out of reach. A bound at one
      // end only would clamp -200 to -180 while the kernel flies 160.
      if (f.key === 'radialDirection') return {};
      return { min: -Math.PI, max: Math.PI };
    case 'length': {
      // Signed with no bound: the kernel's setter keeps any value and the
      // desktop spinner is unbounded.
      if (f.signed) return {};
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
