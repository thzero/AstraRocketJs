import type { ComponentType } from '../engine/openRocketEngine';

/**
 * The kernel's own defaults, in one place.
 *
 * ## Why this file exists
 *
 * `api.ComponentFactory` reads every optional field as
 * `dbl(node, "key", DEFAULT)`. Three other places independently decided what
 * those defaults are: `services/design/treeEdit.defaultNode` (what the editor creates),
 * `services/files/orkImport` (what a missing `.ork` tag becomes), and the renderers'
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
 * Every row cites the `case` in `engine-java/src/api/java/api/ComponentFactory.java`
 * that reads it, not a line number: line numbers there move with every change,
 * and a citation that points at the wrong line is worse than none. Keyed by
 * `ComponentType` and checked with `satisfies`, so a new component type has to
 * declare its row (an empty one is a legitimate answer: `stage` reads no
 * defaults; `podset` and `parallelstage` read only their instance count, in the
 * shared `applyAssembly`).
 */
export const KERNEL_DEFAULTS = {
  stage: {},
  // ComponentFactory, case "nosecone"
  nosecone: { length: 0.07, aftRadius: 0.012, thickness: 0.002 },
  // ComponentFactory, case "transition"
  transition: { length: 0.05, thickness: 0.002 },
  // ComponentFactory, case "bodytube"
  bodytube: { length: 0.3, outerRadius: 0.012, thickness: 0.0003 },
  // ComponentFactory, case "trapezoidfinset"
  trapezoidfinset: { finCount: 3, rootChord: 0.05, tipChord: 0.03, sweep: 0.02, height: 0.03, thickness: 0.003 },
  // ComponentFactory, case "ellipticalfinset" (finCount via count(node, "finCount", 3, ...))
  ellipticalfinset: { finCount: 3, rootChord: 0.05, height: 0.03, thickness: 0.003 },
  // ComponentFactory, case "freeformfinset". A freeform fin has no planform defaults:
  // its outline IS its geometry, and the factory throws on fewer than 3 points.
  freeformfinset: { finCount: 3, thickness: 0.003 },
  // ComponentFactory, case "tubefinset"
  tubefinset: { finCount: 6, length: 0.1 },
  // ComponentFactory, case "innertube"
  innertube: { length: 0.07, outerRadius: 0.0095, thickness: 0.0005 },
  // ComponentFactory, case "tubecoupler"
  tubecoupler: { length: 0.05, thickness: 0.0005 },
  // ComponentFactory, case "centeringring"
  centeringring: { length: 0.002 },
  // ComponentFactory, case "bulkhead"
  bulkhead: { length: 0.002 },
  // ComponentFactory, case "engineblock"
  engineblock: { length: 0.005, thickness: 0.00095 },
  // ComponentFactory, case "launchlug"
  launchlug: { length: 0.05, outerRadius: 0.0022, thickness: 0.0003 },
  // ComponentFactory, case "railbutton" reads the diameter only when present; the value
  // is the kernel's own (RailButton.java:61). A rail button never sets
  // RocketComponent.length, so its axial length is the field's initial 0
  // (RocketComponent.java:91): no `length` entry here on purpose.
  railbutton: { outerDiameter: 0.0097 },
  // ComponentFactory, case "fairing" (modeled as a MassComponent whose radius is
  // max(width, height) / 2)
  fairing: { length: 0.08, mass: 0.03, width: 0.025, height: 0.02 },
  // ComponentFactory, case "parachute"
  parachute: { length: 0.025, diameter: 0.3, lineLength: 0.3 },
  // ComponentFactory, case "streamer"
  streamer: { length: 0.025, stripLength: 0.5, stripWidth: 0.05 },
  // ComponentFactory, case "shockcord"
  shockcord: { length: 0.025, cordLength: 0.3 },
  // ComponentFactory, case "masscomponent"
  masscomponent: { mass: 0.01, length: 0.02, radius: 0.005 },
  // ComponentFactory.applyAssembly, shared by both assembly types.
  podset: { instanceCount: 2 },
  parallelstage: { instanceCount: 2 },
} as const satisfies Record<ComponentType, Readonly<Record<string, number>>>;

