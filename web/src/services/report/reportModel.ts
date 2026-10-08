import type { ComponentNode, OpenRocketDesign, StaticInfo } from '../../engine/openRocketEngine';
import { useWorkspaceStore, selectConfig, configOf } from '../../state/store';
import { buildConfiguredRocket } from '../design/buildRocket';
import { motorSpecs } from '../flight/flightConfigs';
import { motorStats, type MotorStats } from './rocketReport';
import { num, numOpt } from '../../tree/nodeProps';
import { isFinSet } from '../../tree/tubefins';
import { axialLength } from '../../tree/position';
import { walkNodes } from '../../tree/treeWalk';
import { designNameOf } from '../app/appInfo';
import { stageFileName } from '../design/orkTree';
import { errorMessage } from '../app/errorMessage';

/** The full data model for the rocket report (SI). Pure data; the PDF formats it. */

export interface PartRow {
  depth: number;
  type: string;
  name: string;
  material?: string;
  density?: number;
  length: number;
  outerR?: number;
  innerR?: number;
  thickness?: number;
  mass: number;
}

export interface Summary {
  label: string;
  info: StaticInfo;
}

export interface FlightRows {
  maxAltitude: number;
  flightTime: number;
  timeToApogee: number;
  launchRodVelocity: number;
  maxVelocity: number;
  deploymentVelocity: number | null;
  groundHitVelocity: number;
}

export interface MotorConfig {
  name: string;
  motors: MotorStats[];
  loadedMass: number;
  flight: FlightRows | null;
}

/** A fin set's axial position (m) from the nose tip — root leading/trailing edge. */
export interface FinSetPosition {
  name: string;
  topX: number;
  bottomX: number;
}

export interface ReportModel {
  name: string;
  stages: ComponentNode[];
  whole: Summary;
  /** One entry per stage (a single-stage rocket's stage IS the whole rocket). */
  stageSummaries: Summary[];
  configs: MotorConfig[];
  partsByStage: { stage: string; rows: PartRow[] }[];
  finSetsByStage: { stage: string; sets: FinSetPosition[] }[];
}

export function stageParts(
  stage: ComponentNode,
  rocket: { componentInfo: (id: string) => { mass: number } },
): PartRow[] {
  const rows: PartRow[] = [];
  const walk = (node: ComponentNode, depth: number) => {
    if (node.type !== 'stage') {
      const id = node.id;
      let mass = 0;
      if (id) {
        try {
          mass = rocket.componentInfo(id).mass;
        } catch {
          /* a part the engine can't weigh — leave 0 */
        }
      }
      rows.push({
        depth,
        type: node.type,
        name: (node.name as string) || '',
        material: node.materialName as string | undefined,
        density: node.density,
        length: num(node, 'length', 0),
        outerR: numOpt(node, 'outerRadius'),
        innerR: numOpt(node, 'innerRadius'),
        thickness: numOpt(node, 'thickness'),
        mass,
      });
    }
    for (const c of node.children ?? []) walk(c, node.type === 'stage' ? depth : depth + 1);
  };
  for (const c of stage.children ?? []) walk(c, 0);
  return rows;
}

/** One full engine build: its static info plus the live handle to install. */
export interface ReportBuild {
  info: StaticInfo;
  handle: OpenRocketDesign;
}

/**
 * One static-info summary per stage for a multi-stage rocket. Each per-stage
 * build resets the shared engine, so the whole-rocket handle is rebuilt and
 * reinstalled afterwards — in a `finally`, so a stage that fails to build can't
 * leave the app's live 3D/stability handle stranded on the last stage built.
 *
 * The engine work is injected so this stays testable without the real engine:
 * `buildStage` builds an isolated rocket from one stage and returns its static
 * info, `buildWhole` rebuilds the full rocket, and `restore` installs that final
 * build as the live handle.
 */
export function multiStageSummaries(
  stages: ComponentNode[],
  stageName: (st: ComponentNode, i: number) => string,
  buildStage: (st: ComponentNode) => StaticInfo,
  buildWhole: () => ReportBuild,
  restore: (built: ReportBuild) => void,
  onRestoreFailed: (e: unknown) => void,
): Summary[] {
  try {
    return stages.map((st, i) => ({ label: stageName(st, i), info: buildStage(st) }));
  } finally {
    // The `finally` protected against a STAGE build throwing. It did not protect
    // against `buildWhole()` itself throwing, and then `restore` never ran and
    // the store kept pointing at the last per-stage build: a handle for one
    // stage, standing in for the rocket. Nothing re-triggers the rebuild effect,
    // because its dependencies did not change, so the aero pane stayed dead
    // until an unrelated edit moved them.
    //
    // Reported, never rethrown. Rethrowing from a `finally` REPLACES whatever
    // the try block threw, which would lose the stage failure that is the more
    // useful of the two. The report itself is still valid - parts and fin-set
    // positions were gathered off the live handle before any rebuild, and each
    // stage summary comes from its own isolated build - so it is returned, and
    // what is wrong is said out loud rather than left to be discovered.
    try {
      restore(buildWhole());
    } catch (e) {
      onRestoreFailed(e);
    }
  }
}

