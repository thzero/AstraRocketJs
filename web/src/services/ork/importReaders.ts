import type { ComponentNode, ComponentType } from '../../engine/openRocketEngine';
import { freshId } from '../orkTree';
import { shapeParamDefault } from '../../tree/shapeProfile';
import { xmlText as text } from '../xmlUtil';
import { COMPONENT_DEFAULTS } from '../componentDefaults';
import { clampCount, finiteNum } from './numbers';
import { MAX_ASSEMBLY_INSTANCES, MAX_FIN_POINTS, MAX_LINE_COUNT, MAX_NESTING_DEPTH } from './importLimits';
import {
  autoRadiusTag,
  finCountTag,
  isDrogueTag,
  numTag,
  readAirfoil,
  readAngleAroundBody,
  readCommon,
  readDeployment,
  readFinRotation,
  readFinTabs,
  readInstances,
  readMaterialGroup,
  readPackedSize,
  readSeparation,
  readSoftMaterial,
} from './importTags';
import { captureDeployments, configScoped, readMotor, type OrkImportContext } from './importConfigs';

/**
 * One reader per .ork element tag: the node the element becomes, before its
 * children. `convertChildren` walks a <subcomponents> through the table and
 * `readStages` builds the top-level stage nodes.
 */

/** Builds the node for one element (its children are read by the caller). */
export type NodeReader = (ctx: OrkImportContext, el: Element) => ComponentNode;

const base = (el: Element, type: ComponentType, withPosition: boolean): ComponentNode => {
  const node: ComponentNode = { type, id: freshId() };
  readCommon(el, node, withPosition);
  return node;
};

// Desktop writes <thickness>filled</thickness> for solid components.
const readThicknessOrFilled = (el: Element, n: ComponentNode, fallback: number) => {
  if (text(el, ':scope > thickness') === 'filled') {
    n['filled'] = true;
  } else {
    n['thickness'] = numTag(el, 'thickness', fallback);
  }
};

const readCant = (el: Element, n: ComponentNode) => {
  const cantDeg = numTag(el, 'cant', 0);
  if (cantDeg !== 0) n['cant'] = (cantDeg * Math.PI) / 180;
  const cs = text(el, ':scope > crosssection');
  if (cs && cs !== 'square') n['crossSection'] = cs;
};

/** A <cd> that is a number: ignore `auto` and a garbage value rather than store (and re-export) NaN. */
const readCd = (el: Element, n: ComponentNode) => {
  const cdText = text(el, ':scope > cd');
  if (cdText && cdText !== 'auto') {
    const cdv = Number(cdText);
    if (Number.isFinite(cdv)) n['cd'] = cdv;
  }
};

/** Off-axis placement: <radialposition> (m) + <radialdirection> (deg → rad), only kept when non-zero. */
const readRadial = (el: Element, n: ComponentNode) => {
  const radPos = numTag(el, 'radialposition', 0);
  if (radPos !== 0) n['radialPosition'] = radPos;
  const radDir = numTag(el, 'radialdirection', 0);
  if (radDir !== 0) n['radialDirection'] = (radDir * Math.PI) / 180;
};

const readNosecone: NodeReader = (_ctx, el) => {
  const n = base(el, 'nosecone', false);
  n['length'] = numTag(el, 'length', COMPONENT_DEFAULTS.nosecone.length);
  n['aftRadius'] = numTag(el, 'aftradius', COMPONENT_DEFAULTS.nosecone.aftRadius);
  readThicknessOrFilled(el, n, COMPONENT_DEFAULTS.nosecone.thickness);
  n['shape'] = text(el, ':scope > shape') ?? 'ogive';
  n['shapeParameter'] = numTag(el, 'shapeparameter', shapeParamDefault(String(n['shape'])));
  const shR = numTag(el, 'aftshoulderradius', 0);
  const shL = numTag(el, 'aftshoulderlength', 0);
  if (shR > 0) n['shoulderRadius'] = shR;
  if (shL > 0) n['shoulderLength'] = shL;
  const shT = numTag(el, 'aftshoulderthickness', 0);
  if (shT > 0) n['shoulderThickness'] = shT;
  if (text(el, ':scope > aftshouldercapped') === 'true') n['shoulderCapped'] = true;
  return n;
};

