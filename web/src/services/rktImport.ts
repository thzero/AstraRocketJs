import type { ComponentNode, ComponentType } from '../engine/openRocketEngine';
import { freshId } from './orkTree';
import { xmlText as text } from './xmlUtil';
import { parseOrkXml } from './ork/importUnpack';
import { clampCount, finiteNum } from './ork/numbers';
import { MAX_FIN_POINTS, MAX_LINE_COUNT, MAX_NESTING_DEPTH } from './ork/importLimits';
import type { OrkImportResult } from './orkTypes';

/**
 * RockSim (`.rkt`) IMPORT.
 *
 * A TypeScript port of OpenRocket's `file/rocksim/importt/` handlers, not an
 * extraction of them. That package is SAX-based and pulls in the document,
 * appearance and warning machinery the desktop is built on; the schema it
 * encodes is small enough to read directly, and reading it here keeps the
 * importer on the same side of the engine boundary as `orkImport` — plain
 * DOM, unit-testable, no kernel round trip.
 *
 * The element vocabulary, the unit factors and every enum below are taken from
 * `RockSimCommonConstants.java` and its four enums, so a future OpenRocket bump
 * can be diffed against those files.
 *
 * WHAT ROCKSIM MEASURES IN. Everything is millimeters and grams, and every
 * circular dimension is a DIAMETER where OpenRocket wants a radius — hence the
 * three divisors below. Getting one of those wrong produces a design that is
 * silently 1000x or 2x off rather than one that fails to load, which is why
 * they are named constants used everywhere rather than inline literals.
 */

/** mm → m. `RockSimCommonConstants.ROCKSIM_TO_OPENROCKET_LENGTH`. */
const LENGTH = 1000;
/** diameter in mm → radius in m. `…_TO_OPENROCKET_RADIUS` (2 × length). */
const RADIUS = 2000;
/** g → kg. `…_TO_OPENROCKET_MASS`. */
const MASS = 1000;
/** RockSim surface density is g/cm²; OpenRocket's is kg/m². */
const SURFACE_DENSITY = 1 / 10;

/** `RockSimNoseConeCode`. RockSim's PARABOLIC (2) really is OpenRocket's ELLIPSOID. */
const SHAPES = ['conical', 'ogive', 'ellipsoid', 'ellipsoid', 'power', 'parabolic', 'haack'] as const;

/** `RockSimFinishCode`, in its own ordinal order. */
const FINISHES = ['polished', 'smooth', 'normal', 'unfinished'] as const;

/** `RockSimLocationMode`: 0 front of parent, 1 from the nose tip, 2 back of parent. */
const LOCATION_METHODS = ['top', 'absolute', 'bottom'] as const;

/** `RockSimDensityType`: bulk, surface (g/cm²), line. */
const DENSITY_FACTORS = [1, SURFACE_DENSITY, 1];

interface RktContext {
  notes: string[];
  ignored: Set<string>;
  /** Tags we understand but deliberately do not carry, named once each. */
  dropped: Set<string>;
}

// ---------------------------------------------------------------- readers ---

/** A child element's trimmed text, by RockSim tag name (case-sensitive). */
const tag = (el: Element, name: string): string | null => text(el, `:scope > ${name}`);

/** A child element's number, or `undefined` when absent or not finite. */
const num = (el: Element, name: string): number | undefined => finiteNum(tag(el, name));

/** A length in mm → m. */
const mm = (el: Element, name: string): number | undefined => {
  const v = num(el, name);
  return v === undefined ? undefined : v / LENGTH;
};

/** A diameter in mm → a radius in m. */
const dia = (el: Element, name: string): number | undefined => {
  const v = num(el, name);
  return v === undefined ? undefined : v / RADIUS;
};

/** Assign only a defined value, so an absent element leaves the app's default. */
const put = (n: ComponentNode, key: string, v: number | string | undefined): void => {
  if (v !== undefined) n[key] = v;
};

