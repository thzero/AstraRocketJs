import type { ComponentNode, ComponentType } from '../../engine/openRocketEngine';
import { shapeIsClippable } from '../../tree/shapeProfile';
import { num } from '../../tree/nodeProps';
import { escapeXml } from '../xmlUtil';
import { uuid } from '../uuid';
import { COMPONENT_DEFAULTS } from '../componentDefaults';
import type { OrkWriter } from './exportWriter';
import { mountConfigs, motorMountXml } from './exportMotorConfigs';
import {
  airfoilXml,
  autoRadius,
  deploymentConfigs,
  filletXml,
  finAngleXml,
  finishXml,
  finTabsXml,
  header,
  material,
  packedXml,
  position,
  separationXml,
  shapeParamXml,
  thicknessXml,
} from './exportParts';

/**
 * One writer per component type: the element body the desktop's saver for
 * that type writes, in its order. `emitNode` opens the element (its tag is
 * the component type), runs the body, writes the <subcomponents> and closes
 * it; `stageXml` does the same for the top-level <stage> blocks.
 */

/** Writes the body of a node's element at `d`, the depth just inside its tag. */
export type NodeWriter = (w: OrkWriter, node: ComponentNode, d: number) => void;

const finCountXml = (w: OrkWriter, d: number, node: ComponentNode, fb: number) => {
  w.emit(d, `<instancecount>${num(node, 'finCount', fb)}</instancecount>`);
  w.emit(d, `<fincount>${num(node, 'finCount', fb)}</fincount>`);
};

const instancesXml = (w: OrkWriter, d: number, node: ComponentNode, fb: number) => {
  w.emit(d, `<instancecount>${num(node, 'instanceCount', fb)}</instancecount>`);
  w.emit(d, `<instanceseparation>${num(node, 'instanceSeparation', 0)}</instanceseparation>`);
};

/** The part of a planar fin set (trapezoid, freeform, elliptical) before its planform. */
const planarFinHead = (w: OrkWriter, node: ComponentNode, d: number, fallback: string) => {
  header(w, d, node, fallback);
  finCountXml(w, d, node, COMPONENT_DEFAULTS.finset.finCount);
  w.emit(d, '<radiusoffset method="surface">0.0</radiusoffset>');
  finAngleXml(w, d, node, 'relative');
  position(w, d, node, 'bottom');
  finishXml(w, d, node);
  material(w, d, node);
  w.emit(d, `<thickness>${num(node, 'thickness', COMPONENT_DEFAULTS.finset.thickness)}</thickness>`);
  w.emit(d, `<crosssection>${escapeXml(String(node['crossSection'] ?? 'square'))}</crosssection>`);
  airfoilXml(w, d, node);
  w.emit(d, `<cant>${(num(node, 'cant', 0) * 180) / Math.PI}</cant>`);
  finTabsXml(w, d, node);
  filletXml(w, d, node);
};

/** Radial position/direction written as the literal zeros internal parts carry. */
const radialZeros = (w: OrkWriter, d: number) => {
  w.emit(d, '<radialposition>0.0</radialposition>');
  w.emit(d, '<radialdirection>0.0</radialdirection>');
};

/** The part of a recovery device (parachute, streamer) before its own geometry. */
const recoveryHead = (w: OrkWriter, node: ComponentNode, d: number, fallback: string) => {
  header(w, d, node, fallback);
  position(w, d, node, 'top');
  packedXml(w, d, node);
  radialZeros(w, d);
  w.emit(d, `<cd>${typeof node['cd'] === 'number' ? node['cd'] : 'auto'}</cd>`);
  material(w, d, node, 'surface');
  // Only when true, and in this position: RecoveryDeviceSaver emits it right
  // after the material and omits it for a main, so a round-tripped file stays
  // byte-comparable with one the desktop wrote.
  if (node['drogue'] === true) w.emit(d, '<isdrogue>true</isdrogue>');
  w.emit(d, `<deployevent>${escapeXml(String(node['deployEvent'] ?? 'ejection'))}</deployevent>`);
  w.emit(d, `<deployaltitude>${num(node, 'deployAltitude', 200)}</deployaltitude>`);
  w.emit(d, `<deploydelay>${num(node, 'deployDelay', 0)}</deploydelay>`);
  deploymentConfigs(w, d, node);
};

