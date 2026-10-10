import { decodeFileText } from './decodeText';
import type { ComponentNode, ComponentType } from '../../engine/openRocketEngine';
import { syncAutoRadii } from '../design/autoRadius';
import { defaultStageName, freshId } from '../design/orkTree';
import { xmlText as text } from './xmlUtil';
import { parseOrkXml } from './ork/importUnpack';
import { clampCount, finiteNum } from './ork/numbers';
import { MAX_FIN_COUNT, MAX_FIN_POINTS, MAX_LINE_COUNT, checkDepth, countComponent } from './ork/importLimits';
import { ignoredNotes } from './ork/importNotes';
import { keyedNote, type ImportNote } from './importNote';
import type { OrkImportResult } from './orkTypes';
import { numOpt } from '../../tree/nodeProps';
import { trapezoidPoints } from '../../tree/finPlanform';
import { isAssembly } from '../../tree/assembly';
import { hexOf, parseHexColor } from '../design/colorHex';
import { degToRad } from '../../prefs/units';

/**
 * RockSim (`.rkt`) import.
 *
 * A TypeScript port of OpenRocket's `file/rocksim/importt/` handlers, not an
 * extraction of them. That package is SAX-based and pulls in the document,
 * appearance and warning machinery the desktop is built on; the schema it
 * encodes is small enough to read directly, and reading it here keeps the
 * importer on the same side of the engine boundary as `orkImport`: plain
 * DOM, unit-testable, no kernel round trip.
 *
 * The element vocabulary, the unit factors and every enum below are taken from
 * `RockSimCommonConstants.java` and its four enums, so a future OpenRocket bump
 * can be diffed against those files.
 *
 * Units: everything is millimeters and grams, and every circular dimension is
 * a diameter where OpenRocket wants a radius, hence the three divisors below.
 * Getting one of those wrong produces a design that is 1000x or 2x off rather
 * than one that fails to load, which is why they are named constants used
 * everywhere rather than inline literals.
 */

/** mm → m. `RockSimCommonConstants.ROCKSIM_TO_OPENROCKET_LENGTH`. */
const LENGTH = 1000;
/** diameter in mm → radius in m. `…_TO_OPENROCKET_RADIUS` (2 × length). */
const RADIUS = 2000;
/** g → kg. `…_TO_OPENROCKET_MASS`. */
const MASS = 1000;
/**
 * RockSim surface density → kg/m². `…_TO_OPENROCKET_SURFACE_DENSITY`.
 *
 * Divided, like LENGTH, RADIUS and MASS above: the kernel's whole rocksim
 * package converts inbound by dividing by its constant
 * (`BaseHandler.computeDensity` is `raw / type.asOpenRocket()`) and outbound by
 * multiplying (`BasePartDTO` line 181). The direction matters by a factor of a
 * hundred, and the physics agrees with the kernel: RockSim's unit is g/cm², and
 * 1 g/cm² is 10 kg/m², so a nylon canopy at 0.067 kg/m² sits in the file as
 * 0.0067.
 */
const SURFACE_DENSITY = 1 / 10;

/** `RockSimNoseConeCode`. RockSim's PARABOLIC (2) really is OpenRocket's ELLIPSOID. */
const SHAPES = ['conical', 'ogive', 'ellipsoid', 'ellipsoid', 'power', 'parabolic', 'haack'] as const;

/** `RockSimFinishCode`, in its own ordinal order. */
const FINISHES = ['polished', 'smooth', 'normal', 'unfinished'] as const;

/** `RockSimLocationMode`: 0 front of parent, 1 from the nose tip, 2 back of parent. */
const LOCATION_METHODS = ['top', 'absolute', 'bottom'] as const;

/**
 * `RockSimDensityType` divisors: bulk (kg/m³), surface (g/cm²), line (kg/m).
 * Bulk and line are 1 in both directions; only surface converts.
 */
const DENSITY_DIVISORS = [1, SURFACE_DENSITY, 1];

