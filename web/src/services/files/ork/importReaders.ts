import type { ComponentNode, ComponentType } from '../../../engine/openRocketEngine';
import { defaultStageName, freshId } from '../../design/orkTree';
import { shapeParamDefault } from '../../../tree/shapeProfile';
import { xmlText as text } from '../xmlUtil';
import { keyedNote, notePartName } from '../importNote';
import { COMPONENT_DEFAULTS } from '../../design/componentDefaults';
import { RAIL_BUTTON_FALLBACK, settleRailButtonLoad, settleRingOuterLoad } from '../../design/linkedDimensions';
import { clampCount, finiteNum } from './numbers';
import { MAX_ASSEMBLY_INSTANCES, MAX_FIN_POINTS, MAX_LINE_COUNT, checkDepth, countComponent } from './importLimits';
import {
  autoRadiusTag,
  crossSectionTag,
  finCountTag,
  isDrogueTag,
  nonNegTag,
  numTag,
  readAirfoil,
  readAngleAroundBody,
  readAutoPackedRadius,
  readCommon,
  readDeployment,
  readFinRotation,
  readFinTabs,
  readInstances,
  readPackedSize,
  readSeparation,
  readAutoValue,
  readSoftMaterial,
  shapeTag,
} from './importTags';
import {
  captureDeployments,
  captureSeparations,
  configScoped,
  readMotor,
  type OrkImportContext,
} from './importConfigs';
import { degToRad } from '../../../prefs/units';
import { KERNEL_DEFAULTS } from '../../../tree/kernelDefaults';
import { finCant } from '../../../tree/nodeProps';

/**
 * One reader per .ork element tag: the node the element becomes, before its
 * children. `convertChildren` walks a <subcomponents> through the table and
 * `readStages` builds the top-level stage nodes.
 */

/** Builds the node for one element (its children are read by the caller). */
type NodeReader = (ctx: OrkImportContext, el: Element) => ComponentNode;

const base = (ctx: OrkImportContext, el: Element, type: ComponentType, withPosition: boolean): ComponentNode => {
  const node: ComponentNode = { type, id: freshId() };
  readCommon(el, node, withPosition, ctx.notes);
  return node;
};

// Desktop writes <thickness>filled</thickness> for solid components.
const readThicknessOrFilled = (el: Element, n: ComponentNode, fallback: number) => {
  if (text(el, ':scope > thickness') === 'filled') {
    n['filled'] = true;
  } else {
    n['thickness'] = nonNegTag(el, 'thickness', fallback);
  }
};

const readCant = (ctx: OrkImportContext, el: Element, n: ComponentNode) => {
  // Clamped as FinSet.setCantAngle clamps it, so the panel shows the cant that flies.
  const cant = finCant({ type: n.type, cant: degToRad(numTag(el, 'cant', 0)) });
  if (cant !== 0) n['cant'] = cant;
  const cs = crossSectionTag(el, n, ctx.notes);
  if (cs && cs !== 'square') n['crossSection'] = cs;
};

/** A <cd> that is a number: ignore `auto` and a garbage value rather than store (and re-export) NaN. */
const readCd = (el: Element, n: ComponentNode) => {
  const cdText = text(el, ':scope > cd');
  if (cdText === 'auto') {
    n['cdAuto'] = true;
    return;
  }
  if (cdText) {
    const cdv = Number(cdText);
    if (Number.isFinite(cdv)) n['cd'] = cdv;
  }
};

/** Off-axis placement: <radialposition> (m) + <radialdirection> (deg → rad), only kept when non-zero. */
const readRadial = (el: Element, n: ComponentNode) => {
  // A distance from the axis, so floored; the direction beside it is an angle.
  const radPos = nonNegTag(el, 'radialposition', 0);
  if (radPos !== 0) n['radialPosition'] = radPos;
  const radDir = numTag(el, 'radialdirection', 0);
  if (radDir !== 0) n['radialDirection'] = degToRad(radDir);
};