/**
 * What every RockSim part carries: name, material, finish, the mass/CG
 * override pair and its axial placement.
 *
 * RockSim's override is ONE switch (`UseKnownCG`) over both mass and CG, and it
 * has no equivalent of OpenRocket's "apply to subcomponents" — `BaseHandler`
 * explicitly clears those two flags. So a `.rkt` can only ever produce a
 * self-only override, and that is what is written here.
 */
function readCommon(el: Element, n: ComponentNode, withPosition: boolean): void {
  const name = tag(el, 'Name');
  if (name) n.name = name;

  const density = num(el, 'Density');
  if (density !== undefined && density > 0) {
    const type = clampCount(num(el, 'DensityType') ?? 0, 0, 2);
    n.density = density * DENSITY_FACTORS[type]!;
  }
  const material = tag(el, 'Material');
  if (material) n['materialName'] = material;

  const finish = num(el, 'FinishCode');
  if (finish !== undefined) {
    const f = FINISHES[clampCount(finish, 0, FINISHES.length - 1)]!;
    if (f !== 'normal') n['finish'] = f;
  }

  // `UseKnownCG` is RockSim's "I measured this part" switch. Both figures ride
  // along in the file whether or not it is set, so applying them unconditionally
  // would override every part in the design with RockSim's own computed values.
  if (tag(el, 'UseKnownCG') === '1') {
    const knownMass = num(el, 'KnownMass');
    const knownCg = mm(el, 'KnownCG');
    if (knownMass !== undefined) n['overrideMass'] = Math.max(0, knownMass / MASS);
    if (knownCg !== undefined) n['overrideCGX'] = Math.max(0, knownCg);
  }

  const color = tag(el, 'Color');
  if (color) n['color'] = color;

  if (withPosition) {
    const offset = mm(el, 'Xb');
    if (offset !== undefined) {
      const method = LOCATION_METHODS[clampCount(num(el, 'LocationMode') ?? 0, 0, 2)]!;
      // Only BOTTOM flips sign, exactly as `PositionDependentHandler.setLocation`
      // does: RockSim measures back-of-parent offsets in the other direction.
      n.position = { method, offset: method === 'bottom' ? -offset : offset };
    }
  }
}

const base = (el: Element, type: ComponentType, withPosition: boolean): ComponentNode => {
  const n: ComponentNode = { type, id: freshId() };
  readCommon(el, n, withPosition);
  return n;
};

/** `ConstructionType` 0 = solid, 1 = hollow. Matches the nose/transition handlers. */
const readWall = (el: Element, n: ComponentNode): void => {
  if (num(el, 'ConstructionType') === 0) {
    n['filled'] = true;
    return;
  }
  put(n, 'thickness', mm(el, 'WallThickness'));
};

const readShape = (el: Element, n: ComponentNode): void => {
  const code = num(el, 'ShapeCode');
  n['shape'] = SHAPES[clampCount(code ?? 1, 0, SHAPES.length - 1)]!;
  put(n, 'shapeParameter', num(el, 'ShapeParameter'));
};

/** A tube that is a motor mount: the flag plus RockSim's engine overhang. */
const readMount = (el: Element, n: ComponentNode): void => {
  if (tag(el, 'IsMotorMount') !== '1') return;
  n['motorMount'] = true;
  const overhang = mm(el, 'EngineOverhang');
  if (overhang !== undefined && overhang !== 0) n['motorOverhang'] = overhang;
};

const readNoseCone = (el: Element): ComponentNode => {
  const n = base(el, 'nosecone', false);
  put(n, 'length', mm(el, 'Len'));
  put(n, 'aftRadius', dia(el, 'BaseDia'));
  readWall(el, n);
  readShape(el, n);
  put(n, 'shoulderRadius', dia(el, 'ShoulderOD'));
  put(n, 'shoulderLength', mm(el, 'ShoulderLen'));
  return n;
};

const readTransition = (el: Element): ComponentNode => {
  const n = base(el, 'transition', true);
  put(n, 'length', mm(el, 'Len'));
  put(n, 'foreRadius', dia(el, 'FrontDia'));
  put(n, 'aftRadius', dia(el, 'RearDia'));
  readWall(el, n);
  readShape(el, n);
  put(n, 'foreShoulderRadius', dia(el, 'FrontShoulderDia'));
  put(n, 'foreShoulderLength', mm(el, 'FrontShoulderLen'));
  put(n, 'aftShoulderRadius', dia(el, 'RearShoulderDia'));
  put(n, 'aftShoulderLength', mm(el, 'RearShoulderLen'));
  return n;
};

