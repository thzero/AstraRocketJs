import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { defaultDesignName } from '../app/appInfo';
import { defaultMaterialPatch } from './materialSlots';
import { presetLink } from './treeEdit';

/**
 * The design the app opens with: a classic Estes-class sport model, built out of
 * PARTS THAT EXIST.
 *
 * Every tube, cone, ring and canopy below is a row of the shipped component
 * catalog (`public/data/components.generated.json`, synced from upstream's
 * preset database), named by its Estes part number, and each carries the same
 * `preset` link the component picker writes. So the property panel says which
 * catalog part a component is, exactly as it would had you picked it yourself,
 * and a reader who wants to build this rocket can order it.
 *
 * WHY THAT MATTERS BEYOND THE LABEL: a preset states the part's own material and
 * density, and the numbers are not the kernel's generic ones. Estes spiral kraft
 * glassine is 894.4 kg/m3 against the stock cardboard's 680, which is a third of
 * the airframe's mass, and the airframe is the heaviest structural part of a
 * model this size. The mass, the CG and so the stability margin all move with it.
 *
 * {@link DEFAULT_PRESETS} is the list, and `defaultRocketParts.test.ts` holds
 * every row in it against the catalog on disk, so a sync that renames a part,
 * re-weighs a material or drops a part number fails rather than quietly opening
 * a rocket made of something else.
 *
 * WHAT IS NOT A PRESET, and why each one is still here:
 *
 *  - the **fin set**, because the catalog has no fin presets at all: a kit's fins
 *    are die-cut balsa sheet, so they take the material catalog's own Balsa and
 *    the kit-typical 3/32 in sheet thickness.
 *  - the **engine block**, the **shock cord**, the **wadding** and the **launch
 *    lug**, none of which the preset database carries. They are the four parts a
 *    kit of this class has that the design would otherwise be missing, and
 *    leaving them out is not neutral: the block is what the motor pushes
 *    against, the cord is what the nose comes back on, and the lug is the only
 *    thing that lets this rocket fly off a rod at all.
 */

/** One catalog row, as much of it as building a node needs. */
export interface PresetRow {
  /** The catalog's own `partNo`, which is how the test finds the row. */
  partNo: string;
  /** Catalog row type, which is what the picker records in `preset.type`. */
  type: 'nosecone' | 'bodytube' | 'centeringring' | 'parachute';
  /**
   * OpenRocket's own checksum for this part (`ComponentPreset.computeDigest`),
   * computed from the `.orc` row by `scripts/preset-digest.mjs` and verified
   * against digests in real OpenRocket files. Without it the desktop rejects the
   * link outright, so a row with no digest is written to the file without one.
   */
  digest?: string;
  outerDiameter?: number;
  innerDiameter?: number;
  length?: number;
  diameter?: number;
  materialDensity?: number;
  material?: string;
}

/**
 * The catalog rows this design is built from.
 *
 * An 18 in BT-50 airframe on an 18 mm motor, which is the commonest sport-model
 * layout there is, and every part sized for it out of the same manufacturer's
 * range so the fits are real: the cone's shoulder and the rings' outer diameter
 * are the tube's INNER diameter, and the rings' bore is the motor tube's outer.
 */
export const DEFAULT_PRESETS = {
  /**
   * Plastic ogive cone, 2.75 in.
   *
   * This row rather than its better-known sibling PNC-50K because its diameter is
   * the BT-50's EXACTLY. PNC-50K is catalogued 0.05 mm narrower, which real parts
   * are, and the kernel reads any base-to-tube step as a DISCONTINUITY: the first
   * design anybody opens would come with a warning on it.
   *
   * The catalog states no wall thickness for a plastic cone: see NOSE_WALL.
   */
  nose: {
    partNo: 'PNC-50KA',
    type: 'nosecone',
    digest: 'b3b5899ebbb48c4ec80bae00d72280a9',
    outerDiameter: 0.024790399999999997,
    length: 0.06985,
    materialDensity: 1050,
    material: 'Polystyrene, cast, bulk',
  },
  /** The airframe: 18 in of BT-50, the length Estes sells tube stock in. */
  body: {
    partNo: 'BT-50, 30352',
    type: 'bodytube',
    digest: 'a59dec8e4034a2fee5955dbf4ff07f1c',
    outerDiameter: 0.024790399999999997,
    innerDiameter: 0.02413,
    length: 0.4572,
    materialDensity: 894.4,
    material: 'Paper, spiral kraft glassine, Estes avg, bulk',
  },
  /** 2.75 in of BT-20: the standard 18 mm motor mount. */
  mount: {
    partNo: 'BT-20J, 30326, 30332, 30408',
    type: 'bodytube',
    digest: '0f9c942f46291e7b4de035cd1a4cba6b',
    outerDiameter: 0.0186944,
    innerDiameter: 0.018033999999999998,
    length: 0.06985,
    materialDensity: 894.4,
    material: 'Paper, spiral kraft glassine, Estes avg, bulk',
  },
  /** Fiber ring, BT-20 to BT-50. Two of them hold the mount concentric. */
  ring: {
    partNo: 'AR-2050, 3101, 30164',
    digest: '18188426cd6313e89068ace99433a94c',
    type: 'centeringring',
    outerDiameter: 0.0240792,
    innerDiameter: 0.0187452,
    length: 0.00635,
    materialDensity: 657,
    material: 'Fiber, bulk',
  },
  /** 12 in plastic canopy, which is what a BT-50 model of this mass comes down on. */
  chute: {
    partNo: 'PK-12, 2263',
    type: 'parachute',
    digest: 'e38b3873b4c5e66b9f07aaa094cb1ff8',
    diameter: 0.30479999999999996,
  },
} as const satisfies Record<string, PresetRow>;

