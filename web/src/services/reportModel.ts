import type { ComponentNode, OpenRocketDesign, StaticInfo } from '../engine/openRocketEngine';
import { useWorkspaceStore, selectActive } from '../state/store';
import { buildConfiguredRocket } from './buildRocket';
import { motorStats, type MotorStats } from './rocketReport';
import { num } from '../tree/nodeProps';
import { defaultDesignName } from './appInfo';

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

export function stageParts(stage: ComponentNode, rocket: { componentInfo: (id: string) => { mass: number } }): PartRow[] {
  const rows: PartRow[] = [];
  const walk = (node: ComponentNode, depth: number) => {
    if (node.type !== 'stage') {
      const id = node.id as string | undefined;
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
        density: node.density as number | undefined,
        length: num(node, 'length', 0),
        outerR: typeof node['outerRadius'] === 'number' ? (node['outerRadius'] as number) : undefined,
        innerR: typeof node['innerRadius'] === 'number' ? (node['innerRadius'] as number) : undefined,
        thickness: typeof node['thickness'] === 'number' ? (node['thickness'] as number) : undefined,
        mass,
      });
    }
    for (const c of node.children ?? []) walk(c, node.type === 'stage' ? depth : depth + 1);
  };
  for (const c of stage.children ?? []) walk(c, 0);
  return rows;
}

/** One full engine build: its static info plus the live handle to install. */
interface Built {
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
  buildWhole: () => Built,
  restore: (built: Built) => void,
): Summary[] {
  try {
    return stages.map((st, i) => ({ label: stageName(st, i), info: buildStage(st) }));
  } finally {
    restore(buildWhole());
  }
}

/** Assemble the report from the live design + simulations (synchronous engine work). */
export function assembleReport(): ReportModel | null {
  const s = useWorkspaceStore.getState();
  const { tree, info, rocket } = s;
  if (!info || !rocket) return null;
  const name = s.loadedMeta?.name || tree.name || defaultDesignName();
  const stages = tree.components.filter((n) => n.type === 'stage');
  const stageList = stages.length ? stages : [{ type: 'stage', name: '', children: tree.components } as unknown as ComponentNode];

  const infoRocket = rocket as unknown as { componentInfo: (id: string) => { mass: number; positionX: number } };
  const stageName = (st: ComponentNode, i: number) => (st.name as string) || `Stage ${i + 1}`;

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
    const active = selectActive(s);
    stageSummaries = multiStageSummaries(
      stages,
      stageName,
      (st) => buildConfiguredRocket({ name, components: [st] } as never, active.motor, s.extraMotors).staticInfo(),
      () => {
        const main = buildConfiguredRocket(tree, active.motor, s.extraMotors);
        return { info: main.staticInfo(), handle: main };
      },
      (built) => s.applyBuild(built.info, built.handle),
    );
  } else {
    stageSummaries = stageList.map((st, i) => ({ label: stageName(st, i), info }));
  }

  const configs: MotorConfig[] = s.sims.map((sim) => {
    const specs = [sim.motor, ...Object.values(s.extraMotors).map((m) => m.spec)].filter((m) => m && m.times?.length);
    return {
      name: sim.name,
      motors: specs.map((m) => motorStats(m!)),
      loadedMass: info.mass,
      flight: sim.result ? sim.result.summary : null,
    };
  });

  return { name, stages: stageList, whole, stageSummaries, configs, partsByStage, finSetsByStage };
}

/** Each fin set in a stage, with its root's axial span from the nose (m). */
export function finSetPositions(stage: ComponentNode, rocket: { componentInfo: (id: string) => { positionX: number } }): FinSetPosition[] {
  const out: FinSetPosition[] = [];
  const walk = (nodes: ComponentNode[]) => {
    for (const n of nodes) {
      if (String(n.type).endsWith('finset') && typeof n.id === 'string') {
        const ff = n.type === 'freeformfinset' ? ((n['points'] as [number, number][] | undefined) ?? []) : [];
        const root = n.type === 'freeformfinset' && ff.length ? Math.max(...ff.map((p) => p[0])) : num(n, 'rootChord', 0.05);
        try {
          const topX = rocket.componentInfo(n.id).positionX;
          out.push({ name: (n.name as string) || 'Fin set', topX, bottomX: topX + root });
        } catch {
          /* skip a fin set the engine can't locate */
        }
      }
      if (n.children) walk(n.children);
    }
  };
  walk(stage.children ?? []);
  return out;
}
