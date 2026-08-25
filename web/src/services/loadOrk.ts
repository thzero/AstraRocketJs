// Full-fidelity .ork loading: parse the file to a component tree (orkFile,
// adopted from mmrocket-sim — targets our engine's RocketTree), build it via
// buildTree, resolve each mount's motor against our catalog, and return static
// info ready to display + simulate. Any design the tree API supports loads —
// stages, transitions, couplers, etc. — not just the fixed editor layout.
import { OpenRocketDesign, resetEngine, type StaticInfo, type IgnitionEvent, type RocketTree } from '../engine/openRocketEngine';
import { importOrk } from './orkFile';
import type { OrkExportMotor } from './orkFile';
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
  for (const [mountId, ref] of Object.entries(res.motors ?? {})) {
    const cat = findCatalogMotor(catalog, ref.designation, ref.manufacturer);
    if (!cat) {
      notes.push(`Motor "${ref.designation}" not found in the catalog — that mount was left empty.`);
      continue;
    }
    try {
      const spec = await fetchMotorSpec(cat, Number.isFinite(ref.delay) ? ref.delay : 0);
      design.setMotorById(mountId, spec);
      if (ref.ignitionEvent && IGNITION_EVENTS.has(ref.ignitionEvent)) {
        design.setMotorIgnitionById(mountId, ref.ignitionEvent as IgnitionEvent, ref.ignitionDelay ?? 0);
      }
    } catch (e) {
      notes.push(`Motor "${ref.designation}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const info = design.staticInfo();
  return { name: res.name, design, info, notes, tree: res.tree, motors: res.motors };
}