/**
 * The nose cone's wall, which the catalog row does NOT state.
 *
 * Its `filled` flag is false and it publishes no inner diameter, so the picker
 * applies no thickness either and the node keeps whatever it had. 1.3 mm is a
 * typical injection-molded cone of this size, and it is OUR number rather than
 * Estes'; it is the only dimension in this design that is.
 */
const NOSE_WALL = 0.0013;

/**
 * The shoulder that plugs the cone into the tube.
 *
 * Also not in the catalog row, and not optional either: without it the cone is a
 * shape balanced on the end of a tube, and the app's own nose-cone editor has a
 * shoulder section that would read as empty on the first design anybody opens.
 * 19 mm is the usual 3/4 in engagement. Left UNCAPPED because a molded cone is
 * open at its base; capping it would add a disc the real part does not have.
 */
const SHOULDER_LENGTH = 0.019;

/**
 * The fin set: the app's own swept planform, scaled to this airframe.
 *
 * The SHAPE is the one this design has always had, and it is the one part of the
 * rocket that is a look rather than a part number, because the catalog carries no
 * fin presets at all. Sweep longer than the span is what makes the silhouette.
 *
 * The SIZE is that shape at 0.7, which is why the four dimensions are written as
 * ratios of the root rather than as four numbers: a fin edited one dimension at a
 * time stops being the same shape, and this one has to stay it. At full size the
 * span was 2.3 body diameters, which is a competition-class fin on a sport model
 * and 5.6 g of balsa at the very tail; at 0.7 it is 1.6 diameters and 2.1 g, and
 * the rocket flies 54 m higher on the same motor.
 *
 * 3/32 in sheet, which is what a fin this size is cut from: 2.38125 mm, the
 * exact conversion rather than a rounded 2.4, because balsa is sold by the
 * fraction and the sheet is that thickness.
 */
const PLANFORM = { root: 0.08, tip: 0.038, sweep: 0.055, span: 0.058 } as const;
const FIN_SCALE = 0.7;

const FIN = {
  rootChord: PLANFORM.root * FIN_SCALE,
  tipChord: PLANFORM.tip * FIN_SCALE,
  sweep: PLANFORM.sweep * FIN_SCALE,
  height: PLANFORM.span * FIN_SCALE,
  thickness: 0.00238125,
  /** The material catalog's own Balsa (`materials.generated.json`), not a preset. */
  materialName: 'Balsa',
  materialDensity: 170,
  materialGroup: 'Woods',
} as const;

/** Estes recovery wadding, a few squares of it. */
const WADDING_MASS = 0.002;

/** How far below the tube's fore end the recovery pack sits, in order. */
const PACK = { chute: 0.03, cord: 0.1, wadding: 0.155 };

/**
 * A single 1/8 in launch lug, alongside the fin root.
 *
 * Measured from the TAIL (a negative offset is forward of it), because that is
 * what the position means on this part: a kit glues the lug between two fins, low
 * down, not up the airframe. Where it sits is not only cosmetic - the guided
 * phase ends when the aft-most guide leaves the rod, so a lug further forward is
 * guided travel the rocket does not get (Settings, Simulation, guide-aware rod
 * clearance).
 */
const LUG = { length: 0.0349, outerRadius: 0.002, thickness: 0.00025, aftOffset: -0.02 };

/** The geometry, material and preset link a catalog row gives a node, exactly as
 *  `catalogPatch` + `presetRef` write them when the part is picked by hand. */
function fromPreset(row: PresetRow): Record<string, unknown> {
  const link = { preset: presetLink(row.type, 'Estes', row.partNo, row.digest) };
  const mat = row.materialDensity ? { density: row.materialDensity, materialName: row.material } : {};
  return { ...link, ...mat };
}

/** A tube (airframe or motor mount) from its row: the wall is OD and ID together. */
function tube(row: PresetRow): Record<string, unknown> {
  return {
    ...fromPreset(row),
    length: row.length,
    outerRadius: row.outerDiameter! / 2,
    thickness: (row.outerDiameter! - row.innerDiameter!) / 2,
    // Pinned, like the picker pins them: an automatic radius would be resolved
    // back over the part on the next pass (see pinStated).
    outerRadiusAuto: false,
  };
}