const ringLikeBody = (w: OrkWriter, node: ComponentNode, d: number, fallback: string, length: number) => {
  header(w, d, node, fallback);
  position(w, d, node, 'bottom');
  material(w, d, node);
  w.emit(d, `<length>${num(node, 'length', length)}</length>`);
  radialZeros(w, d);
  autoRadius(w, d, node, 'outerRadius', 'outerradius');
};

const writeNosecone: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Nose Cone');
  finishXml(w, d, node);
  material(w, d, node);
  w.emit(d, `<length>${num(node, 'length', COMPONENT_DEFAULTS.nosecone.length)}</length>`);
  thicknessXml(w, d, node, COMPONENT_DEFAULTS.nosecone.thickness);
  w.emit(d, `<shape>${escapeXml(String(node['shape'] ?? 'ogive'))}</shape>`);
  w.emit(d, '<shapeclipped>false</shapeclipped>');
  shapeParamXml(w, d, node);
  w.emit(d, `<aftradius>${num(node, 'aftRadius', COMPONENT_DEFAULTS.nosecone.aftRadius)}</aftradius>`);
  w.emit(d, `<aftshoulderradius>${num(node, 'shoulderRadius', 0)}</aftshoulderradius>`);
  w.emit(d, `<aftshoulderlength>${num(node, 'shoulderLength', 0)}</aftshoulderlength>`);
  w.emit(d, `<aftshoulderthickness>${num(node, 'shoulderThickness', 0)}</aftshoulderthickness>`);
  w.emit(d, `<aftshouldercapped>${node['shoulderCapped'] === true}</aftshouldercapped>`);
  w.emit(d, '<isflipped>false</isflipped>');
};

const writeTransition: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Transition');
  finishXml(w, d, node);
  material(w, d, node);
  w.emit(d, `<length>${num(node, 'length', COMPONENT_DEFAULTS.transition.length)}</length>`);
  thicknessXml(w, d, node, COMPONENT_DEFAULTS.transition.thickness);
  w.emit(d, `<shape>${escapeXml(String(node['shape'] ?? 'conical'))}</shape>`);
  // Write what actually simulated so the desktop reproduces our
  // aerodynamics: an explicit imported/edited 'clipped' wins; otherwise
  // the kernel's default clipped state, which setShapeType() sets to
  // type.isClippable() (true for every shape that reaches this branch).
  // Desktop TransitionSaver only writes <shapeclipped> for CLIPPABLE
  // shapes — a conical transition carries no tag, and emitting one
  // anyway would grow a 'clipped' field on re-import that the golden
  // file never had (breaking bit-stable round trips).
  if (shapeIsClippable(String(node['shape'] ?? 'conical'))) {
    const clippedOut = typeof node['clipped'] === 'boolean' ? (node['clipped'] as boolean) : true;
    w.emit(d, `<shapeclipped>${clippedOut}</shapeclipped>`);
  }
  shapeParamXml(w, d, node);
  w.emit(d, `<foreradius>${typeof node['foreRadius'] === 'number' ? node['foreRadius'] : 'auto'}</foreradius>`);
  w.emit(d, `<aftradius>${typeof node['aftRadius'] === 'number' ? node['aftRadius'] : 'auto'}</aftradius>`);
  for (const side of ['fore', 'aft'] as const) {
    const key = side === 'fore' ? 'foreShoulder' : 'aftShoulder';
    w.emit(d, `<${side}shoulderradius>${num(node, `${key}Radius`, 0)}</${side}shoulderradius>`);
    w.emit(d, `<${side}shoulderlength>${num(node, `${key}Length`, 0)}</${side}shoulderlength>`);
    w.emit(d, `<${side}shoulderthickness>${num(node, `${key}Thickness`, 0)}</${side}shoulderthickness>`);
    w.emit(d, `<${side}shouldercapped>false</${side}shouldercapped>`);
  }
};

