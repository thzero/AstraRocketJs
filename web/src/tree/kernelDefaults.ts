import type { ComponentType } from '../engine/openRocketEngine';

/** `SymmetricComponent.DEFAULT_RADIUS`: what an automatic end with nothing to follow takes (m). */
export const KERNEL_AUTO_RADIUS = 0.025;

/**
 * The kernel's own defaults, in one place.
 *
 * ## Why this file exists
 *
 * `api.ComponentFactory` reads every optional field as
 * `dbl(node, "key", DEFAULT)`. Three other places also need a value for a
 * missing key: `services/design/treeEdit.defaultNode` (what the editor creates),
 * `services/files/orkImport` (what a missing `.ork` tag becomes), and the renderers'
 * per-call-site `num(node, 'key', fallback)`.
 *
 * Mostly the kernel's default is never reached, because `defaultNode` and
 * `orkImport` write every key explicitly. It matters exactly when a key is
 * absent: a persisted node that lacks the key, a `.ork` tag the desktop
 * omits, or a `defaultNode` case that misses a field. If the fallbacks differ
 * then, the drawing and the simulation quietly describe different rockets, and
 * nothing anywhere reports a problem.
 *
 * ## The rule
 *
 * **The kernel is the authority.** It is what actually flies, and its fallbacks
 * are the Java constructors' own values (`NoseCone()`, `BodyTube()`,
 * `LaunchLug()`...; each `case` cites its constructor), so a node that
 * reaches the bridge without a key flies the part desktop builds from the same
 * file. Anything on the TypeScript side that needs a fallback for one of these
 * fields reads it from here rather than inventing one.
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
  nosecone: { length: 0.15, aftRadius: 0.025, thickness: 0.002 },
  // ComponentFactory, case "transition"
  transition: { length: 0.075, thickness: 0.002 },
  // ComponentFactory, case "bodytube"
  bodytube: { length: 0.2, outerRadius: 0.025, thickness: 0.002 },
  // ComponentFactory, case "trapezoidfinset"
  trapezoidfinset: { finCount: 3, rootChord: 0.05, tipChord: 0.05, sweep: 0.025, height: 0.03, thickness: 0.003 },
  // ComponentFactory, case "ellipticalfinset" (finCount via count(node, "finCount", 3, ...))
  ellipticalfinset: { finCount: 3, rootChord: 0.05, height: 0.05, thickness: 0.003 },
  // ComponentFactory, case "freeformfinset". A freeform fin has no planform defaults:
  // its outline is its geometry, and the factory throws on fewer than 3 points.
  freeformfinset: { finCount: 3, thickness: 0.003 },
  // ComponentFactory, case "tubefinset"
  tubefinset: { finCount: 6, length: 0.1 },
  // ComponentFactory, case "innertube"
  innertube: { length: 0.07, outerRadius: 0.0095, thickness: 0.0005 },
  // ComponentFactory, case "tubecoupler"
  tubecoupler: { length: 0.06, thickness: 0.002 },
  // ComponentFactory, case "centeringring"
  centeringring: { length: 0.002, instanceCount: 1 },
  // ComponentFactory, case "bulkhead"
  bulkhead: { length: 0.002, instanceCount: 1 },
  // ComponentFactory, case "engineblock"
  engineblock: { length: 0.005, thickness: 0.005 },
  // ComponentFactory, case "launchlug". The separation is the constructor's
  // (LaunchLug.java:38, its own 0.03 m length x 2), set before the node's
  // length, so it does not follow the length the part is given; the angle is pi.
  launchlug: {
    length: 0.03,
    outerRadius: 0.005,
    thickness: 0.001,
    instanceCount: 1,
    instanceSeparation: 0.06,
    angleOffset: Math.PI,
  },
  // ComponentFactory, case "railbutton" reads the diameter only when present; the value
  // is the kernel's own (RailButton.java:61). A rail button never sets
  // RocketComponent.length, so its axial length is the field's initial 0
  // (RocketComponent.java:91): no `length` entry here on purpose.
  // The separation is the constructor's (RailButton.java:66, its own 9.7 mm
  // diameter x 6), set before the node's diameter; the angle is pi.
  railbutton: { outerDiameter: 0.0097, instanceCount: 1, instanceSeparation: 0.0582, angleOffset: Math.PI },
  // ComponentFactory, case "fairing" (modeled as a MassComponent whose radius is
  // max(width, height) / 2)
  fairing: { length: 0.08, mass: 0.03, width: 0.025, height: 0.02 },
  // ComponentFactory, case "parachute"; cd is Parachute.DEFAULT_CD
  // radius is MassObject's constructor packed radius.
  parachute: { length: 0.025, diameter: 0.3, lineLength: 0.3, cd: 0.8, lineCount: 6, radius: 0.0125 },
  // ComponentFactory, case "streamer"
  streamer: { length: 0.025, stripLength: 0.5, stripWidth: 0.05, radius: 0.0125 },
  // ComponentFactory, case "shockcord"
  shockcord: { length: 0.025, cordLength: 0.4, radius: 0.0125 },
  // ComponentFactory, case "masscomponent"
  masscomponent: { mass: 0, length: 0.025, radius: 0.0125 },
  // ComponentFactory.applyAssembly, shared by both assembly types.
  podset: { instanceCount: 2 },
  parallelstage: { instanceCount: 2 },
} as const satisfies Record<ComponentType, Readonly<Record<string, number>>>;

/**
 * The spacing a part's copies fly at when the node states none: a lug's and a
 * rail button's constructor value (see their rows above), and 0 for the ring
 * parts, whose copies the kernel stacks until a spacing is set.
 */
