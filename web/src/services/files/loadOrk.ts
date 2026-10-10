import type { OrkSimulation } from './ork/importSimulations';
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
import { errorMessage } from '../app/errorMessage';
import { roundTo } from '../app/numbers';
import { rseDigest } from './ork/embeddedMotors';
import { keyedNote, type ImportNote } from './importNote';

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
   * the same reason the deployments are: a configuration that says
   * `<stage number="1" active="false"/>` or carries a
   * `<separationconfiguration>` must keep it, or `saveOrk` writes the setting
   * back as absent and the file loses it.
   */
  separations?: Record<string, SepOverride>;
  grounded?: string[];
}

export interface LoadedOrk {
  name: string;
  design: OpenRocketDesign;
  info: StaticInfo;
  /** Notes for the banner: unsupported components, unresolved motors, etc. */
  notes: ImportNote[];
  /** The parsed tree + motors, kept so the design can be re-exported (round-trip). */
  tree: RocketTree;
  motors: Record<string, OrkExportMotor>;
  /**
   * Every flight configuration the file declared, with its motors resolved to
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
  /** Every simulation the file carried, each with its own conditions and result summary. */
  simulations?: OrkSimulation[];
  /**
   * Set when the tree as written could not be built, and the handle below was
   * built from a repaired copy so the file could still be opened (see
   * `buildForImport`). `design` and `info` then describe that copy, not this
   * design: read neither. The app does not (it rebuilds from `tree`), and the
   * rebuild refuses in the same place, which is what the user needs to see.
   */
  unbuildable?: ImportNote;
}

const IGNITION_EVENTS: ReadonlySet<string> = new Set(['automatic', 'launch', 'ejectioncharge', 'burnout', 'never']);

/**
 * A placeholder for a .ork motor we couldn't resolve. It keeps the designation
 * and dimensions the file named but carries no thrust curve, so `hasThrustCurve`
 * is false: the run is blocked ("no motor") and the design builds with an empty
 * mount. It is not swapped for a default (C6), so the sim never silently flies
 * a motor the file didn't specify.
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
 * The placeholder for a mount the file left empty: no designation, no curve.
 *
 * The policy for a `.ork` is that a mount flies only what the file put in it.
 * `unresolvedMotor` covers a motor the file named that could not be produced;
 * this covers a mount the file named no motor for at all. Both are curve-less,
 * so `hasThrustCurve` is false and the run gate reports "no motor" until the
 * user picks one. A mount with no entry at all is seeded with a default C6
 * (`flightConfigs.reconcileConfig`), so without this placeholder a design saved
 * with its mounts empty would open as a runnable rocket flying motors the file
 * never specified.
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
function embeddedCurves(
  files: string[] | undefined,
  notes: ImportNote[],
): { byName: Map<string, CustomMotor>; byDigest: Map<string, CustomMotor> } {
  const byName = new Map<string, CustomMotor>();
  const byDigest = new Map<string, CustomMotor>();
  for (const text of files ?? []) {
    try {
      const motors = parseRse(text);
      for (const motor of motors) {
        const key = removeDelay(motor.designation).toUpperCase();
        if (!byName.has(key)) byName.set(key, motor);
      }
      // The digest the desktop computes for the file, which is what a `.ork`
      // names an embedded motor by. One motor per file, as the desktop writes.
      const digest = motors.length === 1 ? rseDigest(text) : null;
      if (digest) byDigest.set(digest, motors[0]!);
    } catch {
      notes.push(keyedNote('importNote.embeddedCurveUnreadable'));
    }
  }
  return { byName, byDigest };
}

/**
 * Build the file's tree, and if the kernel refuses it, build a repaired copy
 * instead so the file still opens.
 *
 * The kernel refuses a design it cannot fly. The main case is a freeform fin
 * whose outline crosses itself: the kernel rolls such an outline back and the
 * bridge reports it by name rather than flying the default fin. Opening is not
 * flying, though: a design that cannot be simulated is exactly the design
 * somebody needs to open in order to fix, and refusing the whole file would
 * leave a rocket saved from this app unreachable. So the tree is handed back
 * untouched and only the throwaway handle (which exists to seat the file's
 * motors, and whose numbers nothing downstream reads; `wireLoadedOrk` takes the
 * tree, the specs and the notes) is built from a copy with every freeform
 * outline dropped to the kernel's default.
 *
 * The retry is blind: no attempt to decide from the message whether an outline
 * was the cause. A build that fails for some other reason fails the retry too
 * and the original error is what the caller sees.
 *
 * The note carries the kernel's own sentence, which names the offending part,
 * and the app's rebuild hits the same refusal a moment later, so the reason
 * appears in the banner as well, in the same words, for as long as it is true.
 */