/**
 * A `BodyTube` is an airframe tube or an INNER tube depending on `IsInsideTube`
 * — RockSim uses one element for both, and `AttachedPartsHandler` picks the
 * OpenRocket type from that flag.
 */
const readBodyTube = (el: Element): ComponentNode => {
  const inner = tag(el, 'IsInsideTube') === '1';
  const n = base(el, inner ? 'innertube' : 'bodytube', inner);
  put(n, 'length', mm(el, 'Len'));
  const od = dia(el, 'OD');
  const id = dia(el, 'ID');
  put(n, 'outerRadius', od);
  // RockSim states both radii; OpenRocket wants a wall. A zero/absent ID is a
  // solid rod in RockSim, which is not a tube we can build — fall through to
  // the app's own default wall rather than a zero-thickness one.
  if (od !== undefined && id !== undefined && id > 0 && od > id) n['thickness'] = od - id;
  readMount(el, n);
  if (inner) {
    put(n, 'radialPosition', mm(el, 'RadialLoc'));
    const angle = num(el, 'RadialAngle');
    if (angle) n['radialDirection'] = (angle * Math.PI) / 180;
  }
  return n;
};

/** `RingHandler.endHandler`'s `UsageCode` → the four OpenRocket ring types. */
const RING_TYPES: Record<number, ComponentType> = {
  0: 'centeringring',
  1: 'bulkhead',
  2: 'engineblock',
  3: 'tubecoupler', // "Sleeve" — a coupler on the outside; nearest we have
  4: 'tubecoupler',
};

const readRing = (el: Element): ComponentNode => {
  const usage = clampCount(num(el, 'UsageCode') ?? 0, 0, 4);
  const n = base(el, RING_TYPES[usage] ?? 'centeringring', true);
  put(n, 'length', mm(el, 'Len'));
  const od = dia(el, 'OD');
  const id = dia(el, 'ID');
  put(n, 'outerRadius', od);
  // A bulkhead is solid and carries no inner radius in our tree; the others do.
  if (n.type === 'centeringring') put(n, 'innerRadius', id);
  if ((n.type === 'tubecoupler' || n.type === 'engineblock') && od !== undefined && id !== undefined && od > id) {
    n['thickness'] = od - id;
  }
  return n;
};

const readLaunchLug = (el: Element): ComponentNode => {
  const n = base(el, 'launchlug', true);
  put(n, 'length', mm(el, 'Len'));
  const od = dia(el, 'OD');
  const id = dia(el, 'ID');
  put(n, 'outerRadius', od);
  if (od !== undefined && id !== undefined && od > id) n['thickness'] = od - id;
  const angle = num(el, 'RadialAngle');
  if (angle) n['angleOffset'] = (angle * Math.PI) / 180;
  return n;
};

/** `FinSetHandler`: `ShapeCode` 0 trapezoidal, 1 elliptical, 2 freeform. */
function readFinSet(ctx: RktContext, el: Element): ComponentNode {
  const shape = clampCount(num(el, 'ShapeCode') ?? 0, 0, 2);
  const type: ComponentType = shape === 1 ? 'ellipticalfinset' : shape === 2 ? 'freeformfinset' : 'trapezoidfinset';
  const n = base(el, type, true);
  n['finCount'] = clampCount(num(el, 'FinCount') ?? 3, 1, 8);
  put(n, 'thickness', mm(el, 'Thickness'));

  if (type === 'trapezoidfinset') {
    put(n, 'rootChord', mm(el, 'RootChord'));
    put(n, 'tipChord', mm(el, 'TipChord'));
    put(n, 'height', mm(el, 'SemiSpan'));
    put(n, 'sweep', mm(el, 'SweepDistance'));
  } else if (type === 'ellipticalfinset') {
    put(n, 'rootChord', mm(el, 'RootChord'));
    put(n, 'height', mm(el, 'SemiSpan'));
  } else {
    const pts = readPointList(ctx, el);
    if (pts.length >= 3) n['points'] = pts;
  }

  const cant = num(el, 'CantAngle');
  if (cant) n['cant'] = (cant * Math.PI) / 180;
  const angle = num(el, 'RadialAngle');
  if (angle) n['angleOffset'] = (angle * Math.PI) / 180;

  // Through-the-wall tab. RockSim measures the offset from the FRONT of the
  // fin root, which is our 'top' method, and `FinSetHandler` says so.
  const tabLength = mm(el, 'TabLength');
  if (tabLength !== undefined && tabLength > 0) {
    n['tabLength'] = tabLength;
    put(n, 'tabHeight', mm(el, 'TabDepth'));
    n['tabOffset'] = mm(el, 'TabOffset') ?? 0;
    n['tabOffsetMethod'] = 'top';
  }
  return n;
}