const readNosecone: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'nosecone', false);
  n['length'] = nonNegTag(el, 'length', COMPONENT_DEFAULTS.nosecone.length);
  const ncR = autoRadiusTag(el, 'aftradius');
  if (ncR === undefined) n['aftRadiusAuto'] = true;
  n['aftRadius'] = ncR ?? COMPONENT_DEFAULTS.nosecone.aftRadius;
  readThicknessOrFilled(el, n, COMPONENT_DEFAULTS.nosecone.thickness);
  n['shape'] = shapeTag(el, n, ctx.notes, 'ogive');
  n['shapeParameter'] = nonNegTag(el, 'shapeparameter', shapeParamDefault(String(n['shape'])));
  const shR = numTag(el, 'aftshoulderradius', 0);
  const shL = numTag(el, 'aftshoulderlength', 0);
  if (shR > 0) n['shoulderRadius'] = shR;
  if (shL > 0) n['shoulderLength'] = shL;
  const shT = numTag(el, 'aftshoulderthickness', 0);
  if (shT > 0) n['shoulderThickness'] = shT;
  if (text(el, ':scope > aftshouldercapped') === 'true') n['shoulderCapped'] = true;
  // A flipped nose cone is a tail cone; read so it keeps its orientation
  // through a round trip.
  if (text(el, ':scope > isflipped') === 'true') n['flipped'] = true;
  return n;
};

const readTransition: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'transition', false);
  n['length'] = nonNegTag(el, 'length', COMPONENT_DEFAULTS.transition.length);
  const fore = autoRadiusTag(el, 'foreradius');
  const aft = autoRadiusTag(el, 'aftradius');
  if (fore === undefined) n['foreRadiusAuto'] = true;
  else n['foreRadius'] = fore;
  if (aft === undefined) n['aftRadiusAuto'] = true;
  else n['aftRadius'] = aft;
  readThicknessOrFilled(el, n, COMPONENT_DEFAULTS.transition.thickness);
  n['shape'] = shapeTag(el, n, ctx.notes, 'conical');
  n['shapeParameter'] = nonNegTag(el, 'shapeparameter', shapeParamDefault(String(n['shape'])));
  // <shapeclipped>: clipped vs full profile (ellipsoid/power/haack).
  // Forwarded to the kernel bridge as 'clipped'; absent keeps the
  // kernel default (clipped, matching the desktop).
  const clip = text(el, ':scope > shapeclipped');
  if (clip === 'true' || clip === 'false') n['clipped'] = clip === 'true';
  for (const [side, key] of [
    ['fore', 'foreShoulder'],
    ['aft', 'aftShoulder'],
  ] as const) {
    const r = numTag(el, `${side}shoulderradius`, 0);
    const l = numTag(el, `${side}shoulderlength`, 0);
    if (r > 0) n[`${key}Radius`] = r;
    if (l > 0) n[`${key}Length`] = l;
    const th = numTag(el, `${side}shoulderthickness`, 0);
    if (th > 0) n[`${key}Thickness`] = th;
    // A capped shoulder is closed by a disc of the part's own material. Read
    // per side, since a transition has two.
    if (text(el, `:scope > ${side}shouldercapped`) === 'true') n[`${key}Capped`] = true;
  }
  return n;
};

const readBodytube: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'bodytube', false);
  const bt = COMPONENT_DEFAULTS.bodytube;
  n['length'] = nonNegTag(el, 'length', bt.length);
  const btR = autoRadiusTag(el, 'radius');
  if (btR === undefined) n['outerRadiusAuto'] = true;
  n['outerRadius'] = btR ?? bt.outerRadius;
  readThicknessOrFilled(el, n, bt.thickness);
  readMotor(ctx, el, n);
  // Extension tag: sub-minimum flag (motor case is the airframe).
  if (text(el, ':scope > caseairframe') === 'true') n['caseAirframe'] = true;
  return n;
};

