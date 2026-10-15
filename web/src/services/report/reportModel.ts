import type { ComponentNode, OpenRocketDesign, RocketTree, StaticInfo } from '../../engine/openRocketEngine';
import { useWorkspaceStore, selectConfig, selectOutdated, configOf } from '../../state/store';
import { buildConfiguredRocket, buildKey } from '../design/buildRocket';
import { findStages } from '../design/treeEdit';
import { liveMotors, type FlightConfig } from '../flight/flightConfigs';
import { motorStats, type MotorStats } from './rocketReport';
import { numOpt } from '../../tree/nodeProps';
import { isFinSet, isPlanarFinSet } from '../../tree/tubefins';
import { finMount, finSpan } from '../../tree/finPlanform';
import { parentStartOf } from '../../tree/axialRebase';
import { axialLength } from '../../tree/position';
import { walkNodes } from '../../tree/treeWalk';
import { designNameOf } from '../app/appInfo';
import { stageFileName } from '../design/orkTree';
import i18n from '../../i18n';
import { errorText } from '../../i18n/keyedError';

/** The full data model for the rocket report (SI). Pure data; the PDF formats it. */

export interface PartRow {
  depth: number;
  type: string;
  name: string;
  material?: string;
  /** The material's density, in SI for `densityKind`. */
  density?: number;
  /** Which density `density` is: bulk (kg/m³, also when absent), surface (kg/m²) or line (kg/m). */
  densityKind?: MaterialDensity;
  length: number;
  outerR?: number;
  innerR?: number;
  /** A transition's two ends, which it carries instead of one outer radius. */
  foreR?: number;
  aftR?: number;
  thickness?: number;
  /** A planar fin set's span, root to tip. Its root chord is `length`. */
  span?: number;
  mass: number;
}

/** The quantity a part's material density is measured in. */
export type MaterialDensity = 'density' | 'surfaceDensity' | 'lineDensity';

/**
 * The node keys of the material the kernel's `getMaterial()` returns for a part:
 * a parachute's and a streamer's canopy (`RecoveryDevice`, a surface material),
 * a shock cord's cord (`ShockCord`, a line material), and the bulk material of
 * everything else. A parachute's shroud lines are a second material the kernel
 * reads through `getLineMaterial()`.
 */
function rowMaterial(
  node: ComponentNode,
): Required<Pick<PartRow, 'densityKind'>> & Pick<PartRow, 'material' | 'density'> {
  const [name, density, densityKind]: [string, string, MaterialDensity] =
    node.type === 'parachute' || node.type === 'streamer'
      ? ['surfaceMaterialName', 'surfaceDensity', 'surfaceDensity']
      : node.type === 'shockcord'
        ? ['lineMaterialName', 'lineDensity', 'lineDensity']
        : ['materialName', 'density', 'density'];
  const n = node[name];
  return { material: typeof n === 'string' ? n : undefined, density: numOpt(node, density), densityKind };
}

/**
 * The radii a part's row shows, per type: a nose cone's base, a transition's
 * fore and aft ends, and a tube's bore from its outside and wall, since a tube
 * stores a thickness rather than an inner radius. A filled part has no bore.
 */