const writeBodytube: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Body Tube');
  finishXml(w, d, node);
  material(w, d, node);
  w.emit(d, `<length>${num(node, 'length', 0.3)}</length>`);
  w.emit(d, `<thickness>${num(node, 'thickness', COMPONENT_DEFAULTS.bodytube.thickness)}</thickness>`);
  w.emit(d, `<radius>${num(node, 'outerRadius', 0.012)}</radius>`);
  // Extension tag (desktop warns-and-ignores): sub-minimum flag.
  if (node['caseAirframe'] === true) {
    w.emit(d, '<caseairframe>true</caseairframe>');
  }
  // Min-diameter: the body tube itself is the motor mount.
  if (node['motorMount'] === true || mountConfigs(w, node.id).length > 0) {
    motorMountXml(w, d, node.id, num(node, 'motorOverhang', 0));
  }
};

const writeTrapezoidFinset: NodeWriter = (w, node, d) => {
  planarFinHead(w, node, d, 'Trapezoidal Fin Set');
  w.emit(d, `<rootchord>${num(node, 'rootChord', 0.05)}</rootchord>`);
  w.emit(d, `<tipchord>${num(node, 'tipChord', 0.03)}</tipchord>`);
  w.emit(d, `<sweeplength>${num(node, 'sweep', 0.02)}</sweeplength>`);
  w.emit(d, `<height>${num(node, 'height', 0.03)}</height>`);
};

const writeFreeformFinset: NodeWriter = (w, node, d) => {
  planarFinHead(w, node, d, 'Freeform Fin Set');
  w.emit(d, '<finpoints>');
  const ffPts = (node['points'] as [number, number][] | undefined) ?? [];
  for (const [px, py] of ffPts) {
    w.emit(d + 1, `<point x="${px}" y="${py}"/>`);
  }
  w.emit(d, '</finpoints>');
};

const writeEllipticalFinset: NodeWriter = (w, node, d) => {
  planarFinHead(w, node, d, 'Elliptical Fin Set');
  w.emit(d, `<rootchord>${num(node, 'rootChord', 0.05)}</rootchord>`);
  w.emit(d, `<height>${num(node, 'height', 0.03)}</height>`);
};

const writeTubeFinset: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Tube Fin Set');
  finCountXml(w, d, node, 6);
  w.emit(d, '<radiusoffset method="coaxial">0.0</radiusoffset>');
  finAngleXml(w, d, node, 'fixed');
  position(w, d, node, 'bottom');
  finishXml(w, d, node);
  material(w, d, node);
  w.emit(d, `<radius>${typeof node['outerRadius'] === 'number' ? node['outerRadius'] : 'auto'}</radius>`);
  w.emit(d, `<length>${num(node, 'length', 0.1)}</length>`);
  w.emit(d, `<thickness>${num(node, 'thickness', 0.0005)}</thickness>`);
};

const writeInnertube: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Inner Tube');
  position(w, d, node, 'bottom');
  material(w, d, node);
  w.emit(d, `<length>${num(node, 'length', 0.07)}</length>`);
  // Preserve the off-axis / split-cluster offset (see the innertube reader):
  // <radialposition> meters, <radialdirection> DEGREES. Defaults to 0 so a
  // centered tube is byte-identical to before.
  w.emit(d, `<radialposition>${num(node, 'radialPosition', 0)}</radialposition>`);
  w.emit(d, `<radialdirection>${(num(node, 'radialDirection', 0) * 180) / Math.PI}</radialdirection>`);
  w.emit(d, `<outerradius>${num(node, 'outerRadius', 0.0095)}</outerradius>`);
  w.emit(d, `<thickness>${num(node, 'thickness', COMPONENT_DEFAULTS.innertube.thickness)}</thickness>`);
  // Desktop stores cluster rotation in DEGREES; we keep radians inside.
  w.emit(
    d,
    `<clusterconfiguration>${escapeXml(typeof node['cluster'] === 'string' ? (node['cluster'] as string) : 'single')}</clusterconfiguration>`,
  );
  w.emit(d, `<clusterscale>${num(node, 'clusterScale', 1)}</clusterscale>`);
  w.emit(d, `<clusterrotation>${(num(node, 'clusterRotation', 0) * 180) / Math.PI}</clusterrotation>`);
  if (typeof node['maxMotorLength'] === 'number') {
    // Extension tag (desktop warns-and-ignores): the mount's physical
    // motor-length limit travels with the design.
    w.emit(d, `<maxmotorlength>${node['maxMotorLength']}</maxmotorlength>`);
  }
  if (node['motorMount'] === true || mountConfigs(w, node.id).length > 0) {
    motorMountXml(w, d, node.id, num(node, 'motorOverhang', 0));
  }
};