export function buildForImport(tree: RocketTree): { design: OpenRocketDesign; unbuildable?: ImportNote } {
  try {
    return { design: OpenRocketDesign.buildTree(tree) };
  } catch (e) {
    const reason = errorMessage(e);
    let repaired;
    try {
      repaired = OpenRocketDesign.buildTree(withoutFreeformOutlines(tree));
    } catch {
      throw e; // not an outline this could rescue - the real error is the useful one
    }
    return {
      design: repaired,
      unbuildable: keyedNote('importNote.unbuildable', { reason }),
    };
  }
}

/** The tree with every freeform fin set's `points` dropped, so the kernel uses its own outline. */
function withoutFreeformOutlines(tree: RocketTree): RocketTree {
  const strip = (nodes: ComponentNode[] | undefined): ComponentNode[] | undefined =>
    nodes?.map((n) => {
      const kids = strip(n.children);
      const next = { ...n, ...(kids ? { children: kids } : {}) } as ComponentNode & { points?: unknown };
      if (next.type === 'freeformfinset') delete next.points;
      return next;
    });
  return { ...tree, components: strip(tree.components) ?? [] };
}

export async function loadOrk(buffer: ArrayBuffer): Promise<LoadedOrk> {
  resetEngine(); // free the previous design's handles
  // Either format, chosen from the bytes (designFile.ts). Everything below is
  // format-agnostic: it works off the import result, and a `.rkt` simply
  // arrives with no motors and no flight configurations to resolve.
  const res = parseDesignFile(buffer);
  const built = buildForImport(res.tree);
  const design = built.design;

  const notes: ImportNote[] = [
    ...(res.notes ?? []),
    ...(res.ignored ?? []).map((name) => keyedNote('importNote.skippedUnsupported', { name })),
  ];
  if (built.unbuildable) notes.push(built.unbuildable);

  const catalog = await loadCatalog();
  // Thrust curves the file brought with it, by designation. A `.ork` from the
  // desktop embeds the curve of every motor the design uses, exactly so it opens
  // somewhere that does not have them.
  const embedded = embeddedCurves(res.embeddedMotors, notes);

  /** Millimeters as a reader states them: no decimal unless there is one. */
  const round1 = (mm: number): string => String(roundTo(mm, 1));

  // One resolution per distinct motor, not per mount per configuration: three
  // configurations flying the same J350 are one catalog lookup and one fetch,
  // and one note when it cannot be found rather than three identical ones.
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
   * like with its impulse and propellant taken off". Every one of those is a
   * match worth making; none of them is the file confirming the motor. Loaded
   * in silence, an `I170-P` filed under Kosdon would become a Cesaroni I170
   * with nothing on screen to say so. Another maker's motor is not loaded
   * at all (see `resolveOnce`), so the maker doubt never reaches here.
   */
  const noteDoubt = (ref: OrkMotorRef, cat: CatalogMotor, doubt: MotorMatchDoubt): void => {
    const values = { motor: ref.designation, loaded: `${cat.manufacturer} ${cat.designation}` };
    notes.push(keyedNote(doubt === 'shortened' ? 'importNote.motorShortened' : 'importNote.motorAmbiguous', values));
  };

  const resolveOnce = async (ref: OrkMotorRef): Promise<MotorSpec> => {
    const own = () => embedded.byName.get(removeDelay(ref.designation).toUpperCase());
    const match = matchCatalogMotor(catalog, ref.designation, ref.manufacturer);
    // The file's maker is a filter, as desktop's motor database reads a file
    // (ThrustCurveMotorSetDatabase.findMotors): a motor of the same name from
    // another maker is a different motor, and desktop leaves the mount empty
    // with a missing-motor warning rather than fly it. The one exception is the
    // file's digest naming that very motor, which settles it whatever the maker
    // is called.
    const digestConfirms = !!ref.digest && !!match?.motor.digests?.some((d) => d.digest === ref.digest);
    const otherMaker = match?.doubt === 'maker' && !digestConfirms;
    const cat = otherMaker ? undefined : match?.motor;
    // The curve the file names by digest, unless the catalog holds that exact
    // motor: an imported motor saved from this app, or any motor the catalog
    // does not carry under that digest. A name match alone could be a different
    // motor that happens to share it.
    const named = ref.digest ? embedded.byDigest.get(ref.digest) : undefined;
    if (named && !cat?.digests?.some((d) => d.digest === ref.digest)) return customMotorToSpec(named, ref.delay);
    if (match?.doubt && match.doubt !== 'maker') noteDoubt(ref, match.motor, match.doubt);
    if (!cat) {
      // Before giving up: the file may carry the curve itself.
      const curve = own();
      if (curve) {
        notes.push(keyedNote('importNote.motorFileCurve', { motor: ref.designation }));
        return customMotorToSpec(curve, ref.delay);
      }
      // Keep the designation as an unresolved (curve-less) motor rather than a
      // default: the mount shows what the file wanted, the run is blocked until
      // the user picks a real motor, and nothing silently flies a C6.
      notes.push(
        otherMaker
          ? keyedNote('importNote.motorOtherMaker', {
              motor: ref.designation,
              maker: ref.manufacturer,
              catalogMaker: match.motor.manufacturer,
            })
          : keyedNote('importNote.motorNotInCatalog', { motor: ref.designation }),
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
        notes.push(keyedNote('importNote.motorFetchFileCurve', { motor: ref.designation }));
        return customMotorToSpec(curve, ref.delay);
      }
      // Seat the unresolved motor, as the `!cat` branch above does.
      // Leaving the mount empty is not neutral: a mount without an entry is
      // seeded with a default C6 (flightConfigs.reconcileConfig), so a single
      // transient thrustcurve.org failure while opening an L-motor design would
      // produce a runnable simulation flying a 10 N-s C6, with the only warning
      // buried in the import notes that settings.showImportNotes can hide.
      notes.push(keyedNote('importNote.motorFetchFailed', { motor: ref.designation, reason: errorMessage(e) }));
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
   * The file gives a name, and the name is all the catalog is searched by, so
   * without this check a 54 mm J360 could be seated in a 38 mm tube with nothing
   * said. The same `motorFitsMount` test the motor browser uses decides it.
   *
   * Seated anyway, because a file is a statement of what somebody built and
   * dropping its motor would be the app overruling it on a tolerance it is
   * guessing at. The note is the point.
   */
  const checkFit = (mountId: string, spec: MotorSpec): void => {
    const node = byId.get(mountId);
    const fit = node ? mountFit(node) : null;
    if (!fit || !spec.designation || !(spec.diameter > 0)) return;
    const motor = { diameter: spec.diameter * 1000, length: spec.length ? spec.length * 1000 : undefined };
    if (motorFitsMount(motor, fit)) return;
    const key = `${mountId}|${spec.designation}`;
    if (misfits.has(key)) return;
    misfits.add(key);
    const mount = (node!.name as string) || node!.type;
    const tooWide = motor.diameter > fit.bore;
    notes.push(
      tooWide
        ? keyedNote('importNote.motorTooWide', {
            motor: spec.designation,
            mount,
            diameter: round1(motor.diameter),
            bore: round1(fit.bore),
          })
        : keyedNote('importNote.motorTooLong', {
            motor: spec.designation,
            mount,
            length: round1(motor.length ?? 0),
            maxLength: round1(fit.maxLength ?? 0),
          }),
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
      notes.push(keyedNote('importNote.mountsWithoutMotor', { mounts: names }));
    }
  }

  // Seat the opened configuration into the throwaway handle, which is what the
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
    ...(res.simulations ? { simulations: res.simulations } : {}),
    unbuildable: built.unbuildable,
  };
}