/**
 * `<PointList>` is a `x,y|x,y|…` string in mm, measured from the fin's leading
 * root point. Capped like the `.ork` reader's `<finpoints>`: every renderer
 * walks the outline per fin, so an absurd list is a frozen tab.
 */
function readPointList(ctx: RktContext, el: Element): [number, number][] {
  const raw = tag(el, 'PointList');
  if (!raw) return [];
  const out: [number, number][] = [];
  for (const pair of raw.split('|')) {
    if (out.length >= MAX_FIN_POINTS) {
      ctx.notes.push(`A freeform fin had more than ${MAX_FIN_POINTS} points; the rest were dropped.`);
      break;
    }
    const [xs, ys] = pair.split(',');
    const x = finiteNum(xs);
    const y = finiteNum(ys);
    if (x !== undefined && y !== undefined) out.push([x / LENGTH, y / LENGTH]);
  }
  return out;
}

const readTubeFinSet = (el: Element): ComponentNode => {
  const n = base(el, 'tubefinset', true);
  n['finCount'] = clampCount(num(el, 'TubeCount') ?? 6, 1, 12);
  put(n, 'length', mm(el, 'Len'));
  const od = dia(el, 'OD');
  const id = dia(el, 'ID');
  put(n, 'outerRadius', od);
  if (od !== undefined && id !== undefined && od > id) n['thickness'] = od - id;
  const angle = num(el, 'RadialAngle');
  if (angle) n['angleOffset'] = (angle * Math.PI) / 180;
  return n;
};

const readParachute = (el: Element): ComponentNode => {
  const n = base(el, 'parachute', true);
  // NOT a radius: OpenRocket's Parachute takes a diameter, and RockSim's `Dia`
  // is one, so this is the one circular field that converts by LENGTH.
  put(n, 'diameter', mm(el, 'Dia'));
  put(n, 'cd', num(el, 'DragCoefficient'));
  const lines = num(el, 'ShroudLineCount');
  if (lines !== undefined) n['lineCount'] = clampCount(lines, 1, MAX_LINE_COUNT);
  put(n, 'lineLength', mm(el, 'ShroudLineLen'));
  put(n, 'spillHoleDiameter', mm(el, 'SpillHoleDia'));
  const lineMaterial = tag(el, 'ShroudLineMaterial');
  if (lineMaterial) n['lineMaterialName'] = lineMaterial;
  // Despite the element's name, this is kg/m and passes straight through:
  // `ROCKSIM_TO_OPENROCKET_LINE_DENSITY` is 1 in both directions. The "PerMM"
  // is an upstream naming quirk, not a unit — scaling by 1000 here would make
  // every shroud line a thousand times too heavy.
  const lineDensity = num(el, 'ShroudLineMassPerMM');
  if (lineDensity !== undefined && lineDensity > 0) n['lineDensity'] = lineDensity;
  // The canopy's own material is the part material (`Material` + `Density`),
  // which readCommon put on `density` — a parachute's is a SURFACE density.
  if (typeof n.density === 'number') {
    n['surfaceDensity'] = n.density;
    n['surfaceMaterialName'] = n['materialName'];
    delete n.density;
    delete n['materialName'];
  }
  return n;
};

