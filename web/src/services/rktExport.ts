import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import { asStageNodes } from './orkTree';
import { escapeXml } from './xmlUtil';

/**
 * RockSim (`.rkt`) EXPORT.
 *
 * The mirror of `rktImport.ts`, written against the same schema
 * (`RockSimCommonConstants.java` and `file/rocksim/export/*DTO.java`), so
 * everything the reader understands the writer produces and a round trip
 * through the pair is lossless for every type both support.
 *
 * SCOPE, stated plainly. This writes a DESIGN, not a RockSim document: no
 * simulations, no engine selections, no view state. RockSim keeps its motor
 * choices and launch setup with its simulations, which is a different object
 * from the rocket, and inventing a simulation block to carry ours would mean
 * guessing at fields RockSim would then treat as authoritative. The file opens
 * in RockSim as a design with no motor loaded, which is the honest result.
 *
 * Some of what we can build has no RockSim element at all — rail buttons,
 * parallel (strap-on) stages, the app's own fairing extension. Those are
 * skipped and NAMED, because a part silently missing from a file someone else
 * opens is worse than a part they were told about.
 */

/** m → mm. */
const mm = (v: number): number => v * 1000;
/** radius in m → diameter in mm. */
const dia = (v: number): number => v * 2000;
/** kg → g. */
const g = (v: number): number => v * 1000;

/** `RockSimFinishCode` ordinals, by our finish token. */
const FINISH_CODES: Record<string, number> = { polished: 0, smooth: 1, normal: 2, unfinished: 3 };

/** `RockSimNoseConeCode` ordinals, by our shape token. RockSim has no separate
 *  ellipsoid, so both of its rounded codes come back as ELLIPTICAL (3). */
const SHAPE_CODES: Record<string, number> = {
  conical: 0,
  ogive: 1,
  ellipsoid: 3,
  power: 4,
  parabolic: 5,
  haack: 6,
};

/** `RockSimLocationMode` ordinals, by our placement method. */
const LOCATION_CODES: Record<string, number> = { top: 0, absolute: 1, bottom: 2, middle: 0, after: 0 };

interface Writer {
  emit: (depth: number, s: string) => void;
  /** Types that had no RockSim element, named once each for the caller. */
  skipped: Set<string>;
}

// --------------------------------------------------------------- helpers ---

/** A number as RockSim writes them: plain decimal, no exponent, no long tail. */
const fmt = (v: number): string => {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
};

const el = (w: Writer, depth: number, name: string, value: string | number): void => {
  w.emit(depth, `<${name}>${typeof value === 'number' ? fmt(value) : escapeXml(value)}</${name}>`);
};

