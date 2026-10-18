import type { ComponentInfo, ComponentNode, ComponentType, RocketTree } from '../../engine/openRocketEngine';
import { syncAutoRadii } from '../design/autoRadius';
import { resolveDisc } from '../design/discGeometry';
import { COMPONENT_DEFAULTS } from '../design/componentDefaults';
import { DEFAULT_PART_COLORS, type PartPalette } from '../design/partColors';
import { outsideAppearance, type PartAppearance } from '../design/appearance';
import { parseHexColor } from '../design/colorHex';
import { stageFileName } from '../design/orkTree';
import { designSeparation } from '../flight/flightConfigs';
import { axialFrames, type AxialFrame } from '../../tree/axialRebase';
import { assemblyChainLength, assemblyParentRadius, isAssembly, resolveAssemblyRadius } from '../../tree/assembly';
import { clusterPoints } from '../../tree/cluster';
import { isChainType } from '../../tree/componentKinds';
import {
  bodyRadiusAt,
  finMountOf,
  finPlanformPoints,
  finRootChord,
  finSpan,
  mountRadius,
  trapezoidDims,
} from '../../tree/finPlanform';
import {
  FIN_DEFAULTS,
  KERNEL_DEFAULTS,
  KERNEL_MATERIALS,
  defaultSeparation,
  kernelDefault,
} from '../../tree/kernelDefaults';
import { bodyTubeRadius, countOf, finCant, num, numOpt, str } from '../../tree/nodeProps';
import { freeformRootChord, partLength } from '../../tree/position';
import { nodeShape, profileEnds, shapeIsClippable, shapeParamDefault } from '../../tree/shapeProfile';
import { isFinSet, tubeFinRadius } from '../../tree/tubefins';
import { shouldersOf, symmetricSections, type Pt, type Section } from './onshape/meridian';
import type { OrkExportMotor } from './orkTypes';
import { exportFilename, saveBlob } from './saveFile';

/**
 * The JSON the OpenRocket-Onshape custom feature builds a part studio from
 * (github.com/thzero/openrocket-onshape, payload schema 1.2).
 *
 * That project's own web app reads a `.ork` with a parser and approximations
 * of its own. This writes the same payload from the design and the kernel:
 *
 * - automatic sizes are the ones the design resolves (`syncAutoRadii`,
 *   `resolveDisc`, `tubeFinRadius`), each a port of the kernel rule;
 * - nose cone and transition walls are cut as the kernel weighs them
 *   (onshape/meridian.ts), so the part's volume matches the simulated mass;
 * - each part's mass and a packed device's length are the kernel's
 *   (`componentInfo`), and the center of pressure is the kernel's static one,
 *   not a median over a saved flight.
 *
 * Placement is written so the feature cannot misread it. Its `resolveTransform`
 * stacks the airframe by `after` and lays everything else from its parent's
 * front, so a body chain part is `after` and every other part `top`, at the
 * offset its resolved station gives. A pod set or booster is placed `free`,
 * at the distance from its parent's axis the kernel computes. An inner-tube
 * cluster is written as one tube per motor, as the feature has no notion of a
 * cluster.
 *
 * The camera shroud (`fairing`) has no counterpart in the feature and is left
 * out; the caller is told.
 */

const ONSHAPE_SCHEMA_VERSION = '1.2';

export interface OnshapeMaterial {
  name: string;
  type: 'bulk' | 'surface' | 'line';
  density: number;
  shearModulus?: number;
  group: string;
}

export interface OnshapeColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

export interface OnshapePosition {
  axialMethod: 'after' | 'top';
  axialOffset: number;
  position: [number, number, number];
  instanceCount: number;
  instanceSeparation: number;
  angleOffset: number;
  angleMethod: 'relative' | 'fixed';
  radiusOffset: number;
  radiusMethod: 'coaxial' | 'free' | 'surface';
  radialPosition: number;
  radialDirection: number;
}

export interface OnshapeComponent {
  type: ComponentType;
  name: string;
  id: string;
  mass?: number;
  overrideMass?: number;
  overrideCG?: number;
  overrideCD?: number;
  material?: OnshapeMaterial;
  color?: OnshapeColor;
  position: OnshapePosition;
  params: Record<string, unknown>;
  children: OnshapeComponent[];
}

