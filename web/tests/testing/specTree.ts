import type { ComponentNode, NoseShape, RocketTree } from '../../src/engine/openRocketEngine';
import { defaultMaterialPatch } from '../../src/services/design/materialSlots';
import { defaultDesignName } from '../../src/services/app/appInfo';

/**
 * A fixed-layout design: nose, body, fins, motor mount and an optional chute,
 * lengths in m. Test fixtures only; the editor builds no designs this way.
 */
export interface RocketSpec {
  noseCone: {
    length: number;
    aftRadius: number;
    thickness: number;
    shape?: NoseShape;
    /** Bulk density kg/m^3; omit for OpenRocket's default material. */
    materialDensity?: number;
    /** Selected material name (display / .ork round-trip only; density drives physics). */
    material?: string;
    /** The material's `.ork` group, as `MaterialGroup.getDatabaseString()` spells
     *  it. Written to the file beside the name, so a design saved here files the
     *  material under the same category the desktop would. */
    materialGroup?: string;
  };
  bodyTube: {
    length: number;
    outerRadius: number;
    thickness: number;
    materialDensity?: number;
    material?: string;
    materialGroup?: string;
  };
  fins: {
    count: number;
    rootChord: number;
    tipChord: number;
    sweep: number;
    height: number;
    thickness: number;
    materialDensity?: number;
    material?: string;
    materialGroup?: string;
  };
  motorMount: {
    length: number;
    outerRadius: number;
    thickness: number;
  };
  parachute?: {
    diameter: number;
    dragCoefficient?: number;
  };
}

/**
 * Test fixture: a fixed-layout `RocketSpec` as a component tree: nose, body, fins,
 * motor mount, two centering rings and an optional chute. The editor builds no
 * `RocketSpec` designs, so this belongs to tests only.
 *
 * Shape: stage, then nose plus body carrying the fins, the motor-mount inner tube
 * and the parachute. Returns the mount's node id so the caller can attach a motor
 * by id.
 */
export function specToTree(spec: RocketSpec): { tree: RocketTree; mountId: string } {
  const mountId = 'mount';
  /**
   * What a part of this design is made of: the spec's material where it names
   * one, and otherwise the stock material for every slot the type has
   * (`defaultMaterialPatch` with no user preference).
   *
   * Never nothing. Without the fallback a part with no density would read "Not
   * specified" in the panel while the kernel flies it on its default material:
   * the editor disagreeing with the simulation about the same rocket.
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
        // OpenRocket's default; without this they draw up by the nose.
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