/** What every planar fin set has after its outline: wall, cant, section, tab and rotation. */
function readPlanarFin(ctx: OrkImportContext, el: Element, n: ComponentNode): void {
  n['thickness'] = nonNegTag(el, 'thickness', COMPONENT_DEFAULTS.finset.thickness);
  readCant(ctx, el, n);
  readAirfoil(el, n);
  readFinTabs(el, n);
  readFinRotation(el, n);
}

const readTrapezoidFinset: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'trapezoidfinset', true);
  n['finCount'] = finCountTag(el);
  const fin = COMPONENT_DEFAULTS.trapezoidfinset;
  n['rootChord'] = nonNegTag(el, 'rootchord', fin.rootChord);
  n['tipChord'] = nonNegTag(el, 'tipchord', fin.tipChord);
  // Signed, and the only fin dimension that is: a negative sweep is a
  // forward-swept fin, which is a real shape the desktop draws.
  n['sweep'] = numTag(el, 'sweeplength', fin.sweep);
  n['height'] = nonNegTag(el, 'height', fin.height);
  readPlanarFin(ctx, el, n);
  return n;
};

const readFreeformFinset: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'freeformfinset', true);
  n['finCount'] = finCountTag(el);
  readPlanarFin(ctx, el, n);
  // Capped: every renderer walks the outline per fin, so a crafted file
  // with a million <point>s is a frozen tab. A real freeform fin has tens.
  // Walked by sibling links and stopped at the cap, rather than selecting the
  // whole list first. Indexing a live `children` collection is O(n) per
  // access in jsdom (so O(n^2) over the list), and a selector materializes
  // every point before the cap can slice; the sibling walk is O(cap) in
  // every DOM. A missing x/y attribute must skip the point (Number(null) is
  // 0, which would silently drop a vertex onto the origin), and say so, as
  // desktop's FinSetPointHandler warns for each point it cannot read.
  const pts: [number, number][] = [];
  const finpoints = el.querySelector(':scope > finpoints');
  if (finpoints) {
    let seen = 0;
    let unreadable = 0;
    let pt = finpoints.firstElementChild;
    for (; pt && seen < MAX_FIN_POINTS; pt = pt.nextElementSibling) {
      if (pt.tagName !== 'point') continue;
      seen++;
      const x = finiteNum(pt.getAttribute('x'));
      const y = finiteNum(pt.getAttribute('y'));
      if (x !== undefined && y !== undefined) pts.push([x, y]);
      else unreadable++;
    }
    if (unreadable > 0) {
      ctx.notes.push(keyedNote('importNote.finPointsUnreadable', { part: notePartName(n), count: unreadable }));
    }
    // A point past the cap is a dropped vertex, and the outline the user sees
    // is not the file's, so the import says so.
    for (; pt; pt = pt.nextElementSibling) {
      if (pt.tagName === 'point') {
        ctx.notes.push(keyedNote('importNote.finPointsCapped', { max: MAX_FIN_POINTS }));
        break;
      }
    }
  }
  // Fewer than three points is no outline: the node carries none, the kernel
  // flies its default freeform outline, and the user is told.
  if (pts.length >= 3) n['points'] = pts;
  else ctx.notes.push(keyedNote('importNote.finPointsTooFew', { part: notePartName(n) }));
  return n;
};

const readEllipticalFinset: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'ellipticalfinset', true);
  n['finCount'] = finCountTag(el);
  const fin = COMPONENT_DEFAULTS.ellipticalfinset;
  n['rootChord'] = nonNegTag(el, 'rootchord', fin.rootChord);
  n['height'] = nonNegTag(el, 'height', fin.height);
  readPlanarFin(ctx, el, n);
  return n;
};

const readTubeFinset: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'tubefinset', true);
  n['finCount'] = finCountTag(el, COMPONENT_DEFAULTS.tubefinset.finCount);
  n['length'] = nonNegTag(el, 'length', COMPONENT_DEFAULTS.tubefinset.length);
  const r = autoRadiusTag(el, 'radius');
  if (r === undefined) n['outerRadiusAuto'] = true;
  else n['outerRadius'] = r;
  const th = numTag(el, 'thickness', NaN);
  if (th >= 0) n['thickness'] = th;
  readFinRotation(el, n);
  return n;
};