function rowRadii(node: ComponentNode): Pick<PartRow, 'outerR' | 'innerR' | 'foreR' | 'aftR'> {
  if (node.type === 'nosecone') return { outerR: numOpt(node, 'aftRadius') };
  if (node.type === 'transition') return { foreR: numOpt(node, 'foreRadius'), aftR: numOpt(node, 'aftRadius') };
  const outerR = numOpt(node, 'outerRadius');
  if (node['filled'] === true) return { outerR };
  const thickness = numOpt(node, 'thickness');
  const innerR =
    numOpt(node, 'innerRadius') ?? (outerR != null && thickness != null ? Math.max(0, outerR - thickness) : undefined);
  return { outerR, innerR };
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

/** One seated motor of a configuration, with the launch mass it lifts. */
export interface ConfigMotor extends MotorStats {
  /**
   * Launch mass (kg) of the stack from the top stage through this motor's own
   * stage, with this configuration's motors in it. NaN when the kernel could not
   * build the configuration.
   */
  loadedMass: number;
}

export interface MotorConfig {
  name: string;
  motors: ConfigMotor[];
  flight: FlightRows | null;
  /**
   * The flight was flown from inputs other than the current ones (the design,
   * its configuration, the launch or the run preferences), so its figures do
   * not describe the design the rest of the report does.
   */
  outdated?: boolean;
}

/** A fin set's axial position (m) from the nose tip: root leading/trailing edge. */
export interface FinSetPosition {
  /** The fin set's own name; absent when it has none, and a writer names it by `type`. */
  name?: string;
  type: string;
  topX: number;
  bottomX: number;
}

export interface ReportModel {
  name: string;
  /** The design type token as stored (`original`, `commercial_kit`, ...), when the design names one. */
  designType?: string;
  stages: ComponentNode[];
  whole: Summary;
  /** One entry per stage (a single-stage rocket's stage is the whole rocket). */
  stageSummaries: Summary[];
  configs: MotorConfig[];
  partsByStage: { stage: string; rows: PartRow[] }[];
  finSetsByStage: { stage: string; sets: FinSetPosition[] }[];
}

/**
 * The parts table of one stage. `tree` is the design the stage is in, which a
 * freeform fin's span reads its parent's station from (`finMount`); a stage
 * on its own stands for a one-stage design.
 */
export function stageParts(
  stage: ComponentNode,
  rocket: { componentInfo: (id: string) => { mass: number } },
  tree: RocketTree = { components: [stage] },
): PartRow[] {
  const rows: PartRow[] = [];
  const walk = (node: ComponentNode, depth: number, parent: ComponentNode | null) => {
    if (node.type !== 'stage') {
      const id = node.id;
      let mass = 0;
      if (id) {
        try {
          mass = rocket.componentInfo(id).mass;
        } catch {
          /* a part the engine can't weigh: leave 0 */
        }
      }
      rows.push({
        depth,
        type: node.type,
        name: (node.name as string) || '',
        ...rowMaterial(node),
        // A fin set's root chord, and the kernel's default for a part with no
        // length on record, rather than 0.
        length: axialLength(node),
        ...rowRadii(node),
        // A filled part is solid: the stored wall is not what flies.
        thickness: node['filled'] === true ? undefined : numOpt(node, 'thickness'),
        ...(isPlanarFinSet(node.type)
          ? { span: finSpan(node, parent && finMount(node, parent, parentStartOf(tree, parent))) }
          : {}),
        mass,
      });
    }
    for (const c of node.children ?? []) walk(c, node.type === 'stage' ? depth : depth + 1, node);
  };
  for (const c of stage.children ?? []) walk(c, 0, stage);
  return rows;
}

/** One full engine build: its static info plus the live handle to install. */
export interface ReportBuild {
  info: StaticInfo;
  handle: OpenRocketDesign;
}

/**
 * Run report work that may build rockets of its own, then put the live handle
 * back. Every build resets the shared engine, so once `work` has built anything
 * (`rebuilt()` says whether it did) the whole-rocket handle is rebuilt and
 * reinstalled, in a `finally`, so a build that fails can't leave the app's live
 * 3D/stability handle stranded on the last rocket built.
 *
 * The engine work is injected so this stays testable without the real engine:
 * `buildWhole` rebuilds the full rocket, and `restore` installs that final build
 * as the live handle.
 */
export function restoringEngine<T>(
  work: () => T,
  rebuilt: () => boolean,
  buildWhole: () => ReportBuild,
  restore: (built: ReportBuild) => void,
  onRestoreFailed: (e: unknown) => void,
): T {
  try {
    return work();
  } finally {
    if (rebuilt()) restoreWhole(buildWhole, restore, onRestoreFailed);
  }
}

function restoreWhole(
  buildWhole: () => ReportBuild,
  restore: (built: ReportBuild) => void,
  onRestoreFailed: (e: unknown) => void,
): void {
  // The `finally` covers the work throwing; this try covers `buildWhole()`
  // itself throwing. Unguarded, `restore` would never run and the store would
  // keep pointing at the last report build: a handle for one stage or one
  // configuration, standing in for the rocket. Nothing re-triggers the rebuild
  // effect, because its dependencies did not change, so the aero pane would stay
  // dead until an unrelated edit moved them.
  //
  // Reported, never rethrown. Rethrowing from a `finally` replaces whatever the
  // try block threw, which would lose the build failure that is the more useful
  // of the two. The report itself is still valid - parts and fin-set positions
  // were gathered off the live handle before any rebuild, and each summary and
  // mass comes from its own isolated build - so it is returned, and what is
  // wrong is said out loud rather than left to be discovered.
  try {
    restore(buildWhole());
  } catch (e) {
    onRestoreFailed(e);
  }
}

/** What a configuration's motor masses need of a built rocket. */
export type MassBuild = Pick<OpenRocketDesign, 'setStageActiveById' | 'staticInfo'>;

/**
 * Each seated motor of one configuration, with the launch mass it lifts.
 *
 * A motor lifts the stack from the top stage through the stage it sits in, with
 * this configuration's motors: the sustainer's motor does not lift the booster,
 * and a booster's motor lifts everything above it. The stages through the
 * motor's are on and the ones below it off, whatever the configuration grounds,
 * which is how the desktop design report weighs them. A parallel booster counts
 * with the stage it is attached to.
 *
 * `build` builds the configured rocket (a real build resets the shared engine,
 * so the caller restores the live handle afterward). `whole`, when given, is the
 * launch mass of this exact configuration with every stage on, from a build
 * already in hand; with it, a configuration that grounds nothing needs no build
 * for a motor in the bottom stage.
 */
export function configMotors(
  tree: RocketTree,
  config: FlightConfig,
  build: (tree: RocketTree, config: FlightConfig) => MassBuild,
  whole?: number,
): ConfigMotor[] {
  const top = tree.components.filter((n) => n.type === 'stage');
  const last = Math.max(0, top.length - 1);
  // Mount id → index of the top-level stage it is in.
  const stageOf = new Map<string, number>();
  top.forEach((st, i) => {
    for (const n of walkNodes([st])) if (typeof n.id === 'string') stageOf.set(n.id, i);
  });
  // Every stage id (nested parallel boosters included) under each top-level stage.
  const stageIds = top.map((st) => findStages({ ...tree, components: [st] }).map((n) => n.id as string));

  const masses = new Map<number, number>();
  if (whole != null && !config.grounded?.length) masses.set(last, whole);
  let built: MassBuild | null = null;
  let failed = false;
  const massThrough = (k: number): number => {
    const known = masses.get(k);
    if (known != null) return known;
    let mass = NaN;
    if (!failed) {
      try {
        built ??= build(tree, config);
        const r = built;
        stageIds.forEach((ids, i) => ids.forEach((id) => r.setStageActiveById(id, i <= k)));
        mass = r.staticInfo().mass;
      } catch {
        // A configuration the kernel cannot build has no mass to divide by; its
        // thrust-to-weight reads as no value rather than taking the report down.
        failed = true;
      }
    }
    masses.set(k, mass);
    return mass;
  };

  return liveMotors(tree, config)
    .filter(([, m]) => m.spec.times?.length)
    .map(([id, m]) => ({ ...motorStats(m.spec), loadedMass: massThrough(stageOf.get(id) ?? last) }));
}

/**
 * Assemble the report from the live design + simulations (synchronous engine
 * work).
 *
 * `install` is where the whole-rocket rebuild goes when the report built rockets
 * of its own (a multi-stage design's per-stage summaries, a configuration other
 * than the one flown), since those builds reset the shared engine. It defaults
 * to re-seating the live handle through the store, which is what a caller
 * outside React wants. A caller rendering a component passes its own, because a
 * store write during render updates every other subscriber mid-render; it is
 * handed the same build to install once it is out of the render pass. The
 * engine is whole either way by the time this returns: only the store's view of
 * it is the caller's to time.
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

  // Parts + fin-set positions need the live handle: gather before any rebuild.
  const partsByStage = stageList.map((st, i) => ({
    stage: stageName(st, i),
    rows: stageParts(st, infoRocket, tree),
  }));
  const finSetsByStage = stageList.map((st, i) => ({
    stage: stageName(st, i),
    sets: finSetPositions(st, infoRocket),
  }));

  const whole: Summary = { label: name, info };
  const flown = selectConfig(s);
  const flownKey = buildKey(tree, flown);

  // Every build below resets the engine, so once one has run the app's live
  // handle is rebuilt and restored (in a finally, see restoringEngine) even if a
  // build throws.
  let rebuilt = false;
  const build = (t: RocketTree, c: FlightConfig) => {
    rebuilt = true;
    return buildConfiguredRocket(t, c);
  };

  const { stageSummaries, configs } = restoringEngine(
    () => {
      // One summary per stage. A single-stage rocket's stage is the whole
      // rocket, so its info is reused (no rebuild). Multiple stages build each
      // alone: the configuration keys its motors by mount id, so a one-stage
      // tree gets exactly the motors that stage's own mounts hold, the
      // sustainer's motor cannot land in the booster, and a stage with no mount
      // is built empty rather than borrowing one.
      const stageSummaries: Summary[] =
        stages.length > 1
          ? stages.map((st, i) => ({
              label: stageName(st, i),
              info: build({ name, components: [st] }, flown).staticInfo(),
            }))
          : stageList.map((st, i) => ({ label: stageName(st, i), info }));
      // Each configuration weighed with its own motors. The flown one's full
      // stack is the live info already, so it costs no build.
      const configs: MotorConfig[] = s.sims.map((sim) => {
        const config = configOf(s.configs, sim);
        return {
          name: sim.name,
          motors: configMotors(tree, config, build, buildKey(tree, config) === flownKey ? info.mass : undefined),
          flight: sim.result ? sim.result.summary : null,
          outdated: sim.result ? selectOutdated(s, sim) : false,
        };
      });
      return { stageSummaries, configs };
    },
    () => rebuilt,
    () => {
      // The live handle is replaced by this, so it has to be configured the
      // way the rebuild effect configures it - the same configuration, whose
      // ignition overrides ride along with its motors.
      const main = buildConfiguredRocket(tree, flown);
      return { info: main.staticInfo(), handle: main };
    },
    install ?? ((built) => s.applyBuild(built.info, built.handle)),
    (e) => {
      // Clear the live build rather than leave a report build standing in for
      // the rocket. The stats and the aero pane then show their "not built"
      // state, which is true, and the next design edit rebuilds.
      s.applyBuild(null, null);
      s.setErr(errorText(e, i18n.t));
    },
  );

  return {
    name,
    designType: tree.designType,
    stages: stageList,
    whole,
    stageSummaries,
    configs,
    partsByStage,
    finSetsByStage,
  };
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
    // collects TubeFinSet beside FinSet) but their axial span is the tube's
    // length, and reading through rootChord would give every one of them a
    // 50 mm root it does not have.
    const root = axialLength(n);
    try {
      const topX = rocket.componentInfo(n.id).positionX;
      const own = typeof n.name === 'string' ? n.name.trim() : '';
      out.push({ ...(own ? { name: own } : {}), type: String(n.type), topX, bottomX: topX + root });
    } catch {
      /* skip a fin set the engine can't locate */
    }
  }
  return out;
}