interface RktContext {
  notes: ImportNote[];
  ignored: Set<string>;
  /** Things we understand but deliberately do not carry, named once each by their `importNote.*` key. */
  dropped: Set<string>;
  /** Components read so far, against MAX_COMPONENTS. Mutable on purpose:
   *  the readers recurse, so the ceiling has to be one running total
   *  rather than a per-level one. */
  nodeCount: number;
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

/** A length in mm → m, floored at zero. See {@link nonNeg}. */
const mmPos = (el: Element, name: string): number | undefined => nonNeg(mm(el, name));

/** A diameter in mm → a radius in m. */
const dia = (el: Element, name: string): number | undefined => {
  const v = num(el, name);
  return v === undefined ? undefined : Math.max(0, v / RADIUS);
};

/**
 * `RockSimDensityType` for this part: 0 bulk, 1 surface, 2 line. Read on its own
 * because a recovery device converts by it as well as dividing by it.
 */
const densityType = (el: Element): number => clampCount(num(el, 'DensityType') ?? 0, 0, 2);

/**
 * HTML 4.01 / CSS level 1 basic color keywords, which is the whole set of names
 * both an SVG `fill` and a three.js material understand without a lookup table,
 * and the set RockSim writes ("Black", "Red", ...).
 *
 * Here so the value can be normalized to the `#rrggbb` the tree's `color` key
 * means everywhere else. A name would render (both consumers parse CSS names)
 * but `colorXml` in `ork/exportParts.ts` only writes what `parseHexColor`
 * accepts, so a RockSim design converted to `.ork` would lose its part colors.
 */
// cspell:ignore grey -- a CSS color keyword, not prose: CSS defines `gray` and
// `grey` as two spellings of one color and both are valid in an SVG `fill`, so a
// file that says one of them has to be understood.
const BASIC_COLORS: Record<string, string> = {
  black: '#000000',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  white: '#ffffff',
  maroon: '#800000',
  red: '#ff0000',
  purple: '#800080',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  green: '#008000',
  lime: '#00ff00',
  olive: '#808000',
  yellow: '#ffff00',
  navy: '#000080',
  blue: '#0000ff',
  teal: '#008080',
  aqua: '#00ffff',
  cyan: '#00ffff',
};

/**
 * A RockSim `<Color>` as the `#rrggbb` the tree means, or nothing.
 *
 * The .ork reader validates its three 0-255 channels and builds a hex string,
 * and this does the same for the same key: the schematic hands it to SVG
 * `fill`, the 3D view to a three.js material, and the exporter parses it as
 * hex, so an arbitrary string there would mean something different to each.
 *
 * Accepts the three spellings a file actually carries (`#rrggbb`, a bare
 * `rrggbb`, the `#rgb` shorthand) and a basic color name. Anything else is
 * dropped, which leaves the part on its group color rather than on a value no
 * consumer can read.
 */
const rktColor = (raw: string | null | undefined): string | undefined => {
  const t = raw?.trim();
  if (!t) return undefined;
  const named = BASIC_COLORS[t.toLowerCase()];
  if (named) return named;
  // A hex spelling is six digits or the #rgb shorthand; an alpha byte is not one.
  if (/^(#[0-9a-f]{3}|#?[0-9a-f]{6})$/i.test(t)) {
    const rgb = parseHexColor(t);
    if (rgb !== null) return hexOf(rgb);
  }
  return undefined;
};

/**
 * A dimension, floored at zero.
 *
 * The handlers wrap most dimensions in `Math.max(0, …)`, and the ones that do
 * not are an inconsistency rather than a decision. Applied to every dimension
 * here, which never changes a valid file and keeps a negative length or radius
 * out of the tree, the mesh and the mass.
 */
const nonNeg = (v: number | undefined): number | undefined => (v === undefined ? undefined : Math.max(0, v));

/**
 * The wall a RockSim OD/ID pair describes.
 *
 * `BodyTube.setInnerRadius(r)` is `setThickness(getOuterRadius() - r)`, so the
 * handlers' unconditional `setInnerRadius` makes a zero ID a solid part rather
 * than a missing value. Treating it as missing would leave a solid rod, nose
 * block or engine block with the bridge's default wall and far too little mass.
 */
const wallFrom = (od: number | undefined, id: number | undefined): number | undefined =>
  od !== undefined && id !== undefined && od >= id ? od - id : undefined;

/** Assign only a defined value, so an absent element leaves the app's default. */
const put = (n: ComponentNode, key: string, v: number | string | undefined): void => {
  if (v !== undefined) n[key] = v;
};

/** A tube's `OD` and `ID` as an outer radius and a wall thickness. */
const readTubeWall = (el: Element, n: ComponentNode): void => {
  const od = dia(el, 'OD');
  put(n, 'outerRadius', od);
  put(n, 'thickness', wallFrom(od, dia(el, 'ID')));
};

/** `RadialAngle` (degrees) into `key` (radians); a zero angle leaves the default. */
const readRadialAngle = (el: Element, n: ComponentNode, key: 'angleOffset' | 'radialDirection'): void => {
  const angle = num(el, 'RadialAngle');
  if (angle) n[key] = degToRad(angle);
};

/**
 * What every RockSim part carries: name, material, finish, the mass/CG
 * override pair and its axial placement.
 *
 * RockSim's override is one switch (`UseKnownCG`) over both mass and CG, and it
 * has no equivalent of OpenRocket's "apply to subcomponents": `BaseHandler`
 * explicitly clears those two flags. So a `.rkt` can only ever produce a
 * self-only override, and that is what is written here.
 */
function readCommon(el: Element, n: ComponentNode, withPosition: boolean): void {
  const name = tag(el, 'Name');
  if (name) n.name = name;

  const density = num(el, 'Density');
  if (density !== undefined && density > 0) {
    n.density = density / DENSITY_DIVISORS[densityType(el)]!;
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

  const color = rktColor(tag(el, 'Color'));
  if (color) n['color'] = color;

  if (withPosition) {
    const offset = mm(el, 'Xb');
    if (offset !== undefined) {
      const method = LOCATION_METHODS[clampCount(num(el, 'LocationMode') ?? 0, 0, 2)]!;
      // Only bottom flips sign, exactly as `PositionDependentHandler.setLocation`
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
  put(n, 'thickness', mmPos(el, 'WallThickness'));
};

/** The shapes a shape parameter means anything on (`NoseConeHandler`). */
const PARAMETERIZED_SHAPES = new Set(['power', 'parabolic', 'haack']);

const readShape = (el: Element, n: ComponentNode): void => {
  const code = num(el, 'ShapeCode');
  const shape = SHAPES[clampCount(code ?? 1, 0, SHAPES.length - 1)]!;
  n['shape'] = shape;
  // RockSim writes ShapeParameter for every nose cone and transition, and
  // `NoseConeHandler` applies it only on these three shapes. The key is not
  // inert here either: the mesh, the report, the schematic, the 3D view and the
  // `.ork` writer all read it.
  if (PARAMETERIZED_SHAPES.has(shape)) put(n, 'shapeParameter', num(el, 'ShapeParameter'));
};

/** A tube that is a motor mount: the flag plus RockSim's engine overhang. */
const readMount = (el: Element, n: ComponentNode): void => {
  if (tag(el, 'IsMotorMount') !== '1') return;
  n['motorMount'] = true;
  const overhang = mm(el, 'EngineOverhang');
  if (overhang !== undefined && overhang !== 0) n['motorOverhang'] = overhang;
};

/**
 * The thickness a shoulder's wall and cap are made of.
 *
 * `NoseConeHandler.endHandler` and `TransitionHandler.endHandler`: a filled part
 * has a solid shoulder, whose thickness is therefore its own radius; a hollow
 * one gives its shoulder the part's wall. Left unset, the kernel's
 * `setForeShoulderLength` fills the thickness from the previous part's wall,
 * which is wrong for a filled part.
 */
const shoulderWall = (el: Element, n: ComponentNode, shoulderRadius: number | undefined): number | undefined =>
  n['filled'] === true ? shoulderRadius : mmPos(el, 'WallThickness');

/**
 * A shoulder RockSim gives a length to is capped.
 *
 * Neither RockSim nor its handlers have a cap flag: the kernel's
 * `setForeShoulderLength` turns the cap on itself when a shoulder first gains a
 * length, and desktop never turns it off, so every `.rkt` shoulder arrives
 * capped. Set explicitly here because `ComponentFactory` sets the cap after the
 * length from a key that defaults to false, which would undo the kernel's own
 * answer and leave the cap discs weighing nothing.
 */
const cappedByLength = (length: number | undefined): boolean | undefined =>
  length !== undefined && length > 0 ? true : undefined;

const readNoseCone = (el: Element): ComponentNode => {
  const n = base(el, 'nosecone', false);
  put(n, 'length', mmPos(el, 'Len'));
  put(n, 'aftRadius', dia(el, 'BaseDia'));
  readWall(el, n);
  readShape(el, n);
  const shR = dia(el, 'ShoulderOD');
  const shL = mmPos(el, 'ShoulderLen');
  put(n, 'shoulderRadius', shR);
  put(n, 'shoulderLength', shL);
  put(n, 'shoulderThickness', shoulderWall(el, n, shR));
  const capped = cappedByLength(shL);
  if (capped !== undefined) n['shoulderCapped'] = capped;
  return n;
};

const readTransition = (el: Element): ComponentNode => {
  const n = base(el, 'transition', true);
  put(n, 'length', mmPos(el, 'Len'));
  put(n, 'foreRadius', dia(el, 'FrontDia'));
  put(n, 'aftRadius', dia(el, 'RearDia'));
  readWall(el, n);
  readShape(el, n);
  const fShR = dia(el, 'FrontShoulderDia');
  const aShR = dia(el, 'RearShoulderDia');
  const fShL = mmPos(el, 'FrontShoulderLen');
  const aShL = mmPos(el, 'RearShoulderLen');
  put(n, 'foreShoulderRadius', fShR);
  put(n, 'foreShoulderLength', fShL);
  put(n, 'aftShoulderRadius', aShR);
  put(n, 'aftShoulderLength', aShL);
  put(n, 'foreShoulderThickness', shoulderWall(el, n, fShR));
  put(n, 'aftShoulderThickness', shoulderWall(el, n, aShR));
  const foreCapped = cappedByLength(fShL);
  if (foreCapped !== undefined) n['foreShoulderCapped'] = foreCapped;
  const aftCapped = cappedByLength(aShL);
  if (aftCapped !== undefined) n['aftShoulderCapped'] = aftCapped;
  return n;
};

/**
 * A `BodyTube` is an airframe tube or an inner tube depending on `IsInsideTube`:
 * RockSim uses one element for both, and `AttachedPartsHandler` picks the
 * OpenRocket type from that flag.
 */
const readBodyTube = (el: Element): ComponentNode => {
  const inner = tag(el, 'IsInsideTube') === '1';
  const n = base(el, inner ? 'innertube' : 'bodytube', inner);
  put(n, 'length', mmPos(el, 'Len'));
  readTubeWall(el, n);
  readMount(el, n);
  if (inner) {
    put(n, 'radialPosition', mmPos(el, 'RadialLoc'));
    readRadialAngle(el, n, 'radialDirection');
  }
  return n;
};

/** `RingHandler.endHandler`'s `UsageCode` → the four OpenRocket ring types. */
const RING_TYPES: Record<number, ComponentType> = {
  0: 'centeringring',
  1: 'bulkhead',
  2: 'engineblock',
  3: 'tubecoupler', // "Sleeve", a coupler on the outside; nearest we have
  4: 'tubecoupler',
};

const readRing = (el: Element): ComponentNode => {
  const usage = clampCount(num(el, 'UsageCode') ?? 0, 0, 4);
  const n = base(el, RING_TYPES[usage] ?? 'centeringring', true);
  put(n, 'length', mmPos(el, 'Len'));
  const od = dia(el, 'OD');
  const id = dia(el, 'ID');
  put(n, 'outerRadius', od);
  // A bulkhead is solid and carries no inner radius in our tree (the kernel's
  // `Bulkhead.getInnerRadius` answers 0 whatever is set); the others do.
  if (n.type === 'centeringring') put(n, 'innerRadius', id);
  if (n.type === 'tubecoupler' || n.type === 'engineblock') put(n, 'thickness', wallFrom(od, id));
  return n;
};

const readLaunchLug = (el: Element): ComponentNode => {
  const n = base(el, 'launchlug', true);
  put(n, 'length', mmPos(el, 'Len'));
  readTubeWall(el, n);
  readRadialAngle(el, n, 'angleOffset');
  return n;
};

/** `TipShapeCode` is the fin's cross section (`FinSetHandler.convertTipShapeCode`). */
const CROSS_SECTIONS = ['square', 'rounded', 'airfoil'] as const;

/**
 * The parts only a freeform fin set may be mounted on.
 *
 * `Transition.isCompatible` admits an internal component and a FreeformFinSet
 * and nothing else, and a NoseCone is a Transition. So a trapezoidal or
 * elliptical fin set on either would be refused by the kernel outright, which is
 * why `FinSetHandler.endHandler` converts a trapezoid to freeform before
 * attaching it, and why an elliptical one gets the handler's "can not be
 * attached, ignoring component" instead.
 */
const FREEFORM_ONLY_PARENTS = new Set(['nosecone', 'transition']);

/**
 * A trapezoid as a freeform outline, from the fin's leading root point.
 *
 * The four corners `TrapezoidFinSet.getFinPoints` lists, including its omission
 * of the tip point on a fin that tapers to one and its floor on the root chord.
 * Desktop's `convertFinSet` reads exactly this: it detaches the fin first, and a
 * fin with no parent's `getRootPoints` is a single zero, so the snapping that
 * function would otherwise do to the first and last point does not apply.
 */
function trapezoidOutline(n: ComponentNode): [number, number][] {
  const root = numOpt(n, 'rootChord') ?? 0;
  const tip = numOpt(n, 'tipChord') ?? 0;
  const span = numOpt(n, 'height') ?? 0;
  const sweep = numOpt(n, 'sweep') ?? 0;
  return trapezoidPoints(root, tip, sweep, span);
}

/** `FinSetHandler`: `ShapeCode` 0 trapezoidal, 1 elliptical, 2 freeform. */
function readFinSet(ctx: RktContext, el: Element, parent?: ComponentNode): ComponentNode {
  const shape = clampCount(num(el, 'ShapeCode') ?? 0, 0, 2);
  const type: ComponentType = shape === 1 ? 'ellipticalfinset' : shape === 2 ? 'freeformfinset' : 'trapezoidfinset';
  const n = base(el, type, true);
  n['finCount'] = clampCount(num(el, 'FinCount') ?? 3, 1, MAX_FIN_COUNT);
  put(n, 'thickness', mmPos(el, 'Thickness'));

  if (type === 'trapezoidfinset') {
    put(n, 'rootChord', mmPos(el, 'RootChord'));
    put(n, 'tipChord', mmPos(el, 'TipChord'));
    put(n, 'height', mmPos(el, 'SemiSpan'));
    put(n, 'sweep', mm(el, 'SweepDistance'));
  } else if (type === 'ellipticalfinset') {
    put(n, 'rootChord', mmPos(el, 'RootChord'));
    put(n, 'height', mmPos(el, 'SemiSpan'));
  } else {
    const pts = readPointList(ctx, el);
    if (pts.length >= 3) n['points'] = pts;
  }

  const cant = num(el, 'CantAngle');
  if (cant) n['cant'] = degToRad(cant);
  readRadialAngle(el, n, 'angleOffset');

  // The fin's cross section, which is what RockSim calls a tip shape. Without
  // it every imported fin would be square, with the wrong drag and mass.
  const cross = CROSS_SECTIONS[clampCount(num(el, 'TipShapeCode') ?? 0, 0, CROSS_SECTIONS.length - 1)]!;
  if (cross !== 'square') n['crossSection'] = cross;

  /**
   * An airfoil fin takes RockSim's own computed mass and CG.
   *
   * `FinSetHandler.endHandler` overrides them even though the file asked for no
   * override, because RockSim computes one mass per fin whatever the cross
   * section and OpenRocket does not, and the two otherwise disagree drastically
   * (its word). Only when the file states no override of its own, which is the
   * same test upstream makes.
   */
  if (cross === 'airfoil' && n['overrideMass'] === undefined) {
    const calcMass = num(el, 'CalcMass');
    const calcCg = mm(el, 'CalcCG');
    if (calcMass !== undefined) n['overrideMass'] = Math.max(0, calcMass / MASS);
    if (calcCg !== undefined) n['overrideCGX'] = Math.max(0, calcCg);
  }

  // Through-the-wall tab. RockSim measures the offset from the front of the
  // fin root, which is our 'top' method, and `FinSetHandler` says so.
  const tabLength = mmPos(el, 'TabLength');
  if (tabLength !== undefined && tabLength > 0) {
    n['tabLength'] = tabLength;
    const tabDepth = mmPos(el, 'TabDepth');
    if (tabDepth !== undefined) {
      // A tab is measured from the front of the fin root, so on a body that
      // tapers the depth already contains the drop from the fore radius to the
      // aft one and has to give it back. Zero on a tube, where the two are equal.
      const foreR = typeof parent?.['foreRadius'] === 'number' ? parent['foreRadius'] : 0;
      const aftR = typeof parent?.['aftRadius'] === 'number' ? parent['aftRadius'] : 0;
      n['tabHeight'] = Math.max(0, tabDepth - Math.max(foreR - aftR, 0));
    }
    n['tabOffset'] = mm(el, 'TabOffset') ?? 0;
    n['tabOffsetMethod'] = 'top';
  }
  return n;
}

/**
 * `<PointList>` is a `x,y|x,y|…` string in mm, measured from the fin's leading
 * root point. Capped like the `.ork` reader's `<finpoints>`: every renderer
 * walks the outline per fin, so an absurd list is a frozen tab.
 *
 * Scanned with `indexOf` rather than `raw.split('|')`, so the cap bounds the
 * work as well as the result, as the `.ork` reader's sibling walk does. `split`
 * materializes every pair before the first cap test, so a crafted `<PointList>`
 * of a few megabytes would allocate millions of substrings first.
 */
function readPointList(ctx: RktContext, el: Element): [number, number][] {
  const raw = tag(el, 'PointList');
  if (!raw) return [];
  const out: [number, number][] = [];
  let at = 0;
  while (at <= raw.length) {
    if (out.length >= MAX_FIN_POINTS) {
      ctx.notes.push(keyedNote('importNote.finPointsCapped', { max: MAX_FIN_POINTS }));
      break;
    }
    const bar = raw.indexOf('|', at);
    const pair = raw.slice(at, bar === -1 ? raw.length : bar);
    const comma = pair.indexOf(',');
    if (comma !== -1) {
      const x = finiteNum(pair.slice(0, comma));
      const y = finiteNum(pair.slice(comma + 1));
      if (x !== undefined && y !== undefined) out.push([x / LENGTH, y / LENGTH]);
    }
    if (bar === -1) break;
    at = bar + 1;
  }
  return out;
}

const readTubeFinSet = (el: Element): ComponentNode => {
  const n = base(el, 'tubefinset', true);
  n['finCount'] = clampCount(num(el, 'TubeCount') ?? 6, 1, MAX_FIN_COUNT);
  put(n, 'length', mmPos(el, 'Len'));
  readTubeWall(el, n);
  readRadialAngle(el, n, 'angleOffset');
  return n;
};

/**
 * A recovery device's canopy density, in kg/m2.
 *
 * `RecoveryDeviceHandler.computeDensity` overrides the base conversion, because
 * RockSim states a chute or streamer material in whichever of its three density
 * kinds the material database happened to hold:
 *
 * - Surface is already per area, so it only changes unit.
 * - Line is per length, but RockSim ignores the thickness for it and treats it
 *   as a surface density, so it converts the same way.
 * - Bulk is per volume, so it has to be multiplied by the material's own
 *   `Thickness` to become per area. Skipping that would put a kg/m3 number in a
 *   kg/m2 field: a 0.05 mm mylar streamer at 1390 kg/m3 would fly at 1390 kg/m2
 *   instead of 0.0695.
 * - A zero density is a RockSim bug on these two parts, and the fallback is its
 *   own computed mass over the area, which needs the same thickness for bulk.
 */
function canopyDensity(el: Element, area: number): number | undefined {
  const type = densityType(el);
  const thickness = mmPos(el, 'Thickness');
  const raw = num(el, 'Density');
  if (raw !== undefined && raw > 0) {
    if (type !== 0) return raw / SURFACE_DENSITY;
    return thickness === undefined ? undefined : raw * thickness;
  }
  const calcMass = num(el, 'CalcMass');
  if (calcMass === undefined || !(area > 0)) return undefined;
  const perArea = Math.max(0, calcMass / MASS) / area;
  if (type !== 0) return perArea;
  return thickness === undefined ? undefined : perArea * thickness;
}

/**
 * Move the part material onto the canopy, since its `getMaterialType()` is SURFACE.
 *
 * `readCommon` put RockSim's `Material` and `Density` on the bulk keys, which is
 * what every other part wants; a recovery device's fabric is a surface density
 * and `canopyDensity` has already converted it.
 */
function applySurfaceMaterial(n: ComponentNode, density: number | undefined): void {
  if (density !== undefined) {
    n['surfaceDensity'] = density;
    n['surfaceMaterialName'] = n['materialName'];
  }
  delete n.density;
  delete n['materialName'];
}

/**
 * The radius a chute is packed at.
 *
 * RockSim has no packed size, so `ParachuteHandler` approximates one from the
 * tube the device sits in and uses it for both the radius and the length. The
 * kernel's own default is 12.5 mm, so without this a chute packed into a 54 mm
 * tube would carry its mass on a radius nobody chose.
 */
function packedRadius(parent: ComponentNode | undefined, diameter: number | undefined): number | undefined {
  const outer = typeof parent?.['outerRadius'] === 'number' ? parent['outerRadius'] : undefined;
  if (parent?.type === 'bodytube' && outer !== undefined) return outer * 0.9;
  if (parent?.type === 'innertube' && outer !== undefined) {
    const wall = typeof parent['thickness'] === 'number' ? parent['thickness'] : 0;
    return Math.max(0, outer - wall) * 0.9;
  }
  return diameter === undefined ? undefined : diameter * 0.025;
}

const readParachute = (el: Element, parent?: ComponentNode): ComponentNode => {
  const n = base(el, 'parachute', true);
  // Not a radius: OpenRocket's Parachute takes a diameter, and RockSim's `Dia`
  // is one, so this is the one circular field that converts by LENGTH.
  const diameter = mmPos(el, 'Dia');
  put(n, 'diameter', diameter);
  put(n, 'cd', num(el, 'DragCoefficient'));
  const lines = num(el, 'ShroudLineCount');
  if (lines !== undefined) n['lineCount'] = clampCount(lines, 1, MAX_LINE_COUNT);
  put(n, 'lineLength', mmPos(el, 'ShroudLineLen'));
  put(n, 'spillHoleDiameter', mmPos(el, 'SpillHoleDia'));
  const lineMaterial = tag(el, 'ShroudLineMaterial');
  if (lineMaterial) n['lineMaterialName'] = lineMaterial;
  // Despite the element's name, this is kg/m and passes straight through:
  // `ROCKSIM_TO_OPENROCKET_LINE_DENSITY` is 1 in both directions. The "PerMM"
  // is an upstream naming quirk, not a unit - scaling by 1000 here would make
  // every shroud line a thousand times too heavy.
  const lineDensity = num(el, 'ShroudLineMassPerMM');
  if (lineDensity !== undefined && lineDensity > 0) n['lineDensity'] = lineDensity;
  applySurfaceMaterial(n, canopyDensity(el, Math.PI * (diameter ?? 0) ** 2 * 0.25));
  const packed = packedRadius(parent, diameter);
  put(n, 'radius', packed);
  put(n, 'length', packed);
  return n;
};

const readStreamer = (el: Element): ComponentNode => {
  const n = base(el, 'streamer', true);
  const stripLength = mmPos(el, 'Len');
  const stripWidth = mmPos(el, 'Width');
  put(n, 'stripLength', stripLength);
  put(n, 'stripWidth', stripWidth);
  put(n, 'cd', num(el, 'DragCoefficient'));
  applySurfaceMaterial(n, canopyDensity(el, (stripLength ?? 0) * (stripWidth ?? 0)));
  return n;
};

/**
 * RockSim's packed-to-real length ratio for a shock cord
 * (`MassObjectHandler.MASS_LEN_FUDGE_FACTOR`). RockSim states one length for
 * both, so the packed one is invented.
 */
const CORD_PACKED_RATIO = 100;

/**
 * Whether a RockSim mass object is really a shock cord.
 *
 * `MassObjectHandler.inferAsShockCord`: the type code says so, or the object is
 * at least twice its parent's length and is made of a line material. The type
 * code alone is unreliable because of bugs in RockSim's own component and
 * material databases, so testing it alone would import most cords as mass
 * components.
 */
const isShockCord = (el: Element, parent: ComponentNode | undefined, len: number | undefined): boolean => {
  if (num(el, 'TypeCode') === 1) return true;
  const parentLen = typeof parent?.['length'] === 'number' ? parent['length'] : undefined;
  return len !== undefined && parentLen !== undefined && len >= 2 * parentLen && densityType(el) === 2;
};

const readMassObject = (el: Element, parent?: ComponentNode): ComponentNode => {
  const len = mmPos(el, 'Len');
  const shockCord = isShockCord(el, parent, len);
  const n = base(el, shockCord ? 'shockcord' : 'masscomponent', true);
  const mass = num(el, 'KnownMass');
  if (shockCord) {
    put(n, 'cordLength', len);
    // RockSim states one length for a cord and OpenRocket wants two, so the
    // packed length is the real one over the handler's own fudge factor.
    if (len !== undefined) n['length'] = len / CORD_PACKED_RATIO;
    // The cord's own line material, which `readCommon` left on the bulk keys.
    const lineDensity = typeof n.density === 'number' ? n.density : undefined;
    if (lineDensity !== undefined) {
      n['lineDensity'] = lineDensity;
      n['lineMaterialName'] = n['materialName'];
    } else if (mass !== undefined && len !== undefined && len > 0) {
      // No stated density, which upstream leaves weightless. A cord's mass is
      // its line density times its length and RockSim states the mass, so
      // derive it rather than flying a cord that weighs nothing.
      n['lineDensity'] = Math.max(0, mass / MASS / len);
    }
    delete n.density;
    delete n['materialName'];
    // Packed inside the tube it is stuffed into, as `mapMassObjectAsShockCord`
    // does for a coaxial parent.
    const bore = coaxialBore(parent);
    put(n, 'radius', bore ?? dia(el, 'Dia'));
  } else {
    put(n, 'length', len);
    if (mass !== undefined) n['mass'] = Math.max(0, mass / MASS);
    put(n, 'radius', dia(el, 'Dia'));
  }
  // RockSim measures a mass object's CG from the front of its parent, and that
  // is already carried in the object's own position, so keeping it as a CG
  // override counts it twice. `MassObjectHandler` zeroes it for exactly this
  // reason; the mass override stays, and equals the mass the object already has.
  if (n['overrideCGX'] !== undefined) n['overrideCGX'] = 0;
  return n;
};

/** A coaxial parent's bore, for a device packed inside it. */
function coaxialBore(parent: ComponentNode | undefined): number | undefined {
  if (!parent) return undefined;
  if (!['bodytube', 'innertube', 'tubecoupler', 'engineblock'].includes(parent.type)) return undefined;
  const outer = typeof parent['outerRadius'] === 'number' ? parent['outerRadius'] : undefined;
  if (outer === undefined) return undefined;
  const wall = typeof parent['thickness'] === 'number' ? parent['thickness'] : 0;
  return Math.max(0, outer - wall);
}

const readPod = (ctx: RktContext, el: Element): ComponentNode => {
  // A pod that separates is a strap-on booster, not a fixed pod.
  // `PodHandler.endHandler` moves the children into a ParallelStage, copies the
  // offsets and drops the podset, because a detachable or ejected RockSim pod
  // flies its own branch. A ParallelStage is an AxialStage for us too, so this
  // is the same part with a different type.
  const separates = tag(el, 'Detachable') === '1' || tag(el, 'Removed') === '1';
  const n = base(el, separates ? 'parallelstage' : 'podset', true);
  put(n, 'radiusOffset', mmPos(el, 'RadialLoc'));
  n['radiusMethod'] = 'free';
  readRadialAngle(el, n, 'angleOffset');
  n['instanceCount'] = 1;
  if (tag(el, 'Removed') === '1') {
    // Upstream marks the stage inactive in the selected configuration. A `.rkt`
    // declares no configurations for us to deactivate, so it is said instead.
    ctx.dropped.add('importNote.rktEjectedPod');
  }
  return n;
};

/**
 * Take the assembly's own roll angle off everything inside it.
 *
 * RockSim stores a pod child's angle in absolute coordinates and OpenRocket
 * stores it relative to the assembly, so `PodHandler.subtractAngleOffset` walks
 * the descendants and subtracts. Without it every part in a pod would be rotated
 * by the pod's angle twice, which moves its mass off the axis it should be on.
 * Stops at a nested assembly, which subtracts its own.
 */
function subtractAngleOffset(children: ComponentNode[], angle: number): void {
  for (const child of children) {
    if (typeof child['angleOffset'] === 'number') {
      child['angleOffset'] = child['angleOffset'] - angle;
    }
    if (child.type !== 'podset' && child.type !== 'parallelstage' && child.children) {
      subtractAngleOffset(child.children, angle);
    }
  }
}

// ------------------------------------------------------------------ walk ---

/**
 * `parent` is the node the part is attached to, which several handlers need: a
 * fin's tab depth is measured against a tapering body, a chute's packed radius
 * against the tube it is stuffed in, and a mass object is only recognized as a
 * shock cord by comparing its length with its parent's.
 */
type Reader = (ctx: RktContext, el: Element, parent?: ComponentNode) => ComponentNode;

const READERS: Record<string, Reader> = {
  NoseCone: (_c, el) => readNoseCone(el),
  BodyTube: (_c, el) => readBodyTube(el),
  Transition: (_c, el) => readTransition(el),
  Ring: (_c, el) => readRing(el),
  LaunchLug: (_c, el) => readLaunchLug(el),
  FinSet: readFinSet,
  CustomFinSet: readFinSet,
  TubeFinSet: (_c, el) => readTubeFinSet(el),
  Parachute: (_c, el, parent) => readParachute(el, parent),
  Streamer: (_c, el) => readStreamer(el),
  MassObject: (_c, el, parent) => readMassObject(el, parent),
  ExternalPod: readPod,
};

/**
 * The parts under one container, in file order.
 *
 * RockSim nests two ways at once: a stage's axial parts are direct children of
 * `StageNParts`, while everything mounted on a part sits in that part's
 * `<AttachedParts>`. Both are walked here, attached parts second, so a tube's
 * rings and fins follow it the way the tree expects.
 *
 * `SubAssembly` is transparent: RockSim uses it to group a reusable chunk of
 * design, and we have no equivalent, so its contents are inlined into the
 * parent rather than dropped.
 */
function readParts(ctx: RktContext, container: Element, depth = 0, parent?: ComponentNode): ComponentNode[] {
  checkDepth(depth, '.rkt');
  const out: ComponentNode[] = [];
  for (const el of Array.from(container.children)) {
    if (el.tagName === 'AttachedParts') {
      out.push(...readParts(ctx, el, depth + 1, parent));
      continue;
    }
    if (el.tagName === 'SubAssembly') {
      ctx.dropped.add('importNote.rktSubassembly');
      out.push(...readParts(ctx, el, depth + 1, parent));
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
    // Counted here rather than in each reader: this is the one place every
    // part enters the tree, whatever its type.
    countComponent(ctx, '.rkt');
    const node = read(ctx, el, parent);
    if (parent !== undefined && FREEFORM_ONLY_PARENTS.has(parent.type)) {
      if (node.type === 'trapezoidfinset') {
        node['points'] = trapezoidOutline(node);
        delete node['rootChord'];
        delete node['tipChord'];
        delete node['height'];
        delete node['sweep'];
        node.type = 'freeformfinset';
      } else if (node.type === 'ellipticalfinset') {
        // Desktop refuses it too. Named in the notes rather than dropped
        // silently, so the user knows the fin set is missing.
        ctx.dropped.add('importNote.rktEllipticalOnBody');
        continue;
      }
    }
    const kids = readParts(ctx, el, depth + 1, node);
    if (kids.length > 0) node.children = kids;
    // An assembly's children carry absolute roll angles in the file.
    if (isAssembly(node.type) && node.children) {
      subtractAngleOffset(node.children, numOpt(node, 'angleOffset') ?? 0);
    }
    out.push(node);
  }
  return out;
}

/** Parts RockSim has and we do not, named so the banner says what was lost. */
const KNOWN_UNSUPPORTED = new Set(['RingTail']);

// ------------------------------------------------------------------ entry ---

/** RockSim numbers its stages from the nose down: 3 is the sustainer. */
const STAGE_ELEMENTS = ['Stage3Parts', 'Stage2Parts', 'Stage1Parts'] as const;

/**
 * The per-stage mass and CG RockSim states on the design, nose down to match
 * `STAGE_ELEMENTS`. The CG tags are not named alike: the sustainer's is
 * `Stage3CG` and the boosters' are `…CGAlone`, as `RockSimHandler` reads them.
 */
const STAGE_MASS_ELEMENTS = ['Stage3Mass', 'Stage2Mass', 'Stage1Mass'] as const;
const STAGE_CG_ELEMENTS = ['Stage3CG', 'Stage2CGAlone', 'Stage1CGAlone'] as const;

/**
 * Read a `.rkt` into the same result shape `importOrk` produces, so every
 * caller downstream (`loadOrk`, `wireLoadedOrk`, the loaded-design banner)
 * takes it unchanged.
 */
export function importRkt(data: ArrayBuffer | string): OrkImportResult {
  const xml = typeof data === 'string' ? data : decodeFileText(new Uint8Array(data));
  const doc = parseOrkXml(xml, '.rkt');
  const design = doc.querySelector('RockSimDocument > DesignInformation > RocketDesign');
  if (!design) throw new Error('Not a .rkt file (missing <RocketDesign>)');

  const name = tag(design, 'Name') ?? 'Imported rocket';
  const ctx: RktContext = { notes: [], ignored: new Set(), dropped: new Set(), nodeCount: 0 };

  // `StageCount` decides how many of the three blocks are real: RockSim leaves
  // the unused ones in the file, empty, and reading them anyway would add empty
  // booster stages to every single-stage design.
  // Counted from the nose: `RockSimHandler` always reads Stage3Parts, takes
  // Stage2Parts only when the count is 2 or more and Stage1Parts only at 3. A
  // single-stage design therefore lives in Stage3Parts, not Stage1Parts.
  const stageCount = clampCount(num(design, 'StageCount') ?? 1, 1, STAGE_ELEMENTS.length);
  const present = STAGE_ELEMENTS.slice(0, stageCount);

  const components: ComponentNode[] = [];
  present.forEach((elName, i) => {
    const stageEl = design.querySelector(`:scope > ${elName}`);
    countComponent(ctx, '.rkt');
    const stage: ComponentNode = {
      type: 'stage',
      id: freshId(),
      name: defaultStageName(i),
    };
    /**
     * RockSim's own figure for the whole stage, as a stage-level override.
     *
     * `RockSimHandler.openElement` applies each one when it is positive, with
     * "apply to subcomponents" on. RockSim has no such concept; it is
     * upstream's way of saying the number covers the stage rather than the empty
     * stage object. Without them every imported design would fly at our own
     * computed mass instead of the one its author measured.
     */
    const stageMass = num(design, STAGE_MASS_ELEMENTS[i]!);
    if (stageMass !== undefined && stageMass > 0) {
      stage['overrideMass'] = stageMass / MASS;
      stage['overrideSubcomponentsMass'] = true;
    }
    const stageCg = mm(design, STAGE_CG_ELEMENTS[i]!);
    if (stageCg !== undefined && stageCg > 0) {
      stage['overrideCGX'] = stageCg;
      stage['overrideSubcomponentsCG'] = true;
    }
    const kids = stageEl ? readParts(ctx, stageEl) : [];
    if (kids.length > 0) stage.children = kids;
    components.push(stage);
  });

  if (components.every((s) => (s.children ?? []).length === 0)) {
    throw new Error('No supported components found in this design.');
  }

  const notes = [...ctx.notes];
  notes.push(...ignoredNotes(ctx.ignored));
  for (const d of ctx.dropped) notes.push(keyedNote(d));
  // Said on every import, because it is the difference a user will notice first
  // and it is not a fault in the file: RockSim keeps its motor selections and
  // launch setup with its simulations, which are not a design.
  notes.push(keyedNote('importNote.rocksimNoMotors'));

  return {
    name,
    // Automatic radii resolved on load, as importOrk does, so every reader
    // sees a number and the kernel and the drawing agree on it.
    tree: syncAutoRadii({ name, components }),
    motors: {},
    // A `.rkt` declares no flight configurations; RockSim's equivalent lives
    // with its simulations. Stated as an empty table rather than omitted so
    // this result is interchangeable with `importOrk`'s everywhere downstream.
    configs: [],
    chosenConfigId: null,
    ignored: [...ctx.ignored],
    notes,
  };
}