const readStreamer = (el: Element): ComponentNode => {
  const n = base(el, 'streamer', true);
  put(n, 'stripLength', mm(el, 'Len'));
  put(n, 'stripWidth', mm(el, 'Width'));
  put(n, 'cd', num(el, 'DragCoefficient'));
  if (typeof n.density === 'number') {
    n['surfaceDensity'] = n.density;
    n['surfaceMaterialName'] = n['materialName'];
    delete n.density;
    delete n['materialName'];
  }
  return n;
};

/** `MassObjectHandler`: `TypeCode` 1 is a shock cord, everything else is mass. */
const readMassObject = (el: Element): ComponentNode => {
  const shockCord = num(el, 'TypeCode') === 1;
  const n = base(el, shockCord ? 'shockcord' : 'masscomponent', true);
  const len = mm(el, 'Len');
  const mass = num(el, 'KnownMass');
  if (shockCord) {
    put(n, 'cordLength', len);
    // A shock cord's mass is its line density times its length; RockSim states
    // the mass, so derive the density rather than dropping the weight.
    if (mass !== undefined && len !== undefined && len > 0) n['lineDensity'] = mass / MASS / len;
  } else {
    put(n, 'length', len);
    if (mass !== undefined) n['mass'] = mass / MASS;
    put(n, 'radius', dia(el, 'Dia'));
  }
  // RockSim states the measured mass directly on a mass object, so the generic
  // `UseKnownCG` override readCommon may have set would double-count it.
  delete n['overrideMass'];
  return n;
};

const readPod = (ctx: RktContext, el: Element): ComponentNode => {
  const n = base(el, 'podset', true);
  put(n, 'radiusOffset', mm(el, 'RadialLoc'));
  n['radiusMethod'] = 'free';
  const angle = num(el, 'RadialAngle');
  if (angle) n['angleOffset'] = (angle * Math.PI) / 180;
  n['instanceCount'] = 1;
  if (tag(el, 'Detachable') === '1') {
    // RockSim pods can separate; ours cannot. Said once, because the design
    // still flies — it just flies with the pod attached the whole way.
    ctx.dropped.add('a detachable pod (imported as fixed)');
  }
  return n;
};

// ------------------------------------------------------------------ walk ---

type Reader = (ctx: RktContext, el: Element) => ComponentNode;

const READERS: Record<string, Reader> = {
  NoseCone: (_c, el) => readNoseCone(el),
  BodyTube: (_c, el) => readBodyTube(el),
  Transition: (_c, el) => readTransition(el),
  Ring: (_c, el) => readRing(el),
  LaunchLug: (_c, el) => readLaunchLug(el),
  FinSet: readFinSet,
  CustomFinSet: readFinSet,
  TubeFinSet: (_c, el) => readTubeFinSet(el),
  Parachute: (_c, el) => readParachute(el),
  Streamer: (_c, el) => readStreamer(el),
  MassObject: (_c, el) => readMassObject(el),
  ExternalPod: readPod,
};

/**
 * The parts under one container, in file order.
 *
 * RockSim nests two ways at once: a stage's axial parts are direct children of
 * `StageNParts`, while everything mounted ON a part sits in that part's
 * `<AttachedParts>`. Both are walked here, attached parts second, so a tube's
 * rings and fins follow it the way the tree expects.
 *
 * `SubAssembly` is TRANSPARENT: RockSim uses it to group a reusable chunk of
 * design, and we have no equivalent, so its contents are inlined into the
 * parent rather than dropped.
 */