export interface OnshapePayload {
  schemaVersion: string;
  rocket: {
    name: string;
    designer: string;
    revision: string;
    designType: string;
    kitName: string;
    referenceType: string;
    referenceLength: number;
    unitSystem: 'SI';
    components: OnshapeComponent[];
    centerOfPressure?: number;
    motorConfigurationSource?: string;
  };
  warnings: string[];
  warningDetails: never[];
}

export interface OnshapeExportInput {
  name: string;
  tree: RocketTree;
  /** The kernel's figures for each part of `tree`, when it builds. */
  figures?: (id: string) => ComponentInfo | undefined;
  /** The kernel's static center of pressure, meters from the nose tip. */
  cp?: number;
  /** The selected flight configuration's motors, keyed by mount id. */
  motors?: Record<string, OrkExportMotor>;
  /** That configuration's id. */
  configId?: string;
  /** The part colors the design is drawn in. */
  palette?: PartPalette;
}

/** A part left out of the payload: its own name ('' when it has none) and its type. */
export interface SkippedPart {
  name: string;
  type: ComponentType;
}

export interface OnshapeExport {
  payload: OnshapePayload;
  /** Parts the feature cannot build, left out of the payload. */
  skipped: SkippedPart[];
}

/**
 * The name a part goes by when it has none of its own: the desktop's, as the
 * `.ork` writer falls back to, since the feature names each body after it.
 */
const DESKTOP_NAMES: Partial<Record<ComponentType, string>> = {
  nosecone: 'Nose Cone',
  transition: 'Transition',
  bodytube: 'Body Tube',
  trapezoidfinset: 'Trapezoidal Fin Set',
  ellipticalfinset: 'Elliptical Fin Set',
  freeformfinset: 'Freeform Fin Set',
  tubefinset: 'Tube Fin Set',
  innertube: 'Inner Tube',
  tubecoupler: 'Tube Coupler',
  centeringring: 'Centering Ring',
  bulkhead: 'Bulkhead',
  engineblock: 'Engine Block',
  launchlug: 'Launch Lug',
  railbutton: 'Rail Button',
  parachute: 'Parachute',
  streamer: 'Streamer',
  shockcord: 'Shock Cord',
  masscomponent: 'Mass Component',
  podset: 'Pod set',
  parallelstage: 'Booster',
};

/** Parts the feature has no builder for. */
const UNSUPPORTED: ReadonlySet<ComponentType> = new Set(['fairing']);

/** Parts the kernel repeats along the body (`LineInstanceable`). */
const LINE_TYPES: ReadonlySet<string> = new Set(['centeringring', 'bulkhead', 'launchlug', 'railbutton']);

/** Inner parts that carry an off-axis placement (`<radialposition>`). */
const RADIAL_TYPES: ReadonlySet<string> = new Set([
  'innertube',
  'tubecoupler',
  'centeringring',
  'bulkhead',
  'engineblock',
  'parachute',
  'streamer',
  'shockcord',
  'masscomponent',
]);

/** Parts mounted on their parent's outside, measured from its surface. */
const SURFACE_TYPES: ReadonlySet<string> = new Set([
  'trapezoidfinset',
  'ellipticalfinset',
  'freeformfinset',
  'launchlug',
  'railbutton',
]);

interface Ctx {
  tree: RocketTree;
  frames: Map<string, AxialFrame>;
  figures?: (id: string) => ComponentInfo | undefined;
  motors: Record<string, OrkExportMotor>;
  configId: string;
  palette: PartPalette;
  skipped: SkippedPart[];
}

const frameOf = (ctx: Ctx, node: ComponentNode): AxialFrame | undefined =>
  node.id ? ctx.frames.get(node.id) : undefined;

const infoOf = (ctx: Ctx, node: ComponentNode): ComponentInfo | undefined =>
  node.id ? ctx.figures?.(node.id) : undefined;

/** A part's 3D appearance as the feature's 0..1 channels: the paint, and its alpha. */
function colorOf(a: PartAppearance): OnshapeColor | undefined {
  const n = parseHexColor(a.paint);
  if (n === null) return undefined;
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255, alpha: a.alpha / 255 };
}

