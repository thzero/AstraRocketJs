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
 */
export const KERNEL_DEFAULTS = {
  masscomponent: { radius: 0.005 },
  railbutton: { outerDiameter: 0.0097 },
  bodytube: { thickness: 0.0003 },
  transition: { thickness: 0.002, length: 0.05 },
  nosecone: { thickness: 0.002, aftRadius: 0.012 },
  bulkhead: { length: 0.002 },
  engineblock: { thickness: 0.00095 },
  centeringring: { length: 0.002 },
  innertube: { thickness: 0.0005 },
  launchlug: { length: 0.05 },
  streamer: { stripLength: 0.5 },
  podset: { instanceCount: 2 },
} as const;

/** Mass-component radius the kernel uses when the `radius` key is absent (m). */
export const KERNEL_MASSCOMPONENT_RADIUS = KERNEL_DEFAULTS.masscomponent.radius;

/** Rail-button outer diameter the kernel uses when `outerDiameter` is absent (m). */
export const KERNEL_RAILBUTTON_OUTER_DIAMETER = KERNEL_DEFAULTS.railbutton.outerDiameter;