function readParts(ctx: RktContext, container: Element, depth = 0): ComponentNode[] {
  if (depth > MAX_NESTING_DEPTH) {
    throw new Error('This .rkt is nested too deeply to open (possibly malformed).');
  }
  const out: ComponentNode[] = [];
  for (const el of Array.from(container.children)) {
    if (el.tagName === 'AttachedParts') {
      out.push(...readParts(ctx, el, depth + 1));
      continue;
    }
    if (el.tagName === 'SubAssembly') {
      ctx.dropped.add('a subassembly (its parts were merged into the design)');
      out.push(...readParts(ctx, el, depth + 1));
      continue;
    }
    const read = Object.prototype.hasOwnProperty.call(READERS, el.tagName) ? READERS[el.tagName] : undefined;
    if (!read) {
      // Only complain about things that are actually parts. RockSim writes a
      // great deal of scalar bookkeeping (`Len`, `CalcMass`, `SerialNo`, …) as
      // siblings of the parts, and listing those as unsupported components
      // would bury the one line that matters.
      if (el.children.length > 0 || KNOWN_UNSUPPORTED.has(el.tagName)) ctx.ignored.add(el.tagName);
      continue;
    }
    const node = read(ctx, el);
    const kids = readParts(ctx, el, depth + 1);
    if (kids.length > 0) node.children = kids;
    out.push(node);
  }
  return out;
}

/** Parts RockSim has and we do not — named so the banner says what was lost. */
const KNOWN_UNSUPPORTED = new Set(['RingTail']);

// ------------------------------------------------------------------ entry ---

/** RockSim numbers its stages from the NOSE DOWN: 3 is the sustainer. */
const STAGE_ELEMENTS = ['Stage3Parts', 'Stage2Parts', 'Stage1Parts'] as const;

/**
 * Read a `.rkt` into the same result shape `importOrk` produces, so every
 * caller downstream (`loadOrk`, `wireLoadedOrk`, the loaded-design banner)
 * takes it unchanged.
 */
export function importRkt(data: ArrayBuffer | string): OrkImportResult {
  const xml = typeof data === 'string' ? data : new TextDecoder().decode(data);
  const doc = parseOrkXml(xml);
  const design = doc.querySelector('RockSimDocument > DesignInformation > RocketDesign');
  if (!design) throw new Error('Not a .rkt file (missing <RocketDesign>)');

  const name = tag(design, 'Name') ?? 'Imported rocket';
  const ctx: RktContext = { notes: [], ignored: new Set(), dropped: new Set() };

  // `StageCount` decides how many of the three blocks are real: RockSim leaves
  // the unused ones in the file, empty, and reading them anyway would add empty
  // booster stages to every single-stage design.
  // Counted from the NOSE: `RockSimHandler` always reads Stage3Parts, takes
  // Stage2Parts only when the count is 2 or more and Stage1Parts only at 3. A
  // single-stage design therefore lives in Stage3Parts, not Stage1Parts.
  const stageCount = clampCount(num(design, 'StageCount') ?? 1, 1, STAGE_ELEMENTS.length);
  const present = STAGE_ELEMENTS.slice(0, stageCount);

  const components: ComponentNode[] = [];
  present.forEach((elName, i) => {
    const stageEl = design.querySelector(`:scope > ${elName}`);
    const stage: ComponentNode = {
      type: 'stage',
      id: freshId(),
      name: i === 0 ? 'Sustainer' : `Booster ${i}`,
    };
    const kids = stageEl ? readParts(ctx, stageEl) : [];
    if (kids.length > 0) stage.children = kids;
    components.push(stage);
  });

  if (components.every((s) => (s.children ?? []).length === 0)) {
    throw new Error('No supported components found in this design.');
  }

  const notes = [...ctx.notes];
  if (ctx.ignored.size) notes.push(`Ignored unsupported components: ${[...ctx.ignored].join(', ')}.`);
  for (const d of ctx.dropped) notes.push(`This design contains ${d}.`);
  // Said on every import, because it is the difference a user will notice first
  // and it is not a fault in the file: RockSim keeps its motor selections and
  // launch setup with its SIMULATIONS, which are not a design.
  notes.push('RockSim motor selections and launch conditions are not imported — pick a motor to fly this design.');

  return {
    name,
    tree: { name, components },
    motors: {},
    // A `.rkt` declares no flight configurations — RockSim's equivalent lives
    // with its simulations. Stated as an empty table rather than omitted so
    // this result is interchangeable with `importOrk`'s everywhere downstream.
    configs: [],
    chosenConfigId: null,
    ignored: [...ctx.ignored],
    notes,
  };
}