const writeTubecoupler: NodeWriter = (w, node, d) => {
  ringLikeBody(w, node, d, 'Tube Coupler', 0.05);
  w.emit(d, `<thickness>${num(node, 'thickness', COMPONENT_DEFAULTS.tubecoupler.thickness)}</thickness>`);
};

const writeCenteringring: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Centering Ring');
  instancesXml(w, d, node, 1);
  position(w, d, node, 'bottom');
  material(w, d, node);
  w.emit(d, `<length>${num(node, 'length', COMPONENT_DEFAULTS.centeringring.length)}</length>`);
  radialZeros(w, d);
  autoRadius(w, d, node, 'outerRadius', 'outerradius');
  autoRadius(w, d, node, 'innerRadius', 'innerradius');
};

const writeBulkhead: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Bulkhead');
  instancesXml(w, d, node, 1);
  position(w, d, node, 'bottom');
  material(w, d, node);
  w.emit(d, `<length>${num(node, 'length', COMPONENT_DEFAULTS.bulkhead.length)}</length>`);
  radialZeros(w, d);
  autoRadius(w, d, node, 'outerRadius', 'outerradius');
  // No inner radius for a bulkhead, which is solid - upstream's saver does
  // the same (RadiusRingComponentSaver skips it for Bulkhead).
};

const writeEngineblock: NodeWriter = (w, node, d) => {
  ringLikeBody(w, node, d, 'Engine Block', COMPONENT_DEFAULTS.engineblock.length);
  w.emit(d, `<thickness>${num(node, 'thickness', COMPONENT_DEFAULTS.engineblock.thickness)}</thickness>`);
};

// Extension element from the RASAero work: our own reader round-trips
// it; the desktop warns-and-skips (same contract as the
// airfoil-section tags, which are also RASAero). Unreachable from the
// editor - see openRocketEngine.ts ComponentType.
const writeFairing: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Camera shroud');
  position(w, d, node, 'middle');
  finishXml(w, d, node);
  w.emit(d, `<length>${num(node, 'length', 0.08)}</length>`);
  w.emit(d, `<width>${num(node, 'width', 0.025)}</width>`);
  w.emit(d, `<height>${num(node, 'height', 0.02)}</height>`);
  w.emit(d, `<fairingshape>${escapeXml(String(node['fairingShape'] ?? 'halfround'))}</fairingshape>`);
  w.emit(d, `<mass>${num(node, 'mass', 0.03)}</mass>`);
};

const writeLaunchlug: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Launch Lug');
  instancesXml(w, d, node, 1);
  w.emit(d, `<angleoffset method="relative">${(num(node, 'angleOffset', Math.PI) * 180) / Math.PI}</angleoffset>`);
  w.emit(d, `<radialdirection>${(num(node, 'angleOffset', Math.PI) * 180) / Math.PI}</radialdirection>`);
  position(w, d, node, 'middle');
  finishXml(w, d, node);
  material(w, d, node);
  w.emit(d, `<radius>${num(node, 'outerRadius', 0.0022)}</radius>`);
  w.emit(d, `<length>${num(node, 'length', 0.05)}</length>`);
  w.emit(d, `<thickness>${num(node, 'thickness', 0.0003)}</thickness>`);
};