/**
 * Assemble the report from the live design + simulations (synchronous engine
 * work).
 *
 * `install` is where the whole-rocket rebuild goes on a MULTI-STAGE design,
 * whose per-stage builds reset the shared engine. It defaults to re-seating the
 * live handle through the store, which is what a caller outside React wants.
 * A caller rendering a component passes its own, because a store write during
 * render updates every other subscriber mid-render; it is handed the same build
 * to install once it is out of the render pass. The engine is whole either way
 * by the time this returns: only the store's view of it is the caller's to time.
 */
export function assembleReport(install?: (built: ReportBuild) => void): ReportModel | null {
  const s = useWorkspaceStore.getState();
  const { tree, info, rocket } = s;
  if (!info || !rocket) return null;
  const name = designNameOf(tree, s.loadedMeta);
  const stages = tree.components.filter((n) => n.type === 'stage');
  const stageList = stages.length
    ? stages
    : [{ type: 'stage', name: '', children: tree.components } as unknown as ComponentNode];

  const infoRocket = rocket as unknown as { componentInfo: (id: string) => { mass: number; positionX: number } };
  // The name the .ork written beside this report gives the stage, since the
  // report's own rows go into that file's <designinfo> and the design CSV.
  const stageName = stageFileName;

  // Parts + fin-set positions need the live handle — gather BEFORE any rebuild.
  const partsByStage = stageList.map((st, i) => ({
    stage: stageName(st, i),
    rows: stageParts(st, infoRocket),
  }));
  const finSetsByStage = stageList.map((st, i) => ({
    stage: stageName(st, i),
    sets: finSetPositions(st, infoRocket),
  }));

  const whole: Summary = { label: name, info };

  // One summary per stage. A single-stage rocket's stage IS the whole rocket, so
  // reuse its info (no rebuild). Multiple stages build each alone — those builds
  // reset the engine, so the app's live handle is rebuilt and restored (in a
  // finally, see multiStageSummaries) even if a stage build throws.
  let stageSummaries: Summary[];
  if (stages.length > 1) {
    const flown = selectConfig(s);
    stageSummaries = multiStageSummaries(
      stages,
      stageName,
      (st) =>
        // Each stage is built alone, and the configuration keys its motors by
        // MOUNT ID, so a one-stage tree gets exactly the motors that stage's own
        // mounts hold: the sustainer's motor cannot land in the booster, and a
        // stage with no mount is built empty rather than borrowing one.
        buildConfiguredRocket({ name, components: [st] }, flown).staticInfo(),
      () => {
        // The live handle is REPLACED by this, so it has to be configured the
        // way the rebuild effect configures it - the same configuration, whose
        // ignition overrides ride along with its motors.
        const main = buildConfiguredRocket(tree, flown);
        return { info: main.staticInfo(), handle: main };
      },
      install ?? ((built) => s.applyBuild(built.info, built.handle)),
      (e) => {
        // Clear the live build rather than leave a stage handle standing in for
        // the rocket. The stats and the aero pane then show their "not built"
        // state, which is true, and the next design edit rebuilds.
        s.applyBuild(null, null);
        s.setErr(errorMessage(e));
      },
    );
  } else {
    stageSummaries = stageList.map((st, i) => ({ label: stageName(st, i), info }));
  }

  const configs: MotorConfig[] = s.sims.map((sim) => {
    const specs = motorSpecs(tree, configOf(s.configs, sim)).filter((m) => m.times?.length);
    return {
      name: sim.name,
      motors: specs.map((m) => motorStats(m)),
      loadedMass: info.mass,
      flight: sim.result ? sim.result.summary : null,
    };
  });

  return { name, stages: stageList, whole, stageSummaries, configs, partsByStage, finSetsByStage };
}

/** Each fin set in a stage, with its root's axial span from the nose (m). */
export function finSetPositions(
  stage: ComponentNode,
  rocket: { componentInfo: (id: string) => { positionX: number } },
): FinSetPosition[] {
  const out: FinSetPosition[] = [];
  for (const n of walkNodes(stage.children ?? [])) {
    if (!isFinSet(String(n.type)) || typeof n.id !== 'string') continue;
    // axialLength, not a per-type ternary here: it already dispatches
    // freeform → root chord, trapezoid/elliptical → rootChord, everything
    // else → length. That "everything else" is what tube fins need: they
    // are marked like any other fin set (OpenRocket's FinMarkingGuide
    // collects TubeFinSet beside FinSet) but their axial span is the TUBE'S
    // length, and reading through rootChord would give every one of them a
    // 50 mm root it does not have.
    const root = axialLength(n);
    try {
      const topX = rocket.componentInfo(n.id).positionX;
      out.push({ name: (n.name as string) || 'Fin set', topX, bottomX: topX + root });
    } catch {
      /* skip a fin set the engine can't locate */
    }
  }
  return out;
}
