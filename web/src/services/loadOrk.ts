import {
  OpenRocketDesign,
  resetEngine,
  type StaticInfo,
  type IgnitionEvent,
  type RocketTree,
  type MotorSpec,
  type ComponentNode,
} from '../engine/openRocketEngine';
import { parseDesignFile } from './designFile';
import type { OrkExportMotor } from './orkFile';
import type { LaunchConditions } from './orkTree';

/** A resolved motor + its ignition override, keyed by mount id for rebuilds. */
export interface MountMotor {
  spec: MotorSpec;
  ignitionEvent?: IgnitionEvent;
  ignitionDelay?: number;
}
import { loadCatalog, findCatalogMotor } from './motorDb';
import { customMotorToSpec, fetchMotorSpec } from './thrustcurve';
import { parseRse, removeDelay } from './rseParser';
import type { CustomMotor } from './motorStore';
import type { OrkMotorRef } from './orkTypes';
import { findMounts } from './treeEdit';

export interface LoadedOrk {
  name: string;
  design: OpenRocketDesign;
  info: StaticInfo;
  /** Human-readable notes: unsupported components, unresolved motors, etc. */
  notes: string[];
  /** The parsed tree + motors, kept so the design can be re-exported (round-trip). */
  tree: RocketTree;
  motors: Record<string, OrkExportMotor>;
  /** Resolved motor specs keyed by mount id — so an edited design can rebuild
   *  and re-seat the file's motors without re-fetching thrust curves. */
  motorSpecs: Record<string, MountMotor>;
  /** Imported launch/sim conditions (wind, rod, site, geodetic), if the file had any. */
  launch?: Partial<LaunchConditions>;
  /**
   * Set when the tree AS WRITTEN could not be built, and the handle below was
   * built from a repaired copy so the file could still be opened (see
   * `buildForImport`). `design` and `info` then describe that copy, NOT this
   * design: read neither. The app does not - it rebuilds from `tree` - and the
   * rebuild refuses in the same place, which is what the user needs to see.
   */
  unbuildable?: string;
}

const IGNITION_EVENTS: ReadonlySet<string> = new Set(['automatic', 'launch', 'ejectioncharge', 'burnout', 'never']);

/**
 * A placeholder for a .ork motor we couldn't resolve — it keeps the designation
 * and dimensions the file named but carries NO thrust curve, so `hasThrustCurve`
 * is false: the run is blocked ("no motor") and the design builds with an empty
 * mount. Crucially it is NOT swapped for a default (C6), so the sim never
 * silently flies a motor the file didn't specify.
 */
function unresolvedMotor(ref: {
  designation: string;
  manufacturer?: string;
  diameter: number;
  length: number;
  delay: number;
}): MotorSpec {
  return {
    designation: ref.designation,
    manufacturer: ref.manufacturer,
    diameter: ref.diameter,
    length: ref.length,
    times: [],
    thrusts: [],
    masses: [],
    cgX: ref.length / 2,
    ejectionDelay: ref.delay,
  };
}

/**
 * The placeholder for a mount the FILE left empty: no designation, no curve.
 *
 * The policy for a `.ork` is that a mount flies only what the file put in it.
 * `unresolvedMotor` already covers a motor the file named that could not be
 * produced; this covers a mount the file named no motor for at all. Both are
 * curve-less, so `hasThrustCurve` is false and the run gate reports "no motor"
 * until the user picks one. Without it, `wireLoadedOrk` seeded a default C6
 * into an empty primary mount and `reconcileMounts` into every other empty
 * mount, so a design saved with its mounts empty opened as a runnable rocket
 * flying motors the file never specified, which is exactly what the two
 * branches above go out of their way to prevent.
 */
export function emptyMountMotor(): MotorSpec {
  return {
    designation: '',
    diameter: 0,
    length: 0,
    times: [],
    thrusts: [],
    masses: [],
    cgX: 0,
    ejectionDelay: 0,
  };
}

/**
 * The mount's motor plus whatever ignition override the file asked for.
 *
 * Lifted out because three paths now seat a motor - the catalog, the file's own
 * embedded curve, and that curve again after a failed fetch - and an ignition
 * event applied on only some of them is a design that stages differently
 * depending on whether thrustcurve.org answered.
 */
function applyIgnition(
  design: ReturnType<typeof OpenRocketDesign.buildTree>,
  mountId: string,
  ref: OrkMotorRef,
  spec: MotorSpec,
): MountMotor {
  const entry: MountMotor = { spec };
  if (ref.ignitionEvent && IGNITION_EVENTS.has(ref.ignitionEvent)) {
    design.setMotorIgnitionById(mountId, ref.ignitionEvent as IgnitionEvent, ref.ignitionDelay ?? 0);
    entry.ignitionEvent = ref.ignitionEvent as IgnitionEvent;
    entry.ignitionDelay = ref.ignitionDelay ?? 0;
  }
  return entry;
}

