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
import { defaultMaterialPatch } from '../services/design/materialSlots';
import { defaultDesignName } from '../services/app/appInfo';

export type { RocketSpec, StaticInfo, FlightResult } from './openRocketEngine';

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
 * Build a rocket from an editable component tree, with no motors in it.
 *
 * Motors are seated by `services/design/buildRocket.buildConfiguredRocket`, from the
 * flight configuration being flown: one place decides which motor goes in which
 * mount, so the drawing, the static readouts and the flight cannot disagree.
 *
 * resetEngine() frees the previous design's handles, so always rebuild before
 * reading static info / simulating.
 */
export function buildRocketTree(tree: RocketTree): OpenRocketDesign {
  resetEngine();
  return OpenRocketDesign.buildTree(tree);
}

/**
 * The editor's fixed-layout RocketSpec as a component tree (for `.ork` export):
 * stage → nose + body(fins, motor-mount inner tube, parachute). Returns the
 * mount's node id so the caller can attach the motor by id.
 */
export function specToTree(spec: RocketSpec): { tree: RocketTree; mountId: string } {
  const mountId = 'mount';
  /**
   * What a part of this design is made of: the spec's material where it names
   * one, and otherwise the stock material for every slot the type has
   * (`defaultMaterialPatch` with no user preference).
   *
   * Never nothing. `RocketSpec` carries no density at all today, so leaving the
   * fallback out meant every part of the first design anybody opens read "Not
   * specified" in the panel while the kernel flew it as cardboard - the editor
   * disagreeing with the simulation about the same rocket. It is the same three
   * materials either way, so no mass moves; the panel just says which.
   */
  const material = (type: string, m?: { materialDensity?: number; material?: string; materialGroup?: string }) =>
    m?.materialDensity
      ? {
          density: m.materialDensity,
          ...(m.material ? { materialName: m.material } : {}),
          ...(m.materialGroup ? { materialGroup: m.materialGroup } : {}),
        }
      : defaultMaterialPatch(type, {});

  const nose: ComponentNode = {
    type: 'nosecone',
    id: 'nose',
    shape: spec.noseCone.shape ?? 'ogive',
    length: spec.noseCone.length,
    aftRadius: spec.noseCone.aftRadius,
    thickness: spec.noseCone.thickness,
    ...material('nosecone', spec.noseCone),
  };
  const body: ComponentNode = {
    type: 'bodytube',
    id: 'body',
    length: spec.bodyTube.length,
    outerRadius: spec.bodyTube.outerRadius,
    thickness: spec.bodyTube.thickness,
    ...material('bodytube', spec.bodyTube),
    children: [
      {
        type: 'trapezoidfinset',
        id: 'fins',
        finCount: spec.fins.count,
        rootChord: spec.fins.rootChord,
        tipChord: spec.fins.tipChord,
        sweep: spec.fins.sweep,
        height: spec.fins.height,
        thickness: spec.fins.thickness,
        // Fin sets sit at the aft end of the body tube (bottom-aligned), like
        // OpenRocket's default — without this they draw up by the nose.
        position: { method: 'bottom', offset: 0 },
        ...material('trapezoidfinset', spec.fins),
      },
      {
        type: 'innertube',
        id: mountId,
        motorMount: true,
        length: spec.motorMount.length,
        outerRadius: spec.motorMount.outerRadius,
        thickness: spec.motorMount.thickness,
        // Motor mount at the tail so the motor loads from the aft. The motor
        // protrudes ~0.25 in (6.35 mm) past the aft end, the usual overhang.
        position: { method: 'bottom', offset: 0 },
        motorOverhang: 0.00635,
        ...material('innertube'),
      },
      // Two centering rings hold the motor mount concentric in the body tube:
      // one at the mount's fore end, one at the aft end. Outer wall = body inner
      // radius, inner bore = mount outer radius.
      {
        type: 'centeringring',
        id: 'ring-fore',
        outerRadius: spec.bodyTube.outerRadius - spec.bodyTube.thickness,
        innerRadius: spec.motorMount.outerRadius,
        length: 0.003,
        ...material('centeringring'),
        position: { method: 'top', offset: Math.max(0, spec.bodyTube.length - spec.motorMount.length) },
      },
      {
        type: 'centeringring',
        id: 'ring-aft',
        outerRadius: spec.bodyTube.outerRadius - spec.bodyTube.thickness,
        innerRadius: spec.motorMount.outerRadius,
        length: 0.003,
        ...material('centeringring'),
        position: { method: 'bottom', offset: 0 },
      },
      ...(spec.parachute
        ? [
            {
              type: 'parachute',
              id: 'chute',
              diameter: spec.parachute.diameter,
              cd: spec.parachute.dragCoefficient ?? 0.8,
              lineCount: 6,
              lineLength: 0.3,
              // Deploy at apogee by default (matches the editor default) so the UI
              // and the engine agree rather than the kernel falling back to ejection.
              deployEvent: 'apogee',
              deployAltitude: 200,
              deployDelay: 0,
              // Two slots, not one: the canopy is a surface material and the
              // shroud lines are a line material, and both feed the chute's mass.
              ...material('parachute'),
              // Recovery packs up near the nose (front of the body tube).
              position: { method: 'top', offset: 0.02 },
            } as ComponentNode,
          ]
        : []),
    ],
  };
  return {
    tree: {
      name: defaultDesignName(),
      components: [{ type: 'stage', name: 'Sustainer', id: 's1', children: [nose, body] }],
    },
    mountId,
  };
}