/** The part's material, as the `.ork` writer names it. */
function materialOf(node: ComponentNode): OnshapeMaterial | undefined {
  switch (node.type) {
    case 'parachute':
    case 'streamer': {
      const density = node['surfaceDensity'];
      if (typeof density === 'number')
        return { name: str(node, 'surfaceMaterialName', 'custom'), type: 'surface', density, group: '' };
      return { ...KERNEL_MATERIALS.surface, type: 'surface' };
    }
    case 'shockcord': {
      const density = node['lineDensity'];
      if (typeof density === 'number')
        return { name: str(node, 'lineMaterialName', 'custom'), type: 'line', density, group: '' };
      return { ...KERNEL_MATERIALS.line, type: 'line' };
    }
    case 'masscomponent':
    case 'stage':
    case 'podset':
    case 'parallelstage':
      return undefined;
    default:
      break;
  }
  if (typeof node.density === 'number' && node.density > 0) {
    const shear = node['shearModulus'];
    return {
      name: str(node, 'materialName', 'custom'),
      type: 'bulk',
      density: node.density,
      ...(typeof shear === 'number' && Number.isFinite(shear) ? { shearModulus: shear } : {}),
      group: str(node, 'materialGroup', ''),
    };
  }
  if (node.type === 'railbutton') {
    const rb = COMPONENT_DEFAULTS.railbutton;
    return { name: rb.materialName, type: 'bulk', density: rb.materialDensity, group: rb.materialGroup };
  }
  return { ...KERNEL_MATERIALS.bulk, type: 'bulk' };
}

/**
 * The roll the feature applies, as `angleOffset` under the `relative` method.
 * A tube fin set flies its roll although the kernel files it under `fixed`
 * (`TubeFinSet.getInstanceAngles` starts from `firstFinOffsetRadians`), and the
 * feature drops the angle of a `fixed` part, so it is written `relative`.
 */
function rollOf(node: ComponentNode): { angleOffset: number; angleMethod: 'relative' | 'fixed' } {
  if (isFinSet(node.type)) return { angleOffset: num(node, 'rotation', 0), angleMethod: 'relative' };
  if (node.type === 'launchlug' || node.type === 'railbutton') {
    return { angleOffset: num(node, 'angleOffset', KERNEL_DEFAULTS[node.type].angleOffset), angleMethod: 'relative' };
  }
  if (isAssembly(node.type)) {
    return {
      angleOffset: num(node, 'angleOffset', 0),
      angleMethod: node['angleMethod'] === 'fixed' ? 'fixed' : 'relative',
    };
  }
  return { angleOffset: 0, angleMethod: 'relative' };
}

function positionOf(ctx: Ctx, node: ComponentNode, parent: ComponentNode): OnshapePosition {
  const chained = isChainType(node.type) && (parent.type === 'stage' || isAssembly(parent.type));
  const own = frameOf(ctx, node);
  const base = frameOf(ctx, parent);
  const offset = chained || !own || !base ? 0 : own.start - base.start;
  const assembly = isAssembly(node.type);
  const instanceCount = assembly
    ? countOf(node, 'instanceCount', KERNEL_DEFAULTS[node.type as 'podset' | 'parallelstage'].instanceCount)
    : LINE_TYPES.has(node.type)
      ? countOf(node, 'instanceCount', 1)
      : 1;
  const radial = RADIAL_TYPES.has(node.type);
  return {
    axialMethod: chained ? 'after' : 'top',
    axialOffset: offset,
    position: [0, 0, 0],
    instanceCount,
    instanceSeparation: num(node, 'instanceSeparation', defaultSeparation(node.type)),
    ...rollOf(node),
    radiusOffset: assembly ? resolveAssemblyRadius(node, assemblyParentRadius(parent)) : 0,
    radiusMethod: assembly ? 'free' : SURFACE_TYPES.has(node.type) ? 'surface' : 'coaxial',
    radialPosition: radial ? num(node, 'radialPosition', 0) : 0,
    radialDirection: radial ? num(node, 'radialDirection', 0) : 0,
  };
}

/**
 * The motor the selected configuration seats in this mount, in the feature's
 * `motorMount` block. A part that is no mount says only that.
 */