const readInnertube: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'innertube', true);
  const it = COMPONENT_DEFAULTS.innertube;
  n['length'] = nonNegTag(el, 'length', it.length);
  n['outerRadius'] = nonNegTag(el, 'outerradius', it.outerRadius);
  n['thickness'] = nonNegTag(el, 'thickness', it.thickness);
  // Cluster (desktop stores rotation in degrees; we keep radians).
  const cluster = text(el, ':scope > clusterconfiguration');
  if (cluster && cluster !== 'single') {
    n['cluster'] = cluster;
    n['clusterScale'] = nonNegTag(el, 'clusterscale', 1);
    n['clusterRotation'] = (numTag(el, 'clusterrotation', 0) * Math.PI) / 180;
  }
  // Off-axis / split-cluster offset: desktop splits a cluster into single
  // tubes, each carrying its position as <radialposition> (meters) +
  // <radialdirection> (degrees). We keep the direction in radians (like
  // angleOffset) and only carry non-zero values so a centered tube stays
  // clean. Without this, every off-center tube would collapse onto the
  // centerline and the next save would make it permanent.
  readRadial(el, n);
  // Our extension tag: the mount's physical motor-length limit.
  const mml = numTag(el, 'maxmotorlength', 0);
  if (mml > 0) n['maxMotorLength'] = mml;
  readMotor(ctx, el, n);
  return n;
};

const readTubecoupler: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'tubecoupler', true);
  n['length'] = nonNegTag(el, 'length', COMPONENT_DEFAULTS.tubecoupler.length);
  n['thickness'] = nonNegTag(el, 'thickness', COMPONENT_DEFAULTS.tubecoupler.thickness);
  readRadial(el, n);
  const or = autoRadiusTag(el, 'outerradius');
  if (or === undefined) n['outerRadiusAuto'] = true;
  if (or !== undefined) n['outerRadius'] = or;
  return n;
};

const readCenteringring: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'centeringring', true);
  n['length'] = nonNegTag(el, 'length', COMPONENT_DEFAULTS.centeringring.length);
  readRadial(el, n);
  const cor = autoRadiusTag(el, 'outerradius');
  if (cor === undefined) n['outerRadiusAuto'] = true;
  const cir = autoRadiusTag(el, 'innerradius');
  if (cir === undefined) n['innerRadiusAuto'] = true;
  if (cir !== undefined) n['innerRadius'] = cir;
  // The inner radius's setter raises the outer to meet it, as the desktop
  // loader runs it.
  if (cor !== undefined) n['outerRadius'] = cir === undefined ? cor : settleRingOuterLoad(cor, cir);
  readInstances(el, n);
  return n;
};

const readBulkhead: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'bulkhead', true);
  n['length'] = nonNegTag(el, 'length', COMPONENT_DEFAULTS.bulkhead.length);
  readRadial(el, n);
  // No inner radius: a bulkhead is solid, and upstream's saver omits the
  // element for one entirely (RadiusRingComponentSaver).
  const bor = autoRadiusTag(el, 'outerradius');
  if (bor === undefined) n['outerRadiusAuto'] = true;
  if (bor !== undefined) n['outerRadius'] = bor;
  readInstances(el, n);
  return n;
};

const readEngineblock: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'engineblock', true);
  n['length'] = nonNegTag(el, 'length', COMPONENT_DEFAULTS.engineblock.length);
  n['thickness'] = nonNegTag(el, 'thickness', COMPONENT_DEFAULTS.engineblock.thickness);
  readRadial(el, n);
  const eor = autoRadiusTag(el, 'outerradius');
  if (eor === undefined) n['outerRadiusAuto'] = true;
  if (eor !== undefined) n['outerRadius'] = eor;
  return n;
};