const writeRailbutton: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Rail Button');
  instancesXml(w, d, node, 1);
  w.emit(d, `<angleoffset method="relative">${(num(node, 'angleOffset', Math.PI) * 180) / Math.PI}</angleoffset>`);
  position(w, d, node, 'middle');
  finishXml(w, d, node);
  // Material and the five other dimensions come from the node when the
  // reader kept them (see the railbutton import case); the constructor
  // constants they used to be hard-wired to are now only the fallback.
  const rb = COMPONENT_DEFAULTS.railbutton;
  material(w, d, node, 'bulk', {
    name: rb.materialName,
    density: rb.materialDensity,
    group: rb.materialGroup,
  });
  w.emit(d, `<outerdiameter>${num(node, 'outerDiameter', rb.outerDiameter)}</outerdiameter>`);
  w.emit(d, `<innerdiameter>${num(node, 'innerDiameter', rb.innerDiameter)}</innerdiameter>`);
  w.emit(d, `<height>${num(node, 'height', rb.height)}</height>`);
  w.emit(d, `<baseheight>${num(node, 'baseHeight', rb.baseHeight)}</baseheight>`);
  w.emit(d, `<flangeheight>${num(node, 'flangeHeight', rb.flangeHeight)}</flangeheight>`);
  w.emit(d, `<screwheight>${num(node, 'screwHeight', rb.screwHeight)}</screwheight>`);
};

const writeParachute: NodeWriter = (w, node, d) => {
  recoveryHead(w, node, d, 'Parachute');
  w.emit(d, `<diameter>${num(node, 'diameter', 0.3)}</diameter>`);
  if (typeof node['spillHoleDiameter'] === 'number' && (node['spillHoleDiameter'] as number) > 0) {
    // Extension tag (desktop warns-and-ignores, same as airfoilsection).
    w.emit(d, `<spillholediameter>${node['spillHoleDiameter']}</spillholediameter>`);
  }
  w.emit(d, `<linecount>${num(node, 'lineCount', 6)}</linecount>`);
  w.emit(d, `<linelength>${num(node, 'lineLength', 0.3)}</linelength>`);
  if (typeof node['lineDensity'] === 'number') {
    const lname = typeof node['lineMaterialName'] === 'string' ? (node['lineMaterialName'] as string) : 'custom';
    w.emit(d, `<linematerial type="line" density="${node['lineDensity']}">${escapeXml(lname)}</linematerial>`);
  } else {
    w.emit(
      d,
      '<linematerial type="line" density="0.0018" group="ThreadsLines">Elastic cord (round 2 mm, 1/16 in)</linematerial>',
    );
  }
};

const writeStreamer: NodeWriter = (w, node, d) => {
  recoveryHead(w, node, d, 'Streamer');
  w.emit(d, `<striplength>${num(node, 'stripLength', 0.5)}</striplength>`);
  w.emit(d, `<stripwidth>${num(node, 'stripWidth', 0.05)}</stripwidth>`);
};

const writeShockcord: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Shock Cord');
  position(w, d, node, 'top');
  packedXml(w, d, node);
  radialZeros(w, d);
  w.emit(d, `<cordlength>${num(node, 'cordLength', 0.3)}</cordlength>`);
  material(w, d, node, 'line');
};

const writeMasscomponent: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Mass Component');
  position(w, d, node, 'top');
  w.emit(d, `<packedlength>${num(node, 'length', 0.02)}</packedlength>`);
  w.emit(d, `<packedradius>${num(node, 'radius', COMPONENT_DEFAULTS.masscomponent.radius)}</packedradius>`);
  // Off-axis placement (meters + degrees). Was hard-wired to 0, so a mass
  // off the centerline collapsed onto the axis on save/reload.
  w.emit(d, `<radialposition>${num(node, 'radialPosition', 0)}</radialposition>`);
  w.emit(d, `<radialdirection>${(num(node, 'radialDirection', 0) * 180) / Math.PI}</radialdirection>`);
  w.emit(d, `<mass>${num(node, 'mass', 0.01)}</mass>`);
  // Legal values = MassComponent.MassComponentType lowercased:
  // masscomponent, altimeter, flightcomputer, deploymentcharge,
  // tracker, payload, recoveryhardware, battery.
  w.emit(
    d,
    `<masscomponenttype>${escapeXml(String(node['massComponentType'] ?? 'masscomponent'))}</masscomponenttype>`,
  );
};

