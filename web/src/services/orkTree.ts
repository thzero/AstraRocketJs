// Minimal tree helpers extracted from mmrocket-sim's tree/treeModel.ts — just
// the two functions orkFile.ts needs, so we avoid pulling in its full tree
// editor (position/schema). Plus the LaunchConditions shape .ork parsing fills.
import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';

let counter = 1;

/** A fresh editor/kernel node id (also used by setMotorById). */
export function freshId(): string {
  return `c${counter++}`;
}

/**
 * Tree components as a stage-node list. A flat tree (no explicit stages) is
 * wrapped into one implicit Sustainer stage; already-staged trees pass through.
 */
export function asStageNodes(tree: RocketTree): ComponentNode[] {
  return tree.components.every((c) => c.type === 'stage')
    ? tree.components
    : [{ type: 'stage', name: 'Sustainer', children: tree.components } as ComponentNode];
}

/** Launch conditions parsed from a .ork's first `<simulation>` `<conditions>`. */
export interface LaunchConditions {
  launchRodLengthM: number;
  launchRodAngleDeg: number;
  windAverage: number;
  windStdDev: number;
  launchAltitudeM: number;
  latitudeDeg: number;
  /** null when the file declares the ISA standard atmosphere. */
  temperatureC: number | null;
  /** null when the file declares the ISA standard atmosphere. */
  pressureHPa: number | null;
}