const readTransition: NodeReader = (_ctx, el) => {
  const n = base(el, 'transition', false);
  n['length'] = numTag(el, 'length', COMPONENT_DEFAULTS.transition.length);
  const fore = numTag(el, 'foreradius', NaN);
  const aft = numTag(el, 'aftradius', NaN);
  if (!Number.isNaN(fore)) n['foreRadius'] = fore;
  if (!Number.isNaN(aft)) n['aftRadius'] = aft;
  readThicknessOrFilled(el, n, COMPONENT_DEFAULTS.transition.thickness);
  n['shape'] = text(el, ':scope > shape') ?? 'conical';
  n['shapeParameter'] = numTag(el, 'shapeparameter', shapeParamDefault(String(n['shape'])));
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
  }
  return n;
};

const readBodytube: NodeReader = (ctx, el) => {
  const n = base(el, 'bodytube', false);
  n['length'] = numTag(el, 'length', 0.3);
  n['outerRadius'] = numTag(el, 'radius', 0.012);
  n['thickness'] = numTag(el, 'thickness', COMPONENT_DEFAULTS.bodytube.thickness);
  readMotor(ctx, el, n);
  // Extension tag: sub-minimum flag (motor case is the airframe).
  if (text(el, ':scope > caseairframe') === 'true') n['caseAirframe'] = true;
  return n;
};

const readTrapezoidFinset: NodeReader = (_ctx, el) => {
  const n = base(el, 'trapezoidfinset', true);
  n['finCount'] = finCountTag(el);
  n['rootChord'] = numTag(el, 'rootchord', 0.05);
  n['tipChord'] = numTag(el, 'tipchord', 0.03);
  n['sweep'] = numTag(el, 'sweeplength', 0.02);
  n['height'] = numTag(el, 'height', 0.03);
  n['thickness'] = numTag(el, 'thickness', COMPONENT_DEFAULTS.finset.thickness);
  readCant(el, n);
  readAirfoil(el, n);
  readFinTabs(el, n);
  readFinRotation(el, n);
  return n;
};

const readFreeformFinset: NodeReader = (_ctx, el) => {
  const n = base(el, 'freeformfinset', true);
  n['finCount'] = finCountTag(el);
  n['thickness'] = numTag(el, 'thickness', COMPONENT_DEFAULTS.finset.thickness);
  readCant(el, n);
  readAirfoil(el, n);
  readFinTabs(el, n);
  readFinRotation(el, n);
  // Capped: every renderer walks the outline per fin, so a crafted file
  // with a million <point>s is a frozen tab. A real freeform fin has tens.
  // Walked by sibling links and stopped at the cap, rather than selecting the
  // whole list first. Indexing a live `children` collection is O(n) per
  // access in jsdom (so O(n^2) over the list), and a selector materializes
  // every point before the cap can slice; the sibling walk is O(cap) in
  // every DOM. A missing x/y attribute must SKIP the point (Number(null) is
  // 0, which would silently drop a vertex onto the origin).
  const pts: [number, number][] = [];
  const finpoints = el.querySelector(':scope > finpoints');
  if (finpoints) {
    let seen = 0;
    for (let pt = finpoints.firstElementChild; pt && seen < MAX_FIN_POINTS; pt = pt.nextElementSibling) {
      if (pt.tagName !== 'point') continue;
      seen++;
      const x = finiteNum(pt.getAttribute('x'));
      const y = finiteNum(pt.getAttribute('y'));
      if (x !== undefined && y !== undefined) pts.push([x, y]);
    }
  }
  if (pts.length >= 3) n['points'] = pts;
  return n;
};

