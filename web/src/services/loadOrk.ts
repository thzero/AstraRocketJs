import { OpenRocketDesign, resetEngine, type StaticInfo, type IgnitionEvent, type RocketTree, type MotorSpec } from '../engine/openRocketEngine';
import { importOrk } from './orkFile';
import type { OrkExportMotor } from './orkFile';
import type { LaunchConditions } from './orkTree';

/** A resolved motor + its ignition override, keyed by mount id for rebuilds. */
export interface MountMotor { spec: MotorSpec; ignitionEvent?: IgnitionEvent; ignitionDelay?: number }
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

const IGNITION_EVENTS: ReadonlySet<string> = new Set([
  'automatic', 'launch', 'ejectioncharge', 'burnout', 'never',
]);

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
      notes.push(`Motor "${ref.designation}" not found in the catalog — that mount was left empty.`);
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

  const info = design.staticInfo();
  return { name: res.name, design, info, notes, tree: res.tree, motors: res.motors, motorSpecs, launch: res.launch };
}
