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

export type { RocketSpec, StaticInfo, FlightResult } from './openRocketEngine';

/** A stock Estes C6 (SI units): times→thrust, per-sample motor mass. */
export const C6: MotorSpec = {
  designation: 'C6',
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
        ...bulk(spec.fins.materialDensity, spec.fins.material),
      },
      {
        type: 'innertube', id: mountId, motorMount: true,
        length: spec.motorMount.length, outerRadius: spec.motorMount.outerRadius, thickness: spec.motorMount.thickness,
      },
      ...(spec.parachute
        ? [{ type: 'parachute', id: 'chute', diameter: spec.parachute.diameter, cd: spec.parachute.dragCoefficient ?? 0.8 } as ComponentNode]
        : []),
    ],
  };
  return {
    tree: { name: 'FakeRocket design', components: [{ type: 'stage', name: 'Sustainer', id: 's1', children: [nose, body] }] },
    mountId,
  };
}