const readEllipticalFinset: NodeReader = (_ctx, el) => {
  const n = base(el, 'ellipticalfinset', true);
  n['finCount'] = finCountTag(el);
  n['rootChord'] = numTag(el, 'rootchord', 0.05);
  n['height'] = numTag(el, 'height', 0.03);
  n['thickness'] = numTag(el, 'thickness', COMPONENT_DEFAULTS.finset.thickness);
  readCant(el, n);
  readAirfoil(el, n);
  readFinTabs(el, n);
  readFinRotation(el, n);
  return n;
};

const readTubeFinset: NodeReader = (_ctx, el) => {
  const n = base(el, 'tubefinset', true);
  n['finCount'] = finCountTag(el, 6);
  n['length'] = numTag(el, 'length', 0.1);
  const r = numTag(el, 'radius', NaN);
  if (!Number.isNaN(r)) n['outerRadius'] = r;
  const th = numTag(el, 'thickness', NaN);
  if (!Number.isNaN(th)) n['thickness'] = th;
  readFinRotation(el, n);
  return n;
};

const readInnertube: NodeReader = (ctx, el) => {
  const n = base(el, 'innertube', true);
  n['length'] = numTag(el, 'length', 0.07);
  n['outerRadius'] = numTag(el, 'outerradius', 0.0095);
  n['thickness'] = numTag(el, 'thickness', COMPONENT_DEFAULTS.innertube.thickness);
  // Cluster (desktop stores rotation in DEGREES; we keep radians).
  const cluster = text(el, ':scope > clusterconfiguration');
  if (cluster && cluster !== 'single') {
    n['cluster'] = cluster;
    n['clusterScale'] = numTag(el, 'clusterscale', 1);
    n['clusterRotation'] = (numTag(el, 'clusterrotation', 0) * Math.PI) / 180;
  }
  // Off-axis / split-cluster offset: desktop splits a cluster into single
  // tubes, each carrying its position as <radialposition> (meters) +
  // <radialdirection> (DEGREES). We keep the direction in radians (like
  // angleOffset) and only carry non-zero values so a centered tube stays
  // clean. Previously neither was read and the writer hard-wrote 0.0, so
  // every off-center tube collapsed onto the centerline and the next save
  // made it permanent.
  readRadial(el, n);
  // Our extension tag: the mount's physical motor-length limit.
  const mml = numTag(el, 'maxmotorlength', 0);
  if (mml > 0) n['maxMotorLength'] = mml;
  readMotor(ctx, el, n);
  return n;
};

const readTubecoupler: NodeReader = (_ctx, el) => {
  const n = base(el, 'tubecoupler', true);
  n['length'] = numTag(el, 'length', 0.05);
  n['thickness'] = numTag(el, 'thickness', COMPONENT_DEFAULTS.tubecoupler.thickness);
  const or = autoRadiusTag(el, 'outerradius');
  if (or !== undefined) n['outerRadius'] = or;
  return n;
};

const readCenteringring: NodeReader = (_ctx, el) => {
  const n = base(el, 'centeringring', true);
  n['length'] = numTag(el, 'length', COMPONENT_DEFAULTS.centeringring.length);
  const cor = autoRadiusTag(el, 'outerradius');
  if (cor !== undefined) n['outerRadius'] = cor;
  const cir = autoRadiusTag(el, 'innerradius');
  if (cir !== undefined) n['innerRadius'] = cir;
  readInstances(el, n);
  return n;
};

const readBulkhead: NodeReader = (_ctx, el) => {
  const n = base(el, 'bulkhead', true);
  n['length'] = numTag(el, 'length', COMPONENT_DEFAULTS.bulkhead.length);
  // No inner radius: a bulkhead is solid, and upstream's saver omits the
  // element for one entirely (RadiusRingComponentSaver).
  const bor = autoRadiusTag(el, 'outerradius');
  if (bor !== undefined) n['outerRadius'] = bor;
  readInstances(el, n);
  return n;
};

