import {
  OpenRocketDesign,
  resetEngine,
  type StaticInfo,
  type IgnitionEvent,
  type RocketTree,
  type MotorSpec,
  type ComponentNode,
} from '../../engine/openRocketEngine';
import { parseDesignFile } from './designFile';
import type { OrkExportMotor } from './orkFile';
import type { LaunchConditions } from '../design/orkTree';
import { loadCatalog, matchCatalogMotor, type CatalogMotor, type MotorMatchDoubt } from '../motors/motorDb';
import { customMotorToSpec, fetchMotorSpec } from '../motors/thrustcurve';
import { parseRse, removeDelay } from '../motors/rseParser';
import type { CustomMotor } from '../motors/motorStore';
import type { OrkMotorRef } from './orkTypes';
import { findMounts } from '../design/treeEdit';
import { motorFitsMount, mountFit } from '../motors/motorPicker';
import { hasUsableCurve } from '../motors/motorCurve';
import { uuid } from '../app/uuid';
import { type DeployOverride, type MountMotor, type SepOverride } from '../flight/flightConfigs';

/** One of the file's flight configurations, with its motors resolved. */
export interface LoadedConfig {
  /** The file's own `configid`, kept so a round trip is identity. */
  id: string;
  name: string | null;
  motors: Record<string, MountMotor>;
  /** What this configuration said about recovery deployment (carried, not edited). */
  deployments?: Record<string, DeployOverride>;
  /**
   * ...and about staging, and about which stages stay on the pad. Carried for
   * the same reason the deployments are, and they were not: `OrkFlightConfig`
   * has declared both as non-optional all along, and this interface named
   * neither, so opening a `.ork` whose configuration said
   * `<stage number="1" active="false"/>` or carried a
   * `<separationconfiguration>` dropped it on the floor. `saveOrk` then wrote
   * the undefined value back and the file lost the setting for good.
   */
  separations?: Record<string, SepOverride>;
  grounded?: string[];
}

