import type { OpenRocketDesign, RocketTree } from '../../../engine/openRocketEngine';
import { findStages } from '../../design/treeEdit';

/**
 * One stage's cell pair in RASAero's simulation block: the launch mass (kg)
 * and CG (m from the nose tip) of the stack from the sustainer through that
 * stage, with the motors those stages carry.
 */
export interface StageLaunch {
  massKg: number;
  cgM: number;
}

/** What the per-stage figures need of a built rocket. */
export type StageMassBuild = Pick<OpenRocketDesign, 'setStageActiveById' | 'staticInfo'>;

/**
 * The simulation block's cells for every top-level stage, cumulative from the
 * sustainer down, as desktop's `SimulationDTO` fills them: the sustainer
 * alone, then the sustainer with booster 1, then with booster 2 as well, each
 * from `MassCalculator` with only those stages active and their motors in.
 *
 * `rocket` is a build of the configuration being exported, with its motors
 * seated (`buildConfiguredRocket`). Every call sets each stage's activity, so
 * the figures do not depend on what the handle was left at; a parallel booster
 * counts with the stage it is attached to, as the design report weighs it. The
 * handle is left with every stage on. It is a scratch build: building resets
 * the shared engine, so the caller restores the live handle afterward, as the
 * design report does.
 */
export function cumulativeStageLaunch(tree: RocketTree, rocket: StageMassBuild): StageLaunch[] {
  const top = tree.components.filter((n) => n.type === 'stage');
  const stageIds = top.map((st) => findStages({ ...tree, components: [st] }).map((n) => n.id as string));
  return top.map((_, k) => {
    stageIds.forEach((ids, i) => ids.forEach((id) => rocket.setStageActiveById(id, i <= k)));
    const info = rocket.staticInfo();
    return { massKg: info.mass, cgM: info.cg };
  });
}