/** ComponentAssembly (pod set, parallel stage): the placement block they share. */
const assemblyHead = (w: OrkWriter, node: ComponentNode, d: number, fallback: string) => {
  header(w, d, node, fallback);
  // ComponentAssembly: NO <color>/<linestyle>/<radialdirection> — the
  // desktop savers suppress all three for assemblies.
  w.emit(d, `<instancecount>${num(node, 'instanceCount', 2)}</instancecount>`);
  const rMethod = node['radiusMethod'] === 'free' ? 'free' : 'relative';
  w.emit(d, `<radiusoffset method="${rMethod}">${num(node, 'radiusOffset', 0)}</radiusoffset>`); // meters
  const aMethod = node['angleMethod'] === 'fixed' ? 'fixed' : 'relative';
  // angleOffset is stored in radians → DEGREES on disk (same as cant).
  w.emit(d, `<angleoffset method="${aMethod}">${(num(node, 'angleOffset', 0) * 180) / Math.PI}</angleoffset>`);
  position(w, d, node, 'bottom');
};

const writePodset: NodeWriter = (w, node, d) => {
  assemblyHead(w, node, d, 'Pod set');
};

const writeParallelstage: NodeWriter = (w, node, d) => {
  assemblyHead(w, node, d, 'Booster');
  // Same separation block a booster <stage> writes (bare default + config).
  separationXml(w, d, node);
};

/**
 * The per-type writer table. A `stage` below the rocket root has no element in
 * the desktop format (stages are written by `stageXml` at the top level only),
 * so it is the one type with no writer and `emitNode` skips it.
 */
const NODE_WRITERS: Record<ComponentType, NodeWriter | null> = {
  stage: null,
  nosecone: writeNosecone,
  transition: writeTransition,
  bodytube: writeBodytube,
  trapezoidfinset: writeTrapezoidFinset,
  freeformfinset: writeFreeformFinset,
  ellipticalfinset: writeEllipticalFinset,
  tubefinset: writeTubeFinset,
  innertube: writeInnertube,
  tubecoupler: writeTubecoupler,
  centeringring: writeCenteringring,
  bulkhead: writeBulkhead,
  engineblock: writeEngineblock,
  fairing: writeFairing,
  launchlug: writeLaunchlug,
  railbutton: writeRailbutton,
  parachute: writeParachute,
  streamer: writeStreamer,
  shockcord: writeShockcord,
  masscomponent: writeMasscomponent,
  podset: writePodset,
  parallelstage: writeParallelstage,
};

function emitChildren(w: OrkWriter, node: ComponentNode, depth: number): void {
  const kids = node.children ?? [];
  if (kids.length === 0) return;
  w.emit(depth, '<subcomponents>');
  for (const kid of kids) {
    emitNode(w, kid, depth + 1);
  }
  w.emit(depth, '</subcomponents>');
}

/** One component element (tag = its type), its body, its subcomponents. */
function emitNode(w: OrkWriter, node: ComponentNode, depth: number): void {
  const write = NODE_WRITERS[node.type];
  if (!write) return;
  w.emit(depth, `<${node.type}>`);
  write(w, node, depth + 1);
  emitChildren(w, node, depth + 1);
  w.emit(depth, `</${node.type}>`);
}

/** A top-level <stage> block (index `i` in the rocket's stage list). */
export function stageXml(w: OrkWriter, depth: number, st: ComponentNode, i: number): void {
  const { emit } = w;
  emit(depth, '<stage>');
  emit(depth + 1, `<name>${escapeXml(st.name ?? (i === 0 ? 'Sustainer' : `Booster ${i}`))}</name>`);
  emit(depth + 1, `<id>${uuid()}</id>`);
  // RASAero power-on base-drag input (meters, no conversion). Non-standard
  // element (OpenRocket desktop ignores it); only emitted when set > 0 so a
  // plain design round-trips exactly. Applies to every stage incl. sustainer.
  if (typeof st['nozzleExitDiameter'] === 'number' && (st['nozzleExitDiameter'] as number) > 0) {
    emit(depth + 1, `<nozzleexitdiameter>${st['nozzleExitDiameter']}</nozzleexitdiameter>`);
  }
  if (i > 0) {
    // Separation (lower stages only) — desktop writes the DEFAULT params
    // bare, then a per-config block (AxialStageSaver).
    separationXml(w, depth + 1, st);
  }
  emit(depth + 1, '<subcomponents>');
  for (const node of st.children ?? []) {
    emitNode(w, node, depth + 2);
  }
  emit(depth + 1, '</subcomponents>');
  emit(depth, '</stage>');
}