const readLaunchlug: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'launchlug', true);
  const lug = COMPONENT_DEFAULTS.launchlug;
  n['length'] = nonNegTag(el, 'length', lug.length);
  n['outerRadius'] = nonNegTag(el, 'radius', lug.outerRadius);
  n['thickness'] = nonNegTag(el, 'thickness', lug.thickness);
  n['angleOffset'] = readAngleAroundBody(el);
  readInstances(el, n);
  return n;
};

const readRailbutton: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'railbutton', true);
  const rb = COMPONENT_DEFAULTS.railbutton;
  // The rest of the button's geometry (RailButtonSaver.java writes all six)
  // and its material. The kernel bridge flies them; the writer falls back to
  // the desktop's constructor constants only when the node carries none, so
  // hard-writing those constants and a Delrin material would bring a 1010
  // button sized by hand on the desktop back from a save as the stock one. The
  // setters clamp the heights and bore against each other as they load, so a
  // pair that disagrees arrives as the desktop holds it. Only carried when they differ from the defaults the
  // writer falls back to, so an untouched design stays clean.
  const read: Partial<Record<keyof typeof RAIL_BUTTON_FALLBACK, number>> = {
    outerDiameter: nonNegTag(el, 'outerdiameter', rb.outerDiameter),
  };
  for (const [tag, key] of [
    ['innerdiameter', 'innerDiameter'],
    ['height', 'height'],
    ['baseheight', 'baseHeight'],
    ['flangeheight', 'flangeHeight'],
    ['screwheight', 'screwHeight'],
  ] as const) {
    const v = numTag(el, tag, NaN);
    if (v >= 0) read[key] = v;
  }
  const settled = settleRailButtonLoad(read);
  n['outerDiameter'] = settled.outerDiameter;
  for (const key of ['innerDiameter', 'height', 'baseHeight', 'flangeHeight', 'screwHeight'] as const) {
    if (settled[key] !== rb[key]) n[key] = settled[key];
  }
  n['angleOffset'] = readAngleAroundBody(el);
  readInstances(el, n);
  return n;
};

// Our extension element (the camera shroud): the desktop warns about the
// unknown element and skips it. Nothing in the editor can create a fairing, so
// this only ever reads one back out of a file this app wrote. See openRocketEngine.ts ComponentType.
const readFairing: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'fairing', true);
  const fr = COMPONENT_DEFAULTS.fairing;
  n['length'] = nonNegTag(el, 'length', fr.length);
  n['width'] = nonNegTag(el, 'width', fr.width);
  n['height'] = nonNegTag(el, 'height', fr.height);
  const fs = text(el, ':scope > fairingshape');
  if (fs) n['fairingShape'] = fs;
  n['mass'] = nonNegTag(el, 'mass', fr.mass);
  return n;
};

/** A recovery device's role and when it comes out. */
function readRecoveryDeployment(ctx: OrkImportContext, el: Element, n: ComponentNode): void {
  // Drogue or main. The desktop writes <isdrogue> only when it is true, and
  // the kernel needs it to tell dual deployment from single: without it every
  // flight takes the single-deployment branch.
  if (isDrogueTag(el)) n['drogue'] = true;
  // The design's value is the bare tags. A configuration's
  // <deploymentconfiguration> is that configuration's override, recorded on
  // it by captureDeployments; with no declarations a stray block is not read.
  readDeployment(el, n, ctx.notes);
  captureDeployments(ctx, el, n);
}

/**
 * The separation block that sets the design's own value: none when the file
 * declares configurations, since each block is then its configuration's
 * override (captureSeparations), and the first block when it declares none,
 * because there is no configuration to hold it.
 */
function undeclaredSeparation(ctx: OrkImportContext, el: Element): Element | null {
  return ctx.chosenConfigId === null ? configScoped(ctx, el, 'separationconfiguration') : null;
}