/** One centering ring, positioned by the caller. */
function ring(id: string, position: { method: string; offset: number }): ComponentNode {
  const row = DEFAULT_PRESETS.ring;
  return {
    type: 'centeringring',
    id,
    ...fromPreset(row),
    length: row.length,
    outerRadius: row.outerDiameter / 2,
    innerRadius: row.innerDiameter / 2,
    outerRadiusAuto: false,
    innerRadiusAuto: false,
    position,
  } as unknown as ComponentNode;
}

/**
 * The default design as a component tree.
 *
 * Built fresh on every call: the caller owns the tree it gets, and the store
 * mutates the one it holds.
 */
export function defaultRocketTree(): RocketTree {
  const { nose, body, mount, chute } = DEFAULT_PRESETS;

  const noseNode: ComponentNode = {
    type: 'nosecone',
    id: 'nose',
    shape: 'ogive',
    ...fromPreset(nose),
    length: nose.length,
    aftRadius: nose.outerDiameter / 2,
    aftRadiusAuto: false,
    thickness: NOSE_WALL,
    shoulderLength: SHOULDER_LENGTH,
    // The tube's BORE, which is what the shoulder has to fit.
    shoulderRadius: body.innerDiameter / 2,
    shoulderThickness: NOSE_WALL,
  } as unknown as ComponentNode;

  const bodyNode: ComponentNode = {
    type: 'bodytube',
    id: 'body',
    ...tube(body),
    children: [
      {
        type: 'trapezoidfinset',
        id: 'fins',
        finCount: 3,
        rootChord: FIN.rootChord,
        tipChord: FIN.tipChord,
        sweep: FIN.sweep,
        height: FIN.height,
        thickness: FIN.thickness,
        density: FIN.materialDensity,
        materialName: FIN.materialName,
        materialGroup: FIN.materialGroup,
        // Aft end of the tube, like OpenRocket's own default.
        position: { method: 'bottom', offset: 0 },
      },
      {
        type: 'innertube',
        id: 'mount',
        motorMount: true,
        ...tube(mount),
        // At the tail, so the motor loads from the aft end, protruding the usual
        // 1/4 in.
        position: { method: 'bottom', offset: 0 },
        motorOverhang: 0.00635,
        children: [
          {
            // What the motor pushes against. No preset carries one, and its bore
            // is the mount's, so the motor cannot pass it.
            type: 'engineblock',
            id: 'block',
            length: 0.005,
            outerRadius: mount.innerDiameter / 2,
            outerRadiusAuto: false,
            thickness: 0.003,
            ...defaultMaterialPatch('engineblock', {}),
            position: { method: 'top', offset: 0 },
          },
        ],
      },
      ring('ring-fore', { method: 'top', offset: body.length - mount.length }),
      ring('ring-aft', { method: 'bottom', offset: 0 }),
      {
        type: 'parachute',
        id: 'chute',
        ...fromPreset(chute),
        diameter: chute.diameter,
        // The row states no Cd, which is the catalog's usual answer for a
        // canopy; 0.8 is the kernel's own figure for a flat sheet chute.
        cd: 0.8,
        lineCount: 6,
        lineLength: 0.3,
        // At apogee, which is what the editor defaults to, so the panel and the
        // engine agree rather than the kernel falling back to ejection.
        deployEvent: 'apogee',
        deployAltitude: 200,
        deployDelay: 0,
        // Two slots: the canopy is a surface material and the shroud lines a
        // line material, and both feed the chute's mass.
        ...defaultMaterialPatch('parachute', {}),
        position: { method: 'top', offset: PACK.chute },
      },
      {
        // What the nose comes back on. Its own mass is all it contributes: the
        // kernel models a cord as a mass at a place, not as a tether.
        type: 'shockcord',
        id: 'cord',
        cordLength: 0.45,
        length: 0.05,
        radius: 0.006,
        ...defaultMaterialPatch('shockcord', {}),
        position: { method: 'top', offset: PACK.cord },
      },
      {
        // Below the canopy, between it and the motor, which is where it goes.
        type: 'masscomponent',
        id: 'wadding',
        mass: WADDING_MASS,
        length: 0.03,
        radius: body.innerDiameter / 2,
        massComponentType: 'masscomponent',
        position: { method: 'top', offset: PACK.wadding },
      },
      {
        type: 'launchlug',
        id: 'lug',
        length: LUG.length,
        outerRadius: LUG.outerRadius,
        thickness: LUG.thickness,
        ...defaultMaterialPatch('launchlug', {}),
        position: { method: 'bottom', offset: LUG.aftOffset },
      },
    ],
  } as unknown as ComponentNode;

  return {
    name: defaultDesignName(),
    components: [{ type: 'stage', name: 'Sustainer', id: 's1', children: [noseNode, bodyNode] }],
  } as unknown as RocketTree;
}