function motorMountOf(ctx: Ctx, node: ComponentNode): Record<string, unknown> {
  const motor = node.id ? ctx.motors[node.id] : undefined;
  if (node['motorMount'] !== true && !motor) return { isMotorMount: false };
  return {
    isMotorMount: true,
    motorMount: {
      overhang: num(node, 'motorOverhang', 0),
      designation: motor?.designation ?? '',
      manufacturer: motor?.manufacturer ?? '',
      digest: motor?.digest ?? '',
      diameter: motor?.diameter ?? 0,
      length: motor?.length ?? 0,
      ignitionDelay: motor?.ignitionDelay ?? 0,
      selectedConfigId: motor ? ctx.configId : '',
    },
  };
}

/** A section's points, copied so the payload shares no arrays with the builder. */
const pts = (points: Pt[]): Pt[] => points.map(([r, y]) => [r, y]);
const sectionOut = (s: Section | null) =>
  s && { profile: pts(s.profile), innerProfile: pts(s.innerProfile), innerIsAxis: s.innerIsAxis };

function symmetricParams(node: ComponentNode): Record<string, unknown> {
  const length = partLength(node);
  const { fore, aft } = profileEnds(node);
  const filled = node['filled'] === true;
  const shoulders = shouldersOf(node);
  const sections = symmetricSections(node);
  const flipped = node.type === 'nosecone' && node['flipped'] === true;
  // A nose cone's automatic base travels with the base, to the fore end once flipped.
  const aftAuto = node['aftRadiusAuto'] === true;
  const foreAuto = node.type === 'transition' && node['foreRadiusAuto'] === true;
  const shape = nodeShape(node);
  return {
    shape,
    shapeParameter: num(node, 'shapeParameter', shapeParamDefault(shape)),
    // `Transition.isClipped()`: a nose cone never, a shape that cannot clip never.
    shapeClipped: node.type === 'transition' && shapeIsClippable(shape) && node['clipped'] !== false,
    length,
    foreRadius: fore,
    aftRadius: aft,
    thickness: filled ? -1 : num(node, 'thickness', kernelDefault(node.type, 'thickness') ?? 0),
    filled,
    shoulderFore: shoulders.fore,
    shoulderAft: shoulders.aft,
    flipped,
    baseRadiusAutomatic: flipped ? false : aftAuto,
    foreRadiusAutomatic: flipped ? aftAuto : foreAuto,
    profile: pts(sections.body.profile),
    innerProfile: pts(sections.body.innerProfile),
    innerIsAxis: sections.body.innerIsAxis,
    shoulderProfile: { fore: sectionOut(sections.shoulders.fore), aft: sectionOut(sections.shoulders.aft) },
    totalLength:
      length +
      (sections.shoulders.fore ? shoulders.fore.length : 0) +
      (sections.shoulders.aft ? shoulders.aft.length : 0),
  };
}

function finParams(ctx: Ctx, node: ComponentNode): Record<string, unknown> {
  const tabHeight = num(node, 'tabHeight', 0);
  const tabLength = num(node, 'tabLength', 0);
  const fillet = num(node, 'filletDensity', 0);
  const common = {
    // The same for all three planar sets (ComponentFactory's count(node, "finCount", 3)).
    finCount: countOf(node, 'finCount', KERNEL_DEFAULTS.trapezoidfinset.finCount),
    thickness: num(node, 'thickness', FIN_DEFAULTS.thickness),
    crossSection: str(node, 'crossSection', 'square'),
    cantAngle: finCant(node),
    baseRotation: num(node, 'rotation', 0),
    // The desktop writes a tab only when both its height and length are set,
    // and the feature draws one only then; a half-set tab is no tab.
    tab: {
      height: tabHeight > 0 && tabLength > 0 ? tabHeight : 0,
      length: tabHeight > 0 && tabLength > 0 ? tabLength : 0,
      position: num(node, 'tabOffset', 0),
      positionMethod: str(node, 'tabOffsetMethod', 'middle'),
    },
    filletRadius: num(node, 'filletRadius', 0),
    filletMaterial:
      fillet > 0
        ? {
            name: str(node, 'filletMaterialName', 'custom'),
            type: 'bulk',
            density: fillet,
            group: str(node, 'filletMaterialGroup', ''),
          }
        : { ...KERNEL_MATERIALS.bulk, type: 'bulk' },
    offsetRadius: (node.id ? mountRadius(finMountOf(ctx.tree, node.id)) : null) ?? 0,
  };
  const planform = finPlanformPoints(node) ?? [];
  if (node.type === 'freeformfinset') return { ...common, points: pts(planform), length: freeformRootChord(planform) };
  // The dimensions with the kernel's fallbacks, the ones the planform is drawn from.
  if (node.type === 'ellipticalfinset') {
    return { ...common, rootChord: finRootChord(node), height: finSpan(node), planform: pts(planform) };
  }
  const t = trapezoidDims(node);
  return {
    ...common,
    rootChord: t.root,
    tipChord: t.tip,
    sweepLength: t.sweep,
    height: t.height,
    planform: pts(planform),
  };
}