/** A node's numeric field, or undefined when it is absent or not a number. */
const numOf = (n: ComponentNode, key: string): number | undefined => {
  const v = n[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

const strOf = (n: ComponentNode, key: string): string | undefined => {
  const v = n[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
};

/** Write a length/diameter/mass element only when the node carries the field. */
const put = (w: Writer, d: number, name: string, v: number | undefined, scale: (x: number) => number): void => {
  if (v !== undefined) el(w, d, name, scale(v));
};

/**
 * The header every RockSim part shares: name, material and density, the
 * measured mass/CG pair, finish, and the axial placement.
 *
 * `UseKnownCG` is the single switch RockSim has where we have three overrides.
 * It is written as 1 only when the node overrides mass or CG, because setting
 * it makes RockSim stop computing BOTH from the geometry — turning it on for a
 * part that only overrides drag would silently freeze its mass at whatever we
 * happened to write.
 */
function writeCommon(w: Writer, d: number, n: ComponentNode, withPosition: boolean, densityType = 0): void {
  el(w, d, 'Name', n.name ?? '');
  const material = strOf(n, 'materialName') ?? strOf(n, 'surfaceMaterialName');
  if (material) el(w, d, 'Material', material);

  const density = numOf(n, 'density') ?? numOf(n, 'surfaceDensity');
  if (density !== undefined) {
    // Surface densities go back out in g/cm², which is ×10 from kg/m².
    el(w, d, 'Density', densityType === 1 ? density * 10 : density);
    el(w, d, 'DensityType', densityType);
  }

  const overrideMass = numOf(n, 'overrideMass');
  const overrideCg = numOf(n, 'overrideCGX');
  if (overrideMass !== undefined || overrideCg !== undefined) {
    el(w, d, 'KnownMass', g(overrideMass ?? 0));
    el(w, d, 'KnownCG', mm(overrideCg ?? 0));
    el(w, d, 'UseKnownCG', 1);
  }

  const finish = strOf(n, 'finish') ?? 'normal';
  if (FINISH_CODES[finish] !== undefined) el(w, d, 'FinishCode', FINISH_CODES[finish]);

  if (withPosition) {
    const pos = n.position;
    const method = pos?.method ?? 'top';
    const offset = pos?.offset ?? 0;
    // Only BOTTOM flips, exactly as the reader does.
    el(w, d, 'Xb', mm(method === 'bottom' ? -offset : offset));
    el(w, d, 'LocationMode', LOCATION_CODES[method] ?? 0);
  }
}

/** `ConstructionType` + `WallThickness`, for the two shaped bodies. */
function writeWall(w: Writer, d: number, n: ComponentNode): void {
  if (n['filled'] === true) {
    el(w, d, 'ConstructionType', 0);
    return;
  }
  el(w, d, 'ConstructionType', 1);
  put(w, d, 'WallThickness', numOf(n, 'thickness'), mm);
}

function writeShape(w: Writer, d: number, n: ComponentNode, fallback: string): void {
  const shape = strOf(n, 'shape') ?? fallback;
  el(w, d, 'ShapeCode', SHAPE_CODES[shape] ?? SHAPE_CODES[fallback]!);
  const param = numOf(n, 'shapeParameter');
  if (param !== undefined) el(w, d, 'ShapeParameter', param);
}

/** An angle stored in radians, back out as RockSim's degrees. */
const deg = (v: number): number => (v * 180) / Math.PI;

// --------------------------------------------------------------- writers ---

type PartWriter = (w: Writer, d: number, n: ComponentNode) => void;

const writeNoseCone: PartWriter = (w, d, n) => {
  writeCommon(w, d, n, false);
  put(w, d, 'Len', numOf(n, 'length'), mm);
  put(w, d, 'BaseDia', numOf(n, 'aftRadius'), dia);
  writeWall(w, d, n);
  writeShape(w, d, n, 'ogive');
  put(w, d, 'ShoulderOD', numOf(n, 'shoulderRadius'), dia);
  put(w, d, 'ShoulderLen', numOf(n, 'shoulderLength'), mm);
};

const writeTransition: PartWriter = (w, d, n) => {
  writeCommon(w, d, n, true);
  put(w, d, 'Len', numOf(n, 'length'), mm);
  put(w, d, 'FrontDia', numOf(n, 'foreRadius'), dia);
  put(w, d, 'RearDia', numOf(n, 'aftRadius'), dia);
  writeWall(w, d, n);
  writeShape(w, d, n, 'conical');
  put(w, d, 'FrontShoulderDia', numOf(n, 'foreShoulderRadius'), dia);
  put(w, d, 'FrontShoulderLen', numOf(n, 'foreShoulderLength'), mm);
  put(w, d, 'RearShoulderDia', numOf(n, 'aftShoulderRadius'), dia);
  put(w, d, 'RearShoulderLen', numOf(n, 'aftShoulderLength'), mm);
};

/** Both our tube types are one RockSim element, told apart by `IsInsideTube`. */
const writeTube =
  (inner: boolean): PartWriter =>
  (w, d, n) => {
    writeCommon(w, d, n, inner);
    put(w, d, 'Len', numOf(n, 'length'), mm);
    const or = numOf(n, 'outerRadius');
    const th = numOf(n, 'thickness');
    put(w, d, 'OD', or, dia);
    if (or !== undefined && th !== undefined) el(w, d, 'ID', dia(or - th));
    el(w, d, 'IsInsideTube', inner ? 1 : 0);
    el(w, d, 'IsMotorMount', n['motorMount'] === true ? 1 : 0);
    put(w, d, 'EngineOverhang', numOf(n, 'motorOverhang'), mm);
    if (inner) {
      put(w, d, 'RadialLoc', numOf(n, 'radialPosition'), mm);
      const dir = numOf(n, 'radialDirection');
      if (dir) el(w, d, 'RadialAngle', deg(dir));
    }
  };

/** Our four ring types are one RockSim `Ring`, told apart by `UsageCode`. */
const RING_USAGE: Record<string, number> = { centeringring: 0, bulkhead: 1, engineblock: 2, tubecoupler: 4 };

const writeRing: PartWriter = (w, d, n) => {
  writeCommon(w, d, n, true);
  el(w, d, 'UsageCode', RING_USAGE[n.type] ?? 0);
  put(w, d, 'Len', numOf(n, 'length'), mm);
  const or = numOf(n, 'outerRadius');
  put(w, d, 'OD', or, dia);
  // A bulkhead is solid; a centering ring states its bore; the tube-like rings
  // state a wall, so their ID comes from the thickness instead.
  const ir = numOf(n, 'innerRadius');
  const th = numOf(n, 'thickness');
  if (n.type === 'bulkhead') el(w, d, 'ID', 0);
  else if (ir !== undefined) el(w, d, 'ID', dia(ir));
  else if (or !== undefined && th !== undefined) el(w, d, 'ID', dia(or - th));
};

const writeLaunchLug: PartWriter = (w, d, n) => {
  writeCommon(w, d, n, true);
  put(w, d, 'Len', numOf(n, 'length'), mm);
  const or = numOf(n, 'outerRadius');
  const th = numOf(n, 'thickness');
  put(w, d, 'OD', or, dia);
  if (or !== undefined && th !== undefined) el(w, d, 'ID', dia(or - th));
  const angle = numOf(n, 'angleOffset');
  if (angle) el(w, d, 'RadialAngle', deg(angle));
};

const FIN_SHAPE_CODES: Record<string, number> = { trapezoidfinset: 0, ellipticalfinset: 1, freeformfinset: 2 };

const writeFinSet: PartWriter = (w, d, n) => {
  writeCommon(w, d, n, true);
  el(w, d, 'ShapeCode', FIN_SHAPE_CODES[n.type] ?? 0);
  el(w, d, 'FinCount', numOf(n, 'finCount') ?? 3);
  put(w, d, 'Thickness', numOf(n, 'thickness'), mm);

  if (n.type === 'trapezoidfinset') {
    put(w, d, 'RootChord', numOf(n, 'rootChord'), mm);
    put(w, d, 'TipChord', numOf(n, 'tipChord'), mm);
    put(w, d, 'SemiSpan', numOf(n, 'height'), mm);
    put(w, d, 'SweepDistance', numOf(n, 'sweep'), mm);
  } else if (n.type === 'ellipticalfinset') {
    put(w, d, 'RootChord', numOf(n, 'rootChord'), mm);
    put(w, d, 'SemiSpan', numOf(n, 'height'), mm);
  } else {
    const pts = n['points'];
    if (Array.isArray(pts) && pts.length >= 3) {
      el(w, d, 'PointList', (pts as [number, number][]).map(([x, y]) => `${fmt(mm(x))},${fmt(mm(y))}`).join('|'));
    }
  }

  const cant = numOf(n, 'cant');
  if (cant) el(w, d, 'CantAngle', deg(cant));
  const angle = numOf(n, 'angleOffset');
  if (angle) el(w, d, 'RadialAngle', deg(angle));

  const tabLength = numOf(n, 'tabLength');
  if (tabLength !== undefined && tabLength > 0) {
    el(w, d, 'TabLength', mm(tabLength));
    put(w, d, 'TabDepth', numOf(n, 'tabHeight'), mm);
    el(w, d, 'TabOffset', mm(numOf(n, 'tabOffset') ?? 0));
  }
};

const writeTubeFinSet: PartWriter = (w, d, n) => {
  writeCommon(w, d, n, true);
  el(w, d, 'TubeCount', numOf(n, 'finCount') ?? 6);
  put(w, d, 'Len', numOf(n, 'length'), mm);
  const or = numOf(n, 'outerRadius');
  const th = numOf(n, 'thickness');
  put(w, d, 'OD', or, dia);
  if (or !== undefined && th !== undefined) el(w, d, 'ID', dia(or - th));
  const angle = numOf(n, 'angleOffset');
  if (angle) el(w, d, 'RadialAngle', deg(angle));
};

const writeParachute: PartWriter = (w, d, n) => {
  writeCommon(w, d, n, true, 1); // canopy fabric is a SURFACE density
  // `Dia` is a diameter on both sides — not halved, unlike every other
  // circular field in the format.
  put(w, d, 'Dia', numOf(n, 'diameter'), mm);
  const cd = numOf(n, 'cd');
  if (cd !== undefined) el(w, d, 'DragCoefficient', cd);
  el(w, d, 'ShroudLineCount', numOf(n, 'lineCount') ?? 6);
  put(w, d, 'ShroudLineLen', numOf(n, 'lineLength'), mm);
  put(w, d, 'SpillHoleDia', numOf(n, 'spillHoleDiameter'), mm);
  const lineMaterial = strOf(n, 'lineMaterialName');
  if (lineMaterial) el(w, d, 'ShroudLineMaterial', lineMaterial);
  // kg/m straight through, despite the element's name: see the note on the
  // reader's side — `ROCKSIM_TO_OPENROCKET_LINE_DENSITY` is 1.
  const lineDensity = numOf(n, 'lineDensity');
  if (lineDensity !== undefined) el(w, d, 'ShroudLineMassPerMM', lineDensity);
};

const writeStreamer: PartWriter = (w, d, n) => {
  writeCommon(w, d, n, true, 1);
  put(w, d, 'Len', numOf(n, 'stripLength'), mm);
  put(w, d, 'Width', numOf(n, 'stripWidth'), mm);
  const cd = numOf(n, 'cd');
  if (cd !== undefined) el(w, d, 'DragCoefficient', cd);
};

const writeMassObject =
  (shockCord: boolean): PartWriter =>
  (w, d, n) => {
    writeCommon(w, d, n, true);
    el(w, d, 'TypeCode', shockCord ? 1 : 0);
    if (shockCord) {
      const len = numOf(n, 'cordLength') ?? 0;
      el(w, d, 'Len', mm(len));
      // RockSim states a shock cord's MASS, not its line density.
      el(w, d, 'KnownMass', g((numOf(n, 'lineDensity') ?? 0) * len));
    } else {
      put(w, d, 'Len', numOf(n, 'length'), mm);
      put(w, d, 'Dia', numOf(n, 'radius'), dia);
      el(w, d, 'KnownMass', g(numOf(n, 'mass') ?? 0));
    }
  };

const writePod: PartWriter = (w, d, n) => {
  writeCommon(w, d, n, true);
  put(w, d, 'RadialLoc', numOf(n, 'radiusOffset'), mm);
  const angle = numOf(n, 'angleOffset');
  if (angle) el(w, d, 'RadialAngle', deg(angle));
  el(w, d, 'Detachable', 0);
  el(w, d, 'Removed', 0);
};

/** Our type → its RockSim element name and the writer that fills it. */
const PARTS: Record<string, { tag: string; write: PartWriter }> = {
  nosecone: { tag: 'NoseCone', write: writeNoseCone },
  transition: { tag: 'Transition', write: writeTransition },
  bodytube: { tag: 'BodyTube', write: writeTube(false) },
  innertube: { tag: 'BodyTube', write: writeTube(true) },
  centeringring: { tag: 'Ring', write: writeRing },
  bulkhead: { tag: 'Ring', write: writeRing },
  engineblock: { tag: 'Ring', write: writeRing },
  tubecoupler: { tag: 'Ring', write: writeRing },
  launchlug: { tag: 'LaunchLug', write: writeLaunchLug },
  trapezoidfinset: { tag: 'FinSet', write: writeFinSet },
  ellipticalfinset: { tag: 'FinSet', write: writeFinSet },
  freeformfinset: { tag: 'CustomFinSet', write: writeFinSet },
  tubefinset: { tag: 'TubeFinSet', write: writeTubeFinSet },
  parachute: { tag: 'Parachute', write: writeParachute },
  streamer: { tag: 'Streamer', write: writeStreamer },
  shockcord: { tag: 'MassObject', write: writeMassObject(true) },
  masscomponent: { tag: 'MassObject', write: writeMassObject(false) },
  podset: { tag: 'ExternalPod', write: writePod },
};

/** One part and, in `<AttachedParts>`, everything mounted on it. */
function writePart(w: Writer, depth: number, n: ComponentNode): void {
  const spec = PARTS[n.type];
  if (!spec) {
    w.skipped.add(n.type);
    return;
  }
  w.emit(depth, `<${spec.tag}>`);
  spec.write(w, depth + 1, n);
  const kids = n.children ?? [];
  if (kids.length > 0) {
    w.emit(depth + 1, '<AttachedParts>');
    for (const kid of kids) writePart(w, depth + 2, kid);
    w.emit(depth + 1, '</AttachedParts>');
  }
  w.emit(depth, `</${spec.tag}>`);
}

// ----------------------------------------------------------------- entry ---

export interface RktExportResult {
  xml: string;
  /** Component types that had no RockSim element and were left out. */
  skipped: string[];
}

/** RockSim numbers its stages from the nose down: 3 is the sustainer. */
const STAGE_ELEMENTS = ['Stage3Parts', 'Stage2Parts', 'Stage1Parts'] as const;

/**
 * Write a design as RockSim XML.
 *
 * Returns the skipped types beside the text rather than throwing or silently
 * dropping them, so the caller can tell the user what did not make it into the
 * file they are about to hand to someone else.
 */
export function exportRkt(name: string, tree: RocketTree): RktExportResult {
  const lines: string[] = [];
  const w: Writer = {
    emit: (depth, s) => lines.push('  '.repeat(depth) + s),
    skipped: new Set(),
  };

  // RockSim reads at most three stages, nose-first. A design with more loses
  // the extras; a `parallelstage` is not a RockSim concept at all and is
  // reported by writePart like any other unrepresentable type.
  const stages = asStageNodes(tree);
  const written = Math.min(stages.length, STAGE_ELEMENTS.length);
  if (stages.length > STAGE_ELEMENTS.length) w.skipped.add(`stage ${STAGE_ELEMENTS.length + 1} and beyond`);

  w.emit(0, '<?xml version="1.0" encoding="UTF-8"?>');
  w.emit(0, '<RockSimDocument>');
  // Version 4 is what OpenRocket's own saver writes and what its loader reads.
  w.emit(1, '<FileVersion>4</FileVersion>');
  w.emit(1, '<DesignInformation>');
  w.emit(2, '<RocketDesign>');
  w.emit(3, `<Name>${escapeXml(name)}</Name>`);
  w.emit(3, `<StageCount>${written}</StageCount>`);

  STAGE_ELEMENTS.forEach((elName, i) => {
    const stage = i < written ? stages[i] : undefined;
    const kids = stage?.children ?? [];
    if (kids.length === 0) {
      // Written empty even when unused: RockSim's own files always carry all
      // three blocks, and its reader keys off StageCount rather than presence.
      w.emit(3, `<${elName}/>`);
      return;
    }
    w.emit(3, `<${elName}>`);
    for (const kid of kids) writePart(w, 4, kid);
    w.emit(3, `</${elName}>`);
  });

  w.emit(2, '</RocketDesign>');
  w.emit(1, '</DesignInformation>');
  w.emit(0, '</RockSimDocument>');

  return { xml: lines.join('\n') + '\n', skipped: [...w.skipped] };
}