const readEngineblock: NodeReader = (_ctx, el) => {
  const n = base(el, 'engineblock', true);
  n['length'] = numTag(el, 'length', COMPONENT_DEFAULTS.engineblock.length);
  n['thickness'] = numTag(el, 'thickness', COMPONENT_DEFAULTS.engineblock.thickness);
  const eor = autoRadiusTag(el, 'outerradius');
  if (eor !== undefined) n['outerRadius'] = eor;
  return n;
};

const readLaunchlug: NodeReader = (_ctx, el) => {
  const n = base(el, 'launchlug', true);
  n['length'] = numTag(el, 'length', 0.05);
  n['outerRadius'] = numTag(el, 'radius', 0.0022);
  n['thickness'] = numTag(el, 'thickness', 0.0003);
  n['angleOffset'] = readAngleAroundBody(el);
  readInstances(el, n);
  return n;
};

const readRailbutton: NodeReader = (_ctx, el) => {
  const n = base(el, 'railbutton', true);
  const rb = COMPONENT_DEFAULTS.railbutton;
  n['outerDiameter'] = numTag(el, 'outerdiameter', rb.outerDiameter);
  // The rest of the button's geometry (RailButtonSaver.java writes all
  // six) and its material, PASS-THROUGH like fillets: the app neither
  // draws nor simulates them, but the exporter used to hard-write the
  // desktop's constructor constants and a Delrin material, so a 1010
  // button sized by hand on the desktop came back from a save as the
  // stock 1010 button. Only carried when they differ from the defaults
  // the writer would fall back to, so an untouched design stays clean.
  for (const [tag, key] of [
    ['innerdiameter', 'innerDiameter'],
    ['height', 'height'],
    ['baseheight', 'baseHeight'],
    ['flangeheight', 'flangeHeight'],
    ['screwheight', 'screwHeight'],
  ] as const) {
    const v = numTag(el, tag, NaN);
    if (!Number.isNaN(v) && v !== rb[key]) n[key] = v;
  }
  readMaterialGroup(el, n);
  n['angleOffset'] = readAngleAroundBody(el);
  readInstances(el, n);
  return n;
};

// Our extension element (2026-08-05b #18), added for the RASAERO work —
// the desktop warns about the unknown element and skips it. Nothing in
// the editor can create a fairing, so this only ever reads one back out
// of a file this app wrote. See openRocketEngine.ts ComponentType.
const readFairing: NodeReader = (_ctx, el) => {
  const n = base(el, 'fairing', true);
  n['length'] = numTag(el, 'length', 0.08);
  n['width'] = numTag(el, 'width', 0.025);
  n['height'] = numTag(el, 'height', 0.02);
  const fs = text(el, ':scope > fairingshape');
  if (fs) n['fairingShape'] = fs;
  n['mass'] = numTag(el, 'mass', 0.03);
  return n;
};

const readParachute: NodeReader = (ctx, el) => {
  const n = base(el, 'parachute', true);
  readPackedSize(el, n);
  n['diameter'] = numTag(el, 'diameter', 0.3);
  readCd(el, n);
  // Bounded: the kernel sums line mass per line, and a file can say anything.
  n['lineCount'] = clampCount(numTag(el, 'linecount', 6), 1, MAX_LINE_COUNT);
  n['lineLength'] = numTag(el, 'linelength', 0.3);
  readSoftMaterial(el, n, 'surface', 'surfaceDensity', 'surfaceMaterialName');
  readSoftMaterial(el, n, 'line', 'lineDensity', 'lineMaterialName', ':scope > linematerial');
  // Drogue or main. The desktop writes <isdrogue> only when it is true, and
  // the kernel needs it to tell dual deployment from single: without it every
  // flight takes the single-deployment branch.
  if (isDrogueTag(el)) n['drogue'] = true;
  // <deploymentconfiguration> only overrides when a config was chosen —
  // with no declarations the bare tags stay the whole story (a stray
  // block in an undeclared file was never read, keep it that way).
  readDeployment(el, n, ctx.chosenConfigId === null ? null : configScoped(ctx, el, 'deploymentconfiguration'));
  captureDeployments(ctx, el, n);
  // Our extension tag (desktop warns-and-ignores) — spill hole diameter.
  const spill = numTag(el, 'spillholediameter', 0);
  if (spill > 0) n['spillHoleDiameter'] = spill;
  return n;
};