/**
 * The file's embedded thrust curves, keyed by designation without its delay.
 *
 * Keyed that way because the `.ork` names a motor as `J350-14` while the curve it
 * embeds is the motor `J350`: the delay is the mount's choice, not the motor's.
 * Upper-cased so the match does not turn on how the file spells it.
 *
 * A curve that will not parse is reported and skipped rather than failing the
 * whole open: the design is still perfectly loadable without it, and the mount
 * falls through to the unresolved placeholder it would have had anyway.
 */
function embeddedCurves(files: string[] | undefined, notes: string[]): Map<string, CustomMotor> {
  const out = new Map<string, CustomMotor>();
  for (const text of files ?? []) {
    try {
      for (const motor of parseRse(text)) {
        const key = removeDelay(motor.designation).toUpperCase();
        if (!out.has(key)) out.set(key, motor);
      }
    } catch {
      notes.push('A thrust curve stored in the file could not be read and was skipped.');
    }
  }
  return out;
}

/**
 * Build the file's tree, and if the kernel REFUSES it, build a repaired copy
 * instead so the file still opens.
 *
 * The kernel refuses a design it cannot fly - a freeform fin whose outline
 * crosses itself is the case this was written for, since the kernel rolls such
 * an outline back and the bridge now says so by name rather than flying the
 * default fin. Opening is not flying, though: a design that cannot be simulated
 * is exactly the design somebody needs to OPEN in order to fix, and refusing the
 * whole file would leave a rocket saved from this app unreachable. So the tree is
 * handed back untouched and only the throwaway handle - which exists to seat the
 * file's motors, and whose numbers nothing downstream reads (`wireLoadedOrk`
 * takes the tree, the specs and the notes) - is built from a copy with every
 * freeform outline dropped to the kernel's default.
 *
 * The retry is deliberately blind: no attempt to decide from the message whether
 * an outline was the cause. A build that fails for some other reason fails the
 * retry too and the ORIGINAL error is what the caller sees.
 *
 * The note carries the kernel's own sentence, which names the offending part,
 * and the app's rebuild hits the same refusal a moment later - so the reason
 * appears in the banner as well, in the same words, for as long as it is true.
 */
export function buildForImport(tree: RocketTree): { design: OpenRocketDesign; unbuildable?: string } {
  try {
    return { design: OpenRocketDesign.buildTree(tree) };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    let repaired;
    try {
      repaired = OpenRocketDesign.buildTree(withoutFreeformOutlines(tree));
    } catch {
      throw e; // not an outline this could rescue - the real error is the useful one
    }
    return {
      design: repaired,
      unbuildable: `${reason} The design is open so it can be fixed; nothing will simulate until it is.`,
    };
  }
}

/** The tree with every freeform fin set's `points` dropped, so the kernel uses its own outline. */
function withoutFreeformOutlines(tree: RocketTree): RocketTree {
  const strip = (nodes: ComponentNode[] | undefined): ComponentNode[] | undefined =>
    nodes?.map((n) => {
      const kids = strip(n.children as ComponentNode[] | undefined);
      const next = { ...n, ...(kids ? { children: kids } : {}) } as ComponentNode & { points?: unknown };
      if (next.type === 'freeformfinset') delete next.points;
      return next;
    });
  return { ...tree, components: strip(tree.components as ComponentNode[]) ?? [] } as RocketTree;
}