/** The parent's outer radius under a surface part's front, as it stands on it. */
function surfaceRadius(ctx: Ctx, node: ComponentNode, parent: ComponentNode): number {
  const own = frameOf(ctx, node);
  const base = frameOf(ctx, parent);
  const x = own && base ? own.start - base.start : 0;
  return bodyRadiusAt(parent, x) ?? 0;
}

function paramsOf(ctx: Ctx, node: ComponentNode, parent: ComponentNode): Record<string, unknown> {
  const info = infoOf(ctx, node);
  switch (node.type) {
    case 'nosecone':
    case 'transition':
      return symmetricParams(node);
    case 'bodytube':
      return {
        length: partLength(node),
        outerRadius: bodyTubeRadius(node),
        thickness: num(node, 'thickness', KERNEL_DEFAULTS.bodytube.thickness),
        filled: node['filled'] === true,
        ...motorMountOf(ctx, node),
      };
    case 'trapezoidfinset':
    case 'ellipticalfinset':
    case 'freeformfinset':
      return finParams(ctx, node);
    case 'tubefinset': {
      const body = parent.type === 'bodytube' ? bodyTubeRadius(parent) : 0;
      return {
        finCount: countOf(node, 'finCount', KERNEL_DEFAULTS.tubefinset.finCount),
        length: partLength(node),
        outerRadius: tubeFinRadius(node, body),
        thickness: num(node, 'thickness', 0),
        baseRotation: num(node, 'rotation', 0),
        offsetRadius: body,
        ...(node['outerRadiusAuto'] === true || typeof node['outerRadius'] !== 'number'
          ? { autoOuterRadius: true }
          : {}),
      };
    }
    case 'launchlug': {
      const lug = KERNEL_DEFAULTS.launchlug;
      const outerRadius = num(node, 'outerRadius', lug.outerRadius);
      const thickness = num(node, 'thickness', lug.thickness);
      return {
        outerRadius,
        innerRadius: Math.max(outerRadius - thickness, 0),
        thickness,
        length: partLength(node),
        offsetRadius: surfaceRadius(ctx, node, parent),
      };
    }
    case 'railbutton': {
      const rb = COMPONENT_DEFAULTS.railbutton;
      return {
        outerDiameter: num(node, 'outerDiameter', rb.outerDiameter),
        innerDiameter: num(node, 'innerDiameter', rb.innerDiameter),
        totalHeight: num(node, 'height', rb.height),
        flangeHeight: num(node, 'flangeHeight', rb.flangeHeight),
        baseHeight: num(node, 'baseHeight', rb.baseHeight),
        screwHeight: num(node, 'screwHeight', rb.screwHeight),
        offsetRadius: surfaceRadius(ctx, node, parent),
      };
    }
    case 'innertube': {
      const it = KERNEL_DEFAULTS.innertube;
      const outerRadius = num(node, 'outerRadius', it.outerRadius);
      const thickness = num(node, 'thickness', it.thickness);
      return {
        outerRadius,
        innerRadius: Math.max(outerRadius - thickness, 0),
        thickness,
        length: partLength(node),
        filled: false,
        clusterConfiguration: 'single',
        clusterScale: num(node, 'clusterScale', 1),
        clusterRotation: (num(node, 'clusterRotation', 0) * 180) / Math.PI,
        ...motorMountOf(ctx, node),
      };
    }
    case 'tubecoupler':
    case 'centeringring':
    case 'bulkhead':
    case 'engineblock': {
      const disc = node.id ? resolveDisc(ctx.tree, node.id) : null;
      const outerRadius = disc?.outerR ?? 0;
      const innerRadius = node.type === 'bulkhead' ? 0 : (disc?.innerR ?? 0);
      return {
        outerRadius,
        innerRadius,
        ...(node['outerRadiusAuto'] === true ? { autoOuterRadius: true } : {}),
        ...(node['innerRadiusAuto'] === true ? { autoInnerRadius: true } : {}),
        thickness: Math.max(outerRadius - innerRadius, 0),
        length: disc?.length ?? partLength(node),
        filled: false,
        clusterConfiguration: 'single',
        clusterScale: 1,
        clusterRotation: 0,
        isMotorMount: false,
      };
    }
    case 'parachute':
    case 'streamer':
    case 'shockcord':
    case 'masscomponent': {
      // The kernel settles a packed device's length with its radius
      // (`MassObject.getRadius`), so its own length is the one to build.
      const defaults = KERNEL_DEFAULTS[node.type];
      const out: Record<string, unknown> = {
        packedLength: info?.length ?? num(node, 'length', defaults.length),
        packedRadius: num(node, 'radius', defaults.radius),
        material: materialOf(node),
      };
      if (node.type === 'parachute') out['diameter'] = num(node, 'diameter', KERNEL_DEFAULTS.parachute.diameter);
      if (node.type === 'streamer') {
        out['stripLength'] = num(node, 'stripLength', KERNEL_DEFAULTS.streamer.stripLength);
        out['stripWidth'] = num(node, 'stripWidth', KERNEL_DEFAULTS.streamer.stripWidth);
      }
      if (node.type === 'shockcord')
        out['cordLength'] = info?.cordLength ?? num(node, 'cordLength', KERNEL_DEFAULTS.shockcord.cordLength);
      if (node.type === 'masscomponent') out['mass'] = num(node, 'mass', KERNEL_DEFAULTS.masscomponent.mass);
      return out;
    }
    case 'podset':
      return { length: assemblyChainLength(node) };
    case 'parallelstage': {
      const sep = designSeparation(node);
      return {
        length: assemblyChainLength(node),
        separation: { event: sep.separationEvent, altitude: sep.separationAltitude, delay: sep.separationDelay },
      };
    }
    default:
      return {};
  }
}