/**
 * The profile shape the kernel builds when a node names none: ComponentFactory
 * reads `str(node, "shape", "ogive")` for a nose cone (case "nosecone") and
 * `"conical"` for a transition (case "transition"). Strings, so a table of their
 * own rather than a row of KERNEL_DEFAULTS. Verified the same way, by building
 * each part with the key absent and with the value below.
 */
export const KERNEL_SHAPES = {
  nosecone: 'ogive',
  transition: 'conical',
} as const;

/**
 * The material the kernel gives a component that names none, by material type.
 *
 * `ComponentFactory` only calls `setMaterial` when the node carries a positive
 * `density`, so a part without one keeps whatever its Java constructor was
 * given: `ExternalComponent`, `StructuralComponent`, `RecoveryDevice`,
 * `ShockCord` and `FinSet` all ask
 * `ApplicationPreferences.getDefaultComponentMaterial`, which with no stored
 * preference returns the three below (`ApplicationPreferences.StaticFieldHolder`).
 *
 * These are the densities such a part is ALREADY flying at. They are here so
 * that the editor can name them - a part that reads "Not specified" while
 * weighing 680 kg/m3 of cardboard is a panel disagreeing with the simulation -
 * and so the `.ork` writer's fallbacks and the new-part seed are one table
 * rather than three copies of the same three numbers.
 *
 * `group` is the `.ork` database string upstream's `RocketComponentSaver`
 * writes (`mat.getGroup().getDatabaseString()`), NOT the display group the
 * material catalog sorts the picker by; those vocabularies differ (Cardboard is
 * `PaperProducts` in a file and `Paper` in the list).
 */
export const KERNEL_MATERIALS = {
  bulk: { name: 'Cardboard', density: 680, group: 'PaperProducts' },
  surface: { name: 'Ripstop nylon', density: 0.067, group: 'Fabrics' },
  line: { name: 'Elastic cord (round 2 mm, 1/16 in)', density: 0.0018, group: 'ThreadsLines' },
} as const satisfies Record<string, { name: string; density: number; group: string }>;

/** One row of the table, as the union of every row's shape. */
type KernelRow = (typeof KERNEL_DEFAULTS)[ComponentType];

/**
 * The kernel's axial `length` default for a type, or `undefined` when the
 * factory reads none (stage, rail button, the assemblies, freeform fins).
 *
 * Per type, not one fallback for all: 0.025 is the parachute/streamer/shock-cord
 * default, and applying it to every non-fin type lays out a bulkhead or centering
 * ring that lost its `length` 12x longer than the kernel flies it, and an inner
 * tube or tube fin set shorter.
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
 * (ComponentFactory, case "trapezoidfinset"). The elliptical set shares
 * `rootChord` and `height` (case "ellipticalfinset").
 *
 * These are the KERNEL's defaults, not "what treeEdit and orkImport write" (the
 * editor seeds a 60 x 50 mm fin), and this is the table that verifies them. A
 * freeform fin's root-chord fallback for a degenerate outline reads `rootChord`
 * from here too; that one is an app choice, since the kernel refuses such an
 * outline, and it is pinned to the kernel's trapezoid so every consumer agrees.
 */
export const FIN_DEFAULTS = {
  rootChord: KERNEL_DEFAULTS.trapezoidfinset.rootChord,
  tipChord: KERNEL_DEFAULTS.trapezoidfinset.tipChord,
  sweep: KERNEL_DEFAULTS.trapezoidfinset.sweep,
  height: KERNEL_DEFAULTS.trapezoidfinset.height,
  // The same for all three planar sets (cases "trapezoidfinset",
  // "ellipticalfinset" and "freeformfinset").
  thickness: KERNEL_DEFAULTS.trapezoidfinset.thickness,
} as const;

/**
 * What the kernel flies for a recovery device that does not set a value: the
 * field initializers of OpenRocket's `DeploymentConfiguration`. The bridge
 * (`ComponentFactory.applyDeployment`) sets only the keys a node carries, so an
 * absent key is this, not anything the app picks.
 */
export const KERNEL_DEPLOYMENT = { deployEvent: 'ejection', deployAltitude: 200, deployDelay: 0 } as const;

/** The same for a stage's separation: OpenRocket's `StageSeparationConfiguration`. */
export const KERNEL_SEPARATION = { separationEvent: 'ejection', separationAltitude: 200, separationDelay: 0 } as const;