const readStreamer: NodeReader = (ctx, el) => {
  const n = base(el, 'streamer', true);
  readPackedSize(el, n);
  n['stripLength'] = numTag(el, 'striplength', 0.5);
  n['stripWidth'] = numTag(el, 'stripwidth', 0.05);
  readCd(el, n);
  readSoftMaterial(el, n, 'surface', 'surfaceDensity', 'surfaceMaterialName');
  if (isDrogueTag(el)) n['drogue'] = true;
  readDeployment(el, n, ctx.chosenConfigId === null ? null : configScoped(ctx, el, 'deploymentconfiguration'));
  captureDeployments(ctx, el, n);
  return n;
};

const readShockcord: NodeReader = (_ctx, el) => {
  const n = base(el, 'shockcord', true);
  readPackedSize(el, n);
  n['cordLength'] = numTag(el, 'cordlength', 0.3);
  readSoftMaterial(el, n, 'line', 'lineDensity', 'lineMaterialName');
  return n;
};

const readMasscomponent: NodeReader = (_ctx, el) => {
  const n = base(el, 'masscomponent', true);
  n['mass'] = numTag(el, 'mass', 0.01);
  n['length'] = numTag(el, 'packedlength', 0.02);
  n['radius'] = numTag(el, 'packedradius', COMPONENT_DEFAULTS.masscomponent.radius);
  // Preserve-through: what KIND of mass this is (altimeter, payload…).
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
    const n = base(el, asmType, true); // name + overrides + axialoffset/position
    n['instanceCount'] = clampCount(
      numTag(el, 'instancecount', asmType === 'podset' ? 1 : 2),
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
      // Same separation read as a booster <stage> — the chosen config's
      // block wins over the bare defaults.
      readSeparation(configScoped(ctx, el, 'separationconfiguration') ?? el, n);
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
  if (depth > MAX_NESTING_DEPTH) {
    throw new Error('This .ork is nested too deeply to open (possibly malformed).');
  }
  const out: ComponentNode[] = [];
  const wrap = parentEl.querySelector(':scope > subcomponents');
  if (!wrap) return out;
  for (const el of Array.from(wrap.children)) {
    const read = Object.prototype.hasOwnProperty.call(NODE_READERS, el.tagName) ? NODE_READERS[el.tagName] : undefined;
    if (!read) {
      ctx.ignored.add(el.tagName);
      continue;
    }
    const node = read(ctx, el);
    const kids = convertChildren(ctx, el, depth + 1);
    if (kids.length > 0) node.children = kids;
    out.push(node);
  }
  return out;
}

/**
 * EVERY stage imports (Release C) — each becomes a stage node carrying its
 * separation config (desktop writes defaults bare under <stage>).
 */
export function readStages(ctx: OrkImportContext, stages: Element[]): ComponentNode[] {
  return stages.map((stageEl, i) => {
    const stage: ComponentNode = {
      type: 'stage',
      id: freshId(),
      name: text(stageEl, ':scope > name') ?? (i === 0 ? 'Sustainer' : `Booster ${i}`),
    };
    // RASAero power-on base-drag input (meters) — every stage, incl. sustainer.
    const nozzle = numTag(stageEl, 'nozzleexitdiameter', NaN);
    if (!Number.isNaN(nozzle) && nozzle > 0) stage['nozzleExitDiameter'] = nozzle;
    if (i > 0) {
      // Like ignition: the chosen config's block overrides the bare defaults
      // (24.12 writes a <separationconfiguration> for EVERY config id).
      readSeparation(configScoped(ctx, stageEl, 'separationconfiguration') ?? stageEl, stage);
    }
    const kids = convertChildren(ctx, stageEl);
    if (kids.length > 0) stage.children = kids;
    return stage;
  });
}