function componentOf(ctx: Ctx, node: ComponentNode, parent: ComponentNode): OnshapeComponent[] {
  if (UNSUPPORTED.has(node.type)) {
    ctx.skipped.push({ name: node.name ?? '', type: node.type });
    return [];
  }
  const info = infoOf(ctx, node);
  const override = (key: string): number | undefined => numOpt(node, key);
  const overrideMass = override('overrideMass');
  const overrideCG = override('overrideCGX');
  const overrideCD = override('overrideCD');
  const params = paramsOf(ctx, node, parent);
  const material = PACKED_TYPES.has(node.type) ? packedMaterial(node, info, params) : materialOf(node);
  const color = colorOf(outsideAppearance(node, ctx.palette));
  const out: OnshapeComponent = {
    type: node.type,
    name: node.name ?? DESKTOP_NAMES[node.type] ?? node.type,
    id: node.id ?? '',
    ...(info ? { mass: info.mass } : {}),
    ...(overrideMass !== undefined ? { overrideMass } : {}),
    ...(overrideCG !== undefined ? { overrideCG } : {}),
    ...(overrideCD !== undefined ? { overrideCD } : {}),
    ...(material ? { material } : {}),
    ...(color ? { color } : {}),
    position: positionOf(ctx, node, parent),
    params,
    children: (node.children ?? []).flatMap((c) => componentOf(ctx, c, node)),
  };
  return node.type === 'innertube' ? splitCluster(node, out) : [out];
}

/** Parts the feature builds as a solid packed cylinder. */
const PACKED_TYPES: ReadonlySet<string> = new Set(['parachute', 'streamer', 'shockcord', 'masscomponent']);

/**
 * The material the feature weighs a packed part by. It reads every material's
 * density as bulk density and builds a recovery device or mass component as a
 * solid cylinder of its packed size, so the device's own surface or line
 * material would weigh a parachute at almost nothing. The density written is
 * the one that makes that cylinder weigh what the kernel flies; the device's
 * real material stays in `params.material`. Absent without the kernel's mass.
 */
function packedMaterial(
  node: ComponentNode,
  info: ComponentInfo | undefined,
  params: Record<string, unknown>,
): OnshapeMaterial | undefined {
  const length = params['packedLength'] as number;
  const radius = params['packedRadius'] as number;
  const volume = Math.PI * radius * radius * length;
  if (!info || !(volume > 0)) return undefined;
  const name = materialOf(node)?.name ?? DESKTOP_NAMES[node.type] ?? node.type;
  return { name, type: 'bulk', density: info.mass / volume, group: '' };
}

