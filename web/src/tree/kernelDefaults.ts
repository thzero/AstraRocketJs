import type { ComponentType } from '../engine/openRocketEngine';

/**
 * The kernel's own defaults, in one place.
 *
 * ## Why this file exists
 *
 * `api.ComponentFactory` reads every optional field as
 * `dbl(node, "key", DEFAULT)`. Three other places independently decided what
 * those defaults are: `services/treeEdit.defaultNode` (what the editor creates),
 * `services/orkImport` (what a missing `.ork` tag becomes), and the renderers'
 * per-call-site `num(node, 'key', fallback)`. Four hand-maintained tables, none
 * of them derived from the other three.
 *
 * Mostly that stays invisible, because `defaultNode` and `orkImport` write every
 * key explicitly, so the kernel's default is never reached. It bites exactly
 * when a key is ABSENT: a node from an older persisted design, a `.ork` tag the
 * desktop omits, or - as happened with both entries below - a `defaultNode`
 * case that simply forgot a field. Then the drawing and the simulation quietly
 * describe different rockets, and nothing anywhere reports a problem.
 *
 * ## The rule
 *
 * **The kernel is the authority.** It is what actually flies, and its values
 * come from OpenRocket. Anything on the TypeScript side that needs a fallback
 * for one of these fields reads it from here rather than inventing one.
 *
 * ## This table is verified, not asserted
 *
 * `kernelDefaults.kernel.test.ts` builds each component through the real
 * engine twice - once with the key absent, once with the value below - and
 * fails if the resulting geometry differs. So an entry that stops matching
 * `ComponentFactory` is a failing test, not a silently wrong drawing.
 *
 * Every line cites where in `engine-java/src/api/java/api/ComponentFactory.java`
 * the kernel reads it. Keyed by `ComponentType` and checked with `satisfies`,
 * so a new component type has to declare its row (an empty one is a legitimate
 * answer: `stage`, `podset` and `parallelstage` read no dimensions there).
 */
export const KERNEL_DEFAULTS = {
  stage: {},
  // ComponentFactory.java:106-108
  nosecone: { length: 0.07, aftRadius: 0.012, thickness: 0.002 },
  // ComponentFactory.java:150, 163
  transition: { length: 0.05, thickness: 0.002 },
  // ComponentFactory.java:190-192
  bodytube: { length: 0.3, outerRadius: 0.012, thickness: 0.0003 },
  // ComponentFactory.java:204-208
  trapezoidfinset: { finCount: 3, rootChord: 0.05, tipChord: 0.03, sweep: 0.02, height: 0.03 },
  // ComponentFactory.java:217-219 (finCount via count(node, "finCount", 3, ...))
  ellipticalfinset: { finCount: 3, rootChord: 0.05, height: 0.03 },
  // ComponentFactory.java:228. A freeform fin has no dimension defaults: its
  // outline IS its geometry, and the factory throws on fewer than 3 points.
  freeformfinset: { finCount: 3 },
  // ComponentFactory.java:259-260
  tubefinset: { finCount: 6, length: 0.1 },
  // ComponentFactory.java:275-277
  innertube: { length: 0.07, outerRadius: 0.0095, thickness: 0.0005 },
  // ComponentFactory.java:314, 321
  tubecoupler: { length: 0.05, thickness: 0.0005 },
  // ComponentFactory.java:327
  centeringring: { length: 0.002 },
  // ComponentFactory.java:341
  bulkhead: { length: 0.002 },
  // ComponentFactory.java:351, 356
  engineblock: { length: 0.005, thickness: 0.00095 },
  // ComponentFactory.java:362-364
  launchlug: { length: 0.05, outerRadius: 0.0022, thickness: 0.0003 },
  // ComponentFactory.java:374 reads the diameter only when present; the value
  // is the kernel's own (RailButton.java:61). A rail button never sets
  // RocketComponent.length, so its axial length is the field's initial 0
  // (RocketComponent.java:91): no `length` entry here on purpose.
  railbutton: { outerDiameter: 0.0097 },
  // ComponentFactory.java:506-507 (modeled as a MassComponent)
  fairing: { length: 0.08, mass: 0.03 },
  // ComponentFactory.java:390-391, 397
  parachute: { length: 0.025, diameter: 0.3, lineLength: 0.3 },
  // ComponentFactory.java:421-423
  streamer: { length: 0.025, stripLength: 0.5, stripWidth: 0.05 },
  // ComponentFactory.java:440-441
  shockcord: { length: 0.025, cordLength: 0.3 },
  // ComponentFactory.java:452-454
  masscomponent: { mass: 0.01, length: 0.02, radius: 0.005 },
  // The kernel's PodSet default instance count (ComponentAssembly / PodSet).
  podset: { instanceCount: 2 },
  parallelstage: {},
} as const satisfies Record<ComponentType, Readonly<Record<string, number>>>;

/** One row of the table, as the union of every row's shape. */
type KernelRow = (typeof KERNEL_DEFAULTS)[ComponentType];

/**
 * The kernel's axial `length` default for a type, or `undefined` when the
 * factory reads none (stage, rail button, the assemblies, freeform fins).
 *
 * `position.axialLength` used to fall back to 0.025 for EVERY non-fin type,
 * which is the parachute/streamer/shock-cord default: a bulkhead or centering
 * ring that had lost its `length` was laid out 12x longer than the kernel flew
 * it, and an inner tube or tube fin set shorter.
 */
export function kernelLength(type: ComponentType): number | undefined {
  const row: KernelRow & { length?: number } = KERNEL_DEFAULTS[type];
  return row.length;
}

/** Mass-component radius the kernel uses when the `radius` key is absent (m). */
export const KERNEL_MASSCOMPONENT_RADIUS = KERNEL_DEFAULTS.masscomponent.radius;

/** Rail-button outer diameter the kernel uses when `outerDiameter` is absent (m). */
export const KERNEL_RAILBUTTON_OUTER_DIAMETER = KERNEL_DEFAULTS.railbutton.outerDiameter;

/** Body-tube outer radius the kernel uses when `outerRadius` is absent (m). */
export const KERNEL_BODYTUBE_OUTER_RADIUS = KERNEL_DEFAULTS.bodytube.outerRadius;

/**
 * Planar-fin dimension fallbacks: the kernel's trapezoid defaults
 * (ComponentFactory.java:205-208). The elliptical set shares `rootChord` and
 * `height` (:218-219).
 *
 * These used to live in `finPlanform.ts`, attributed to "what treeEdit and
 * orkImport write", which they never were (the editor seeds a 60 x 50 mm fin):
 * they are the kernel's, and this is the table that verifies them. A freeform
 * fin's root-chord fallback for a degenerate outline reads `rootChord` from
 * here too; that one is an app choice (the kernel refuses such an outline),
 * and it is pinned to the kernel's trapezoid so every consumer agrees.
 */
export const FIN_DEFAULTS = {
  rootChord: KERNEL_DEFAULTS.trapezoidfinset.rootChord,
  tipChord: KERNEL_DEFAULTS.trapezoidfinset.tipChord,
  sweep: KERNEL_DEFAULTS.trapezoidfinset.sweep,
  height: KERNEL_DEFAULTS.trapezoidfinset.height,
} as const;