export async function loadOrk(buffer: ArrayBuffer): Promise<LoadedOrk> {
  resetEngine(); // free the previous design's handles
  // Either format, chosen from the bytes (designFile.ts). Everything below is
  // format-agnostic: it works off the import RESULT, and a `.rkt` simply
  // arrives with no motors and no flight configurations to resolve.
  const res = parseDesignFile(buffer);
  const built = buildForImport(res.tree);
  const design = built.design;

  const notes = [...(res.notes ?? []), ...(res.ignored ?? []).map((i) => `Skipped unsupported: ${i}`)];
  if (built.unbuildable) notes.push(built.unbuildable);

  const catalog = await loadCatalog();
  // Thrust curves the file brought with it, by designation. A `.ork` from the
  // desktop embeds the curve of every motor the design uses, exactly so it opens
  // somewhere that does not have them.
  const embedded = embeddedCurves(res.embeddedMotors, notes);
  const motorSpecs: Record<string, MountMotor> = {};
  for (const [mountId, ref] of Object.entries(res.motors ?? {})) {
    const cat = findCatalogMotor(catalog, ref.designation, ref.manufacturer);
    if (!cat) {
      // Before giving up: the file may carry the curve itself.
      const own = embedded.get(removeDelay(ref.designation).toUpperCase());
      if (own) {
        notes.push(`Motor "${ref.designation}" isn't in the catalog — using the thrust curve stored in the file.`);
        const spec = customMotorToSpec(own, ref.delay);
        design.setMotorById(mountId, spec);
        motorSpecs[mountId] = applyIgnition(design, mountId, ref, spec);
        continue;
      }
      // Keep the designation as an UNRESOLVED (curve-less) motor rather than a
      // default: the mount shows what the file wanted, the run is blocked until
      // the user picks a real motor, and nothing silently flies a C6.
      notes.push(
        `Motor "${ref.designation}" isn't in the catalog — pick a motor for that mount (it won't fly a default).`,
      );
      motorSpecs[mountId] = { spec: unresolvedMotor(ref) };
      continue;
    }
    try {
      const spec = await fetchMotorSpec(cat, ref.delay);
      design.setMotorById(mountId, spec);
      motorSpecs[mountId] = applyIgnition(design, mountId, ref, spec);
    } catch (e) {
      // Same fallback as the not-in-catalog branch: a network failure should not
      // cost a design the curve it was carrying all along.
      const own = embedded.get(removeDelay(ref.designation).toUpperCase());
      if (own) {
        notes.push(`Motor "${ref.designation}" could not be fetched — using the thrust curve stored in the file.`);
        const spec = customMotorToSpec(own, ref.delay);
        design.setMotorById(mountId, spec);
        motorSpecs[mountId] = applyIgnition(design, mountId, ref, spec);
        continue;
      }
      // Seat the UNRESOLVED motor, exactly as the `!cat` branch above does.
      // Leaving the mount empty was not neutral: mountMotors seeds a default
      // C6 for any mount without one, so a single transient thrustcurve.org
      // failure while opening an L-motor design produced a runnable simulation
      // flying a 10 N-s C6, with the only warning buried in the import notes
      // that settings.showImportNotes can hide.
      notes.push(
        `Motor "${ref.designation}": ${e instanceof Error ? e.message : String(e)} - pick a motor for that mount (it won't fly a default).`,
      );
      motorSpecs[mountId] = { spec: unresolvedMotor(ref) };
    }
  }

  // Every mount the file gave no motor for gets the empty placeholder (see
  // emptyMountMotor), named in one note so the user knows which to fill.
  const emptyMounts = findMounts(res.tree).filter((m) => !motorSpecs[m.id as string]);
  for (const m of emptyMounts) motorSpecs[m.id as string] = { spec: emptyMountMotor() };
  if (emptyMounts.length) {
    const names = emptyMounts.map((m) => `"${m.name ?? m.type}"`).join(', ');
    notes.push(
      `No motor in this file for ${emptyMounts.length === 1 ? 'mount' : 'mounts'} ${names} - pick one before flying (it won't fly a default).`,
    );
  }

  // The app imports ONE configuration as a single simulation, but a .ork can
  // carry several (each a sim on the desktop). Scan the OTHER configurations'
  // motors too, so a missing engine in a not-opened config isn't silent. Only
  // the opened config's motors were catalog-checked above; dedupe by name and
  // skip any the opened config already resolved.
  const openedRefs = new Set(Object.values(res.motors ?? {}).map((r) => r.designation.toLowerCase()));
  const missingOther = new Map<string, string>(); // key → display designation
  for (const cfg of res.configs ?? []) {
    if (cfg.id === res.chosenConfigId) continue;
    for (const ref of Object.values(cfg.motors ?? {})) {
      if (openedRefs.has(ref.designation.toLowerCase())) continue;
      if (findCatalogMotor(catalog, ref.designation, ref.manufacturer)) continue; // we have it
      missingOther.set(`${ref.designation.toLowerCase()}|${(ref.manufacturer ?? '').toLowerCase()}`, ref.designation);
    }
  }
  if (missingOther.size) {
    notes.push(
      `Other flight configurations use motors not in the catalog: ${[...missingOther.values()].join(', ')}. ` +
        `Those configurations can't be simulated here until you add the motor(s).`,
    );
  }

  const info = design.staticInfo();
  return {
    name: res.name,
    design,
    info,
    notes,
    tree: res.tree,
    motors: res.motors,
    motorSpecs,
    launch: res.launch,
    unbuildable: built.unbuildable,
  };
}