/**
 * One inner tube per motor of a cluster, each at the place the kernel puts it
 * (`InnerTube.getInstanceOffsets`, mirrored by `clusterPoints`). A single tube
 * passes through.
 */
function splitCluster(node: ComponentNode, tube: OnshapeComponent): OnshapeComponent[] {
  const cluster = str(node, 'cluster', 'single');
  const outerRadius = tube.params['outerRadius'] as number;
  const places = clusterPoints(
    cluster,
    outerRadius,
    num(node, 'clusterScale', 1),
    num(node, 'clusterRotation', 0),
    num(node, 'radialPosition', 0),
    num(node, 'radialDirection', 0),
  );
  if (places.length <= 1) return [tube];
  const clone = (c: OnshapeComponent, tag: string): OnshapeComponent => ({
    ...c,
    id: `${c.id || c.type}-${tag}`,
    position: { ...c.position },
    params: { ...c.params },
    children: c.children.map((k, i) => clone(k, `${tag}.${i}`)),
  });
  return places.map((place, i) => {
    const copy = clone(tube, `cluster${i + 1}`);
    copy.name = `${tube.name} (${i + 1}/${places.length})`;
    copy.position.radialPosition = place.radialPosition;
    copy.position.radialDirection = place.radialDirection;
    return copy;
  });
}

function stageOf(ctx: Ctx, stage: ComponentNode, i: number): OnshapeComponent {
  const length = (stage.children ?? []).reduce((s, c) => s + (isChainType(c.type) ? partLength(c) : 0), 0);
  const sep = designSeparation(stage);
  return {
    type: 'stage',
    name: stageFileName(stage, i),
    id: stage.id ?? '',
    position: {
      axialMethod: 'after',
      axialOffset: 0,
      position: [0, 0, 0],
      instanceCount: 1,
      instanceSeparation: 0,
      angleOffset: 0,
      angleMethod: 'relative',
      radiusOffset: 0,
      radiusMethod: 'coaxial',
      radialPosition: 0,
      radialDirection: 0,
    },
    params: {
      length,
      ...(i > 0
        ? { separation: { event: sep.separationEvent, altitude: sep.separationAltitude, delay: sep.separationDelay } }
        : {}),
    },
    children: (stage.children ?? []).flatMap((c) => componentOf(ctx, c, stage)),
  };
}

/** The feature's payload for the design. */
export function exportOnshape(input: OnshapeExportInput): OnshapeExport {
  const tree = syncAutoRadii(input.tree);
  const ctx: Ctx = {
    tree,
    frames: axialFrames(tree),
    figures: input.figures,
    motors: input.motors ?? {},
    configId: input.configId ?? '',
    palette: input.palette ?? DEFAULT_PART_COLORS,
    skipped: [],
  };
  const stages = tree.components.filter((n) => n.type === 'stage');
  const payload: OnshapePayload = {
    schemaVersion: ONSHAPE_SCHEMA_VERSION,
    rocket: {
      name: input.name,
      designer: tree.designer ?? '',
      revision: tree.revision ?? '',
      designType: tree.designType ?? 'original',
      kitName: tree.kitName ?? '',
      referenceType: tree.referenceType ?? 'maximum',
      referenceLength: tree.customReference ?? 0,
      unitSystem: 'SI',
      components: stages.map((s, i) => stageOf(ctx, s, i)),
      ...(input.cp !== undefined && Number.isFinite(input.cp) ? { centerOfPressure: input.cp } : {}),
      ...(input.configId ? { motorConfigurationSource: input.configId } : {}),
    },
    warnings: [],
    warningDetails: [],
  };
  return { payload, skipped: ctx.skipped };
}

/** Write the payload as a `.json` file the user downloads. */
export async function downloadOnshapeJson(input: OnshapeExportInput): Promise<OnshapeExport> {
  const result = exportOnshape(input);
  const blob = new Blob([JSON.stringify(result.payload, null, 2)], { type: 'application/json' });
  await saveBlob(blob, exportFilename([input.name, 'design'], 'json'));
  return result;
}
