/**
 * Thin app-facing helpers over the OpenRocket engine wrapper (openRocketEngine.ts).
 * Keeps the UI free of engine handle bookkeeping.
 */
import {
  OpenRocketDesign,
  resetEngine,
  type RocketSpec,
  type MotorSpec,
  type RocketTree,
  type ComponentNode,
} from './openRocketEngine';
import { defaultDesignName } from '../services/appInfo';

export type { RocketSpec, StaticInfo, FlightResult, FlightSeries } from './openRocketEngine';

/** A stock Estes C6 (SI units): times→thrust, per-sample motor mass. */
export const C6: MotorSpec = {
  designation: 'C6',
  manufacturer: 'Estes',
  diameter: 0.018,
  length: 0.07,
  times: [0, 0.2, 0.4, 2.0, 2.1],
  thrusts: [0, 12, 5, 5, 0],
  masses: [0.0227, 0.0165, 0.0165, 0.013, 0.012],
  cgX: 0.035,
  ejectionDelay: 3.0,
};

/**
 * Rebuild the rocket from scratch and attach the motor. resetEngine() frees the
 * previous design's handles, so always rebuild before reading static info / simulating.
 */
export function buildRocket(spec: RocketSpec, motor: MotorSpec = C6): OpenRocketDesign {
  resetEngine();
  const rocket = OpenRocketDesign.build(spec);
  rocket.setMotor(motor);
  return rocket;
}

/**
 * Build a rocket from an editable component tree and (optionally) seat a motor
 * in the mount with `mountId`. Used by the tree editor — mirrors buildRocket
 * but for arbitrary trees. resetEngine() frees the previous design's handles.
 */
export function buildRocketTree(tree: RocketTree, motor?: MotorSpec, mountId?: string): OpenRocketDesign {
  resetEngine();
  const rocket = OpenRocketDesign.buildTree(tree);
  if (motor && mountId) rocket.setMotorById(mountId, motor);
  return rocket;
}

/**
 * The editor's fixed-layout RocketSpec as a component tree (for `.ork` export):
 * stage → nose + body(fins, motor-mount inner tube, parachute). Returns the
 * mount's node id so the caller can attach the motor by id.
 */
export function specToTree(spec: RocketSpec): { tree: RocketTree; mountId: string } {
  const mountId = 'mount';
  const bulk = (density?: number, materialName?: string) =>
    density ? { density, ...(materialName ? { materialName } : {}) } : {};

  const nose: ComponentNode = {
    type: 'nosecone', id: 'nose', shape: spec.noseCone.shape ?? 'ogive',
    length: spec.noseCone.length, aftRadius: spec.noseCone.aftRadius, thickness: spec.noseCone.thickness,
    ...bulk(spec.noseCone.materialDensity, spec.noseCone.material),
  };
  const body: ComponentNode = {
    type: 'bodytube', id: 'body',
    length: spec.bodyTube.length, outerRadius: spec.bodyTube.outerRadius, thickness: spec.bodyTube.thickness,
    ...bulk(spec.bodyTube.materialDensity, spec.bodyTube.material),
    children: [
      {
        type: 'trapezoidfinset', id: 'fins', finCount: spec.fins.count,
        rootChord: spec.fins.rootChord, tipChord: spec.fins.tipChord, sweep: spec.fins.sweep,
        height: spec.fins.height, thickness: spec.fins.thickness,
        // Fin sets sit at the aft end of the body tube (bottom-aligned), like
        // OpenRocket's default — without this they draw up by the nose.
        position: { method: 'bottom', offset: 0 },
        ...bulk(spec.fins.materialDensity, spec.fins.material),
      },
      {
        type: 'innertube', id: mountId, motorMount: true,
        length: spec.motorMount.length, outerRadius: spec.motorMount.outerRadius, thickness: spec.motorMount.thickness,
        // Motor mount at the tail so the motor loads from the aft. The motor
        // protrudes ~0.25 in (6.35 mm) past the aft end, the usual overhang.
        position: { method: 'bottom', offset: 0 }, motorOverhang: 0.00635,
      },
      // Two centering rings hold the motor mount concentric in the body tube:
      // one at the mount's fore end, one at the aft end. Outer wall = body inner
      // radius, inner bore = mount outer radius.
      {
        type: 'centeringring', id: 'ring-fore',
        outerRadius: spec.bodyTube.outerRadius - spec.bodyTube.thickness, innerRadius: spec.motorMount.outerRadius, length: 0.003,
        position: { method: 'top', offset: Math.max(0, spec.bodyTube.length - spec.motorMount.length) },
      },
      {
        type: 'centeringring', id: 'ring-aft',
        outerRadius: spec.bodyTube.outerRadius - spec.bodyTube.thickness, innerRadius: spec.motorMount.outerRadius, length: 0.003,
        position: { method: 'bottom', offset: 0 },
      },
      ...(spec.parachute
        ? [{ type: 'parachute', id: 'chute', diameter: spec.parachute.diameter, cd: spec.parachute.dragCoefficient ?? 0.8,
            // Deploy at apogee by default (matches the editor default) so the UI
            // and the engine agree rather than the kernel falling back to ejection.
            deployEvent: 'apogee', deployAltitude: 200, deployDelay: 0,
            // Recovery packs up near the nose (front of the body tube).
            position: { method: 'top', offset: 0.02 } } as ComponentNode]
        : []),
    ],
  };
  return {
    tree: { name: defaultDesignName(), components: [{ type: 'stage', name: 'Sustainer', id: 's1', children: [nose, body] }] },
    mountId,
  };
}
