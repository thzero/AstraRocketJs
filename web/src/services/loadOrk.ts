import {
  OpenRocketDesign,
  resetEngine,
  type StaticInfo,
  type IgnitionEvent,
  type RocketTree,
  type MotorSpec,
} from '../engine/openRocketEngine';
import { importOrk } from './orkFile';
import type { OrkExportMotor } from './orkFile';
import type { LaunchConditions } from './orkTree';

/** A resolved motor + its ignition override, keyed by mount id for rebuilds. */
export interface MountMotor {
  spec: MotorSpec;
  ignitionEvent?: IgnitionEvent;
  ignitionDelay?: number;
}
import { loadCatalog, findCatalogMotor } from './motorDb';
import { fetchMotorSpec } from './thrustcurve';

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

export async function loadOrk(buffer: ArrayBuffer): Promise<LoadedOrk> {
  resetEngine(); // free the previous design's handles
  const res = importOrk(buffer);
  const design = OpenRocketDesign.buildTree(res.tree);

  const notes = [...(res.notes ?? []), ...(res.ignored ?? []).map((i) => `Skipped unsupported: ${i}`)];

  const catalog = await loadCatalog();
  const motorSpecs: Record<string, MountMotor> = {};
  for (const [mountId, ref] of Object.entries(res.motors ?? {})) {
    const cat = findCatalogMotor(catalog, ref.designation, ref.manufacturer);
    if (!cat) {
      // Keep the designation as an UNRESOLVED (curve-less) motor rather than a
      // default: the mount shows what the file wanted, the run is blocked until
      // the user picks a real motor, and nothing silently flies a C6.
      notes.push(`Motor "${ref.designation}" isn't in the catalog — pick a motor for that mount (it won't fly a default).`);
      motorSpecs[mountId] = { spec: unresolvedMotor(ref) };
      continue;
    }
    try {
      const spec = await fetchMotorSpec(cat, ref.delay);
      design.setMotorById(mountId, spec);
      const entry: MountMotor = { spec };
      if (ref.ignitionEvent && IGNITION_EVENTS.has(ref.ignitionEvent)) {
        design.setMotorIgnitionById(mountId, ref.ignitionEvent as IgnitionEvent, ref.ignitionDelay ?? 0);
        entry.ignitionEvent = ref.ignitionEvent as IgnitionEvent;
        entry.ignitionDelay = ref.ignitionDelay ?? 0;
      }
      motorSpecs[mountId] = entry;
    } catch (e) {
      notes.push(`Motor "${ref.designation}": ${e instanceof Error ? e.message : String(e)}`);
    }
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
  return { name: res.name, design, info, notes, tree: res.tree, motors: res.motors, motorSpecs, launch: res.launch };
}