export interface LoadedOrk {
  name: string;
  design: OpenRocketDesign;
  info: StaticInfo;
  /** Human-readable notes: unsupported components, unresolved motors, etc. */
  notes: string[];
  /** The parsed tree + motors, kept so the design can be re-exported (round-trip). */
  tree: RocketTree;
  motors: Record<string, OrkExportMotor>;
  /**
   * EVERY flight configuration the file declared, with its motors resolved to
   * thrust curves, in file order and never empty.
   *
   * All of them, not just the one the import applied: a `.ork` carrying three
   * configurations is a rocket somebody set up three ways, and reading one of
   * them would quietly discard the other two the moment the design was saved
   * back.
   */
  configs: LoadedConfig[];
  /** Which configuration the file marks default; the one the app opens on. */
  chosenConfigId: string;
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
 * Lifted out because every configuration's every mount builds one, and an
 * ignition event applied on only some of them is a design that stages
 * differently depending on which configuration was opened.
 */
function mountMotor(ref: OrkMotorRef, spec: MotorSpec): MountMotor {
  const entry: MountMotor = { spec };
  if (ref.ignitionEvent && IGNITION_EVENTS.has(ref.ignitionEvent)) {
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

  // One resolution per distinct motor, not per mount per configuration: three
  // configurations flying the same J350 are one catalog lookup and one fetch,
  // and one note when it cannot be found rather than three identical ones.
  /** Millimeters as a reader states them: no decimal unless there is one. */
  const round1 = (mm: number): string => String(Math.round(mm * 10) / 10);

  const resolved = new Map<string, MotorSpec>();
  const resolveMotor = async (ref: OrkMotorRef): Promise<MotorSpec> => {
    const key = `${(ref.manufacturer ?? '').toLowerCase()}|${ref.designation.toLowerCase()}|${ref.delay}`;
    const hit = resolved.get(key);
    if (hit) return hit;
    const spec = await resolveOnce(ref);
    resolved.set(key, spec);
    return spec;
  };
  /**
   * What the catalog found, when it is not plainly what the file asked for.
   *
   * The lookup runs from "this is the name" down to "this is what the name looks
   * like with its impulse and propellant taken off", and treats the file's
   * manufacturer as a preference rather than a filter. Every one of those is a
   * match worth making; none of them is the file confirming the motor. Loading
   * one in silence is how an `I170-P` filed under Kosdon became a Cesaroni
   * I170 with nothing on screen to say so.
   */
  const noteDoubt = (ref: OrkMotorRef, cat: CatalogMotor, doubt: MotorMatchDoubt): void => {
    const got = `${cat.manufacturer} ${cat.designation}`;
    const asked = `"${ref.designation}"`;
    const check = 'check it before flying.';
    if (doubt === 'maker') {
      notes.push(
        `Motor ${asked} is filed under ${ref.manufacturer} in this file and the catalog has no motor of theirs by that name. Loaded ${got} instead - ${check}`,
      );
    } else if (doubt === 'shortened') {
      notes.push(`Motor ${asked} is not a name the catalog carries. Loaded the closest, ${got} - ${check}`);
    } else {
      notes.push(`Motor ${asked} matches more than one motor in the catalog. Loaded ${got} - ${check}`);
    }
  };

  const resolveOnce = async (ref: OrkMotorRef): Promise<MotorSpec> => {
    const own = () => embedded.get(removeDelay(ref.designation).toUpperCase());
    const match = matchCatalogMotor(catalog, ref.designation, ref.manufacturer);
    const cat = match?.motor;
    if (match?.doubt) noteDoubt(ref, match.motor, match.doubt);
    if (!cat) {
      // Before giving up: the file may carry the curve itself.
      const curve = own();
      if (curve) {
        notes.push(`Motor "${ref.designation}" isn't in the catalog — using the thrust curve stored in the file.`);
        return customMotorToSpec(curve, ref.delay);
      }
      // Keep the designation as an UNRESOLVED (curve-less) motor rather than a
      // default: the mount shows what the file wanted, the run is blocked until
      // the user picks a real motor, and nothing silently flies a C6.
      notes.push(
        `Motor "${ref.designation}" isn't in the catalog — pick a motor for that mount (it won't fly a default).`,
      );
      return unresolvedMotor(ref);
    }
    try {
      return await fetchMotorSpec(cat, ref.delay);
    } catch (e) {
      // Same fallback as the not-in-catalog branch: a network failure should not
      // cost a design the curve it was carrying all along.
      const curve = own();
      if (curve) {
        notes.push(`Motor "${ref.designation}" could not be fetched — using the thrust curve stored in the file.`);
        return customMotorToSpec(curve, ref.delay);
      }
      // Seat the UNRESOLVED motor, exactly as the `!cat` branch above does.
      // Leaving the mount empty is not neutral: a mount without an entry is
      // seeded with a default C6 (flightConfigs.reconcileConfig), so a single
      // transient thrustcurve.org failure while opening an L-motor design would
      // produce a runnable simulation flying a 10 N-s C6, with the only warning
      // buried in the import notes that settings.showImportNotes can hide.
      notes.push(
        `Motor "${ref.designation}": ${e instanceof Error ? e.message : String(e)} - pick a motor for that mount (it won't fly a default).`,
      );
      return unresolvedMotor(ref);
    }
  };

  // The file's configurations, or one standing in for a file that declares
  // none: a `.rkt`, a bare-XML `.ork`, or a hand-rolled one whose <motor>
  // elements were read without a declaration table (importConfigs).
  const declared = res.configs?.length
    ? res.configs
    : [
        {
          id: uuid(),
          name: null,
          isDefault: true,
          motors: res.motors ?? {},
          deployments: {},
          separations: {},
          grounded: [],
        },
      ];
  const chosenConfigId = declared.some((c) => c.id === res.chosenConfigId) ? res.chosenConfigId! : declared[0]!.id;

  const mountNodes = findMounts(res.tree);
  const mounts = mountNodes.map((m) => m.id as string);
  const byId = new Map(mountNodes.map((m) => [m.id as string, m]));
  // One complaint per mount and motor, however many configurations fly it.
  const misfits = new Set<string>();
  /**
   * A motor the file names for a mount it does not go in.
   *
   * The file gives a NAME, and the name is all the catalog is searched by, so
   * nothing stopped a 54 mm J360 being seated in a 38 mm tube: the app flew a
   * rocket on a motor nobody could push into it, and said nothing. The browser
   * has judged this all along (`motorFitsMount`) and the reader never asked.
   *
   * SEATED ANYWAY, because a file is a statement of what somebody built and
   * dropping its motor would be the app overruling it on a tolerance it is
   * guessing at. The note is the point.
   */
  const checkFit = (mountId: string, spec: MotorSpec): void => {
    const node = byId.get(mountId);
    const fit = node ? mountFit(node as unknown as Record<string, unknown>) : null;
    if (!fit || !spec.designation || !(spec.diameter > 0)) return;
    const motor = { diameter: spec.diameter * 1000, length: spec.length ? spec.length * 1000 : undefined };
    if (motorFitsMount(motor, fit)) return;
    const key = `${mountId}|${spec.designation}`;
    if (misfits.has(key)) return;
    misfits.add(key);
    const where = `"${(node!.name as string) || node!.type}"`;
    const tooWide = motor.diameter > fit.bore;
    notes.push(
      tooWide
        ? `Motor "${spec.designation}" is ${round1(motor.diameter)} mm and mount ${where} takes ${round1(fit.bore)} mm, so it does not fit. Seated as the file names it - check it before flying.`
        : `Motor "${spec.designation}" is ${round1(motor.length ?? 0)} mm long and mount ${where} holds ${round1(fit.maxLength ?? 0)} mm, so it does not fit. Seated as the file names it - check it before flying.`,
    );
  };

  const configs: LoadedConfig[] = [];
  for (const cfg of declared) {
    const motors: Record<string, MountMotor> = {};
    for (const [mountId, ref] of Object.entries(cfg.motors ?? {})) {
      const spec = await resolveMotor(ref);
      checkFit(mountId, spec);
      motors[mountId] = mountMotor(ref, spec);
    }
    // Every mount this configuration named no motor for gets the empty
    // placeholder (see emptyMountMotor), so nothing seeds it a default later.
    for (const id of mounts) if (!motors[id]) motors[id] = { spec: emptyMountMotor() };
    configs.push({
      id: cfg.id,
      name: cfg.name,
      motors,
      ...(Object.keys(cfg.deployments ?? {}).length ? { deployments: cfg.deployments } : {}),
      ...(Object.keys(cfg.separations ?? {}).length ? { separations: cfg.separations } : {}),
      ...(cfg.grounded?.length ? { grounded: cfg.grounded } : {}),
    });
  }

  // Named once, for the configuration the app opens on: a design with four
  // empty mounts across three configurations does not need twelve sentences.
  const chosen = configs.find((c) => c.id === chosenConfigId)!;
  const emptyMounts = findMounts(res.tree).filter((m) => !hasUsableCurve(chosen.motors[m.id as string]?.spec));
  if (emptyMounts.length) {
    const named = emptyMounts.filter((m) => !chosen.motors[m.id as string]?.spec.designation);
    if (named.length) {
      const names = named.map((m) => `"${m.name ?? m.type}"`).join(', ');
      notes.push(
        `No motor in this file for ${named.length === 1 ? 'mount' : 'mounts'} ${names} - pick one before flying (it won't fly a default).`,
      );
    }
  }

  // Seat the OPENED configuration into the throwaway handle, which is what the
  // static info below is read from. The other configurations are data at this
  // point; each is built in turn by whichever simulation flies it.
  for (const [mountId, m] of Object.entries(chosen.motors)) {
    if (!hasUsableCurve(m.spec)) continue;
    design.setMotorById(mountId, m.spec);
    if (m.ignitionEvent) design.setMotorIgnitionById(mountId, m.ignitionEvent, m.ignitionDelay ?? 0);
  }

  const info = design.staticInfo();
  return {
    name: res.name,
    design,
    info,
    notes,
    tree: res.tree,
    motors: res.motors,
    configs,
    chosenConfigId,
    launch: res.launch,
    unbuildable: built.unbuildable,
  };
}