const readParachute: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'parachute', true);
  readPackedSize(el, n);
  readRadial(el, n);
  const chute = COMPONENT_DEFAULTS.parachute;
  n['diameter'] = nonNegTag(el, 'diameter', chute.diameter);
  readCd(el, n);
  // Bounded: the kernel sums line mass per line, and a file can say anything.
  // From 0: a parachute may have no lines (`Parachute.setLineCount`).
  n['lineCount'] = clampCount(numTag(el, 'linecount', chute.lineCount), 0, MAX_LINE_COUNT);
  if (!readAutoValue(el, n, 'linelength', 'lineLengthAuto'))
    n['lineLength'] = nonNegTag(el, 'linelength', chute.lineLength);
  readSoftMaterial(el, n, 'surface', 'surfaceDensity', 'surfaceMaterialName');
  readSoftMaterial(el, n, 'line', 'lineDensity', 'lineMaterialName', ':scope > linematerial');
  readRecoveryDeployment(ctx, el, n);
  // Our extension tag (desktop warns-and-ignores): spill hole diameter.
  const spill = numTag(el, 'spillholediameter', 0);
  if (spill > 0) n['spillHoleDiameter'] = spill;
  return n;
};

const readStreamer: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'streamer', true);
  readPackedSize(el, n);
  readRadial(el, n);
  n['stripLength'] = nonNegTag(el, 'striplength', COMPONENT_DEFAULTS.streamer.stripLength);
  n['stripWidth'] = nonNegTag(el, 'stripwidth', COMPONENT_DEFAULTS.streamer.stripWidth);
  readCd(el, n);
  readSoftMaterial(el, n, 'surface', 'surfaceDensity', 'surfaceMaterialName');
  readRecoveryDeployment(ctx, el, n);
  return n;
};

const readShockcord: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'shockcord', true);
  readPackedSize(el, n);
  readRadial(el, n);
  if (!readAutoValue(el, n, 'cordlength', 'cordLengthAuto'))
    n['cordLength'] = nonNegTag(el, 'cordlength', COMPONENT_DEFAULTS.shockcord.cordLength);
  readSoftMaterial(el, n, 'line', 'lineDensity', 'lineMaterialName');
  return n;
};

const readMasscomponent: NodeReader = (ctx, el) => {
  const n = base(ctx, el, 'masscomponent', true);
  const mc = COMPONENT_DEFAULTS.masscomponent;
  n['mass'] = nonNegTag(el, 'mass', mc.mass);
  n['length'] = nonNegTag(el, 'packedlength', mc.length);
  n['radius'] = mc.radius;
  if (!readAutoPackedRadius(el, n)) n['radius'] = nonNegTag(el, 'packedradius', mc.radius);
  // Preserve-through: what kind of mass this is (altimeter, payload…).
  // No mass/CG effect, but the desktop shows it and users set it there.
  const mct = text(el, ':scope > masscomponenttype');
  if (mct && mct !== 'masscomponent') n['massComponentType'] = mct;
  // Off-axis placement: <radialposition> (m) + <radialdirection> (deg → rad),
  // only kept when non-zero so a centered mass stays clean.
  readRadial(el, n);
  return n;
};

// Off-axis assemblies. <podset> = external pods (non-separating, always
// relative angle); <parallelstage> / legacy <boosterset> = strap-on
// boosters (separating). The nested nose/body/fin chain imports via
// convertChildren (the caller recurses).
const readAssembly =
  (asmType: 'podset' | 'parallelstage'): NodeReader =>
  (ctx, el) => {
    const n = base(ctx, el, asmType, true); // name + overrides + axialoffset/position
    n['instanceCount'] = clampCount(
      // Absent, the count `new PodSet()` and `new ParallelStage()` start with.
      numTag(el, 'instancecount', KERNEL_DEFAULTS[asmType].instanceCount),
      1,
      MAX_ASSEMBLY_INSTANCES,
    );
    const radEl = el.querySelector(':scope > radiusoffset');
    if (radEl) {
      n['radiusOffset'] = finiteNum(radEl.textContent) ?? 0; // meters, no conversion
      n['radiusMethod'] = (radEl.getAttribute('method') ?? 'relative').toLowerCase() === 'free' ? 'free' : 'relative';
    }
    const angEl = el.querySelector(':scope > angleoffset');
    if (angEl) {
      n['angleOffset'] = ((finiteNum(angEl.textContent) ?? 0) * Math.PI) / 180; // deg → rad, like cant
      if (asmType === 'parallelstage') {
        n['angleMethod'] =
          (angEl.getAttribute('method') ?? 'relative').toLowerCase() === 'fixed' ? 'fixed' : 'relative';
      }
    }
    if (asmType === 'parallelstage') {
      // Same separation read as a booster <stage>.
      readSeparation(el, n, undeclaredSeparation(ctx, el), ctx.notes);
      captureSeparations(ctx, el, n);
    }
    return n;
  };