export function defaultSeparation(type: string): number {
  const row = (KERNEL_DEFAULTS as Record<string, { instanceSeparation?: number }>)[type];
  return row?.instanceSeparation ?? 0;
}

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
 * These are the densities such a part is already flying at. They are here so
 * that the editor can name them - a part that reads "Not specified" while
 * weighing 680 kg/m3 of cardboard is a panel disagreeing with the simulation -
 * and so the `.ork` writer's fallbacks and the new-part seed are one table
 * rather than three copies of the same three numbers.
 *
 * `group` is the `.ork` database string upstream's `RocketComponentSaver`
 * writes (`mat.getGroup().getDatabaseString()`), not the display group the
 * material catalog sorts the picker by; those vocabularies differ (Cardboard is
 * `PaperProducts` in a file and `Paper` in the list).
 */
export const KERNEL_MATERIALS = {
  bulk: { name: 'Cardboard', density: 680, group: 'PaperProducts' },
  surface: { name: 'Ripstop nylon', density: 0.067, group: 'Fabrics' },
  line: { name: 'Elastic cord (round 2 mm, 1/16 in)', density: 0.0018, group: 'ThreadsLines' },
} as const satisfies Record<string, { name: string; density: number; group: string }>;

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
  return kernelDefault(type, 'length');
}

/**
 * The kernel's value for one field of a node of `type` that leaves the key
 * out, or `undefined` where the factory reads none. `type` is any string: a
 * persisted node can carry a type outside the union, and such a node has no
 * row and no defaults.
 */
export function kernelDefault(type: string, key: string): number | undefined {
  const row = (KERNEL_DEFAULTS as Record<string, Readonly<Record<string, number>> | undefined>)[type];
  return row?.[key];
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
 * `rootChord` (case "ellipticalfinset"); its `height` is its own row above,
 * since `EllipticalFinSet()` starts at 0.05 where `TrapezoidFinSet()` starts
 * at 0.03.
 *
 * These are the kernel's defaults, which `treeEdit.defaultNode` also seeds,
 * and this is the table that verifies them. A freeform fin's root-chord
 * fallback for a degenerate outline reads `rootChord` from here too; that one
 * is an app choice, since the kernel refuses such an outline, and it is pinned
 * to the kernel's trapezoid so every consumer agrees.
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
