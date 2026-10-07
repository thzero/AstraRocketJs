import type { ComponentNode, RocketSpec, RocketTree } from '../../src/engine/openRocketEngine';
import { defaultMaterialPatch } from '../../src/services/design/materialSlots';
import { defaultDesignName } from '../../src/services/app/appInfo';

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