/** The per-tag reader table; an element with no entry is reported as ignored. */
const NODE_READERS: Record<string, NodeReader> = {
  nosecone: readNosecone,
  transition: readTransition,
  bodytube: readBodytube,
  trapezoidfinset: readTrapezoidFinset,
  freeformfinset: readFreeformFinset,
  ellipticalfinset: readEllipticalFinset,
  tubefinset: readTubeFinset,
  innertube: readInnertube,
  tubecoupler: readTubecoupler,
  centeringring: readCenteringring,
  bulkhead: readBulkhead,
  engineblock: readEngineblock,
  launchlug: readLaunchlug,
  railbutton: readRailbutton,
  fairing: readFairing,
  parachute: readParachute,
  streamer: readStreamer,
  shockcord: readShockcord,
  masscomponent: readMasscomponent,
  podset: readAssembly('podset'),
  parallelstage: readAssembly('parallelstage'),
  boosterset: readAssembly('parallelstage'),
};

/** The nodes under `parentEl`'s <subcomponents>, recursively. */
function convertChildren(ctx: OrkImportContext, parentEl: Element, depth = 0): ComponentNode[] {
  checkDepth(depth, '.ork');
  const out: ComponentNode[] = [];
  const wrap = parentEl.querySelector(':scope > subcomponents');
  if (!wrap) return out;
  for (const el of Array.from(wrap.children)) {
    const read = Object.prototype.hasOwnProperty.call(NODE_READERS, el.tagName) ? NODE_READERS[el.tagName] : undefined;
    if (!read) {
      ctx.ignored.add(el.tagName);
      continue;
    }
    // Counted here rather than in each reader: this is the one place every
    // child component enters the tree, whatever its type.
    countComponent(ctx, '.ork');
    const node = read(ctx, el);
    const kids = convertChildren(ctx, el, depth + 1);
    if (kids.length > 0) node.children = kids;
    out.push(node);
  }
  return out;
}

/**
 * Every stage imports, each as a stage node carrying its separation config
 * (desktop writes defaults bare under <stage>).
 */
export function readStages(ctx: OrkImportContext, stages: Element[]): ComponentNode[] {
  return stages.map((stageEl, i) => {
    countComponent(ctx, '.ork');
    const stage: ComponentNode = {
      type: 'stage',
      id: freshId(),
      name: text(stageEl, ':scope > name') ?? defaultStageName(i),
    };
    // What every component carries (comment, line style, color, overrides and
    // the appearance kept as passthrough), as RocketComponentSaver writes it
    // for a stage too. A stage has no axial position of its own.
    readCommon(stageEl, stage, false, ctx.notes);
    stage.name = text(stageEl, ':scope > name') ?? defaultStageName(i);
    // RASAero power-on base-drag input (meters), every stage incl. sustainer.
    const nozzle = numTag(stageEl, 'nozzleexitdiameter', NaN);
    if (!Number.isNaN(nozzle) && nozzle > 0) stage['nozzleExitDiameter'] = nozzle;
    if (i > 0) {
      // The design's value is the bare tags. 24.12 writes a
      // <separationconfiguration> for each configuration that overrides the
      // default, and captureSeparations records it on that configuration.
      readSeparation(stageEl, stage, undeclaredSeparation(ctx, stageEl), ctx.notes);
      captureSeparations(ctx, stageEl, stage);
    }
    const kids = convertChildren(ctx, stageEl);
    if (kids.length > 0) stage.children = kids;
    return stage;
  });
}
