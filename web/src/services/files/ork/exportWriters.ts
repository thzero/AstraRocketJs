import type { ComponentNode, ComponentType } from '../../../engine/openRocketEngine';
import { nodeShape, shapeIsClippable } from '../../../tree/shapeProfile';
import { num, str } from '../../../tree/nodeProps';
import { escapeXml } from '../xmlUtil';
import { COMPONENT_DEFAULTS } from '../../design/componentDefaults';
import type { OrkWriter } from './exportWriter';
import { mountConfigs, motorMountXml } from './exportMotorConfigs';
import {
  airfoilXml,
  autoRadius,
  deployEventXml,
  deploymentConfigs,
  filletXml,
  finAngleXml,
  finishXml,
  finTabsXml,
  header,
  material,
  packedRadiusXml,
  packedXml,
  position,
  separationXml,
  shapeParamXml,
  thicknessXml,
} from './exportParts';
import { stageFileName } from '../../design/orkTree';
import { KERNEL_DEFAULTS, KERNEL_DEPLOYMENT, KERNEL_MATERIALS, defaultSeparation } from '../../../tree/kernelDefaults';

/**
 * One writer per component type: the element body the desktop's saver for
 * that type writes, in its order. `emitNode` opens the element (its tag is
 * the component type), runs the body, writes the <subcomponents> and closes
 * it; `stageXml` does the same for the top-level <stage> blocks.
 */

/** Writes the body of a node's element at `d`, the depth just inside its tag. */
type NodeWriter = (w: OrkWriter, node: ComponentNode, d: number) => void;

const finCountXml = (w: OrkWriter, d: number, node: ComponentNode, fb: number) => {
  w.emit(d, `<instancecount>${num(node, 'finCount', fb)}</instancecount>`);
  w.emit(d, `<fincount>${num(node, 'finCount', fb)}</fincount>`);
};

const instancesXml = (w: OrkWriter, d: number, node: ComponentNode, fb: number) => {
  w.emit(d, `<instancecount>${num(node, 'instanceCount', fb)}</instancecount>`);
  // The spacing that flies: a node with none flies the kernel's.
  w.emit(
    d,
    `<instanceseparation>${num(node, 'instanceSeparation', defaultSeparation(node.type))}</instanceseparation>`,
  );
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
  w.emit(d, `<crosssection>${escapeXml(str(node, 'crossSection', 'square'))}</crosssection>`);
  airfoilXml(w, d, node);
  w.emit(d, `<cant>${(num(node, 'cant', 0) * 180) / Math.PI}</cant>`);
  finTabsXml(w, d, node);
  filletXml(w, d, node);
};

/**
 * Off-axis placement of an internal part: <radialposition> meters,
 * <radialdirection> degrees, as RingComponentSaver and MassObjectSaver write
 * them. A centered part keeps the literal 0.0 the desktop writes.
 */
const radialXml = (w: OrkWriter, d: number, node: ComponentNode) => {
  const pos = num(node, 'radialPosition', 0);
  const dir = (num(node, 'radialDirection', 0) * 180) / Math.PI;
  w.emit(d, `<radialposition>${pos === 0 ? '0.0' : pos}</radialposition>`);
  w.emit(d, `<radialdirection>${dir === 0 ? '0.0' : dir}</radialdirection>`);
};

/** The part of a recovery device (parachute, streamer) before its own geometry. */
const recoveryHead = (w: OrkWriter, node: ComponentNode, d: number, fallback: string) => {
  header(w, d, node, fallback);
  position(w, d, node, 'top');
  packedXml(w, d, node);
  radialXml(w, d, node);
  w.emit(d, `<cd>${node['cdAuto'] === true || typeof node['cd'] !== 'number' ? 'auto' : node['cd']}</cd>`);
  material(w, d, node, 'surface');
  // Only when true, and in this position: RecoveryDeviceSaver emits it right
  // after the material and omits it for a main, so a round-tripped file stays
  // byte-comparable with one the desktop wrote.
  if (node['drogue'] === true) w.emit(d, '<isdrogue>true</isdrogue>');
  w.emit(
    d,
    `<deployevent>${escapeXml(deployEventXml(str(node, 'deployEvent', KERNEL_DEPLOYMENT.deployEvent)))}</deployevent>`,
  );
  w.emit(d, `<deployaltitude>${num(node, 'deployAltitude', KERNEL_DEPLOYMENT.deployAltitude)}</deployaltitude>`);
  w.emit(d, `<deploydelay>${num(node, 'deployDelay', KERNEL_DEPLOYMENT.deployDelay)}</deploydelay>`);
  deploymentConfigs(w, d, node);
};

const ringLikeBody = (w: OrkWriter, node: ComponentNode, d: number, fallback: string, length: number) => {
  header(w, d, node, fallback);
  position(w, d, node, 'bottom');
  material(w, d, node);
  w.emit(d, `<length>${num(node, 'length', length)}</length>`);
  radialXml(w, d, node);
  autoRadius(w, d, node, 'outerRadius', 'outerradius');
};

const writeNosecone: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Nose Cone');
  finishXml(w, d, node);
  material(w, d, node);
  w.emit(d, `<length>${num(node, 'length', COMPONENT_DEFAULTS.nosecone.length)}</length>`);
  thicknessXml(w, d, node, COMPONENT_DEFAULTS.nosecone.thickness);
  w.emit(d, `<shape>${escapeXml(nodeShape(node))}</shape>`);
  w.emit(d, '<shapeclipped>false</shapeclipped>');
  shapeParamXml(w, d, node);
  w.emit(
    d,
    `<aftradius>${node['aftRadiusAuto'] === true ? 'auto' : num(node, 'aftRadius', COMPONENT_DEFAULTS.nosecone.aftRadius)}</aftradius>`,
  );
  w.emit(d, `<aftshoulderradius>${num(node, 'shoulderRadius', 0)}</aftshoulderradius>`);
  w.emit(d, `<aftshoulderlength>${num(node, 'shoulderLength', 0)}</aftshoulderlength>`);
  w.emit(d, `<aftshoulderthickness>${num(node, 'shoulderThickness', 0)}</aftshoulderthickness>`);
  w.emit(d, `<aftshouldercapped>${node['shoulderCapped'] === true}</aftshouldercapped>`);
  w.emit(d, `<isflipped>${node['flipped'] === true}</isflipped>`);
};

const writeTransition: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Transition');
  finishXml(w, d, node);
  material(w, d, node);
  w.emit(d, `<length>${num(node, 'length', COMPONENT_DEFAULTS.transition.length)}</length>`);
  thicknessXml(w, d, node, COMPONENT_DEFAULTS.transition.thickness);
  w.emit(d, `<shape>${escapeXml(nodeShape(node))}</shape>`);
  // Write what actually simulated so the desktop reproduces our
  // aerodynamics: an explicit imported/edited 'clipped' wins; otherwise
  // the kernel's default clipped state, which setShapeType() sets to
  // type.isClippable() (true for every shape that reaches this branch).
  // Desktop TransitionSaver only writes <shapeclipped> for clippable
  // shapes: a conical transition carries no tag, and emitting one
  // anyway would grow a 'clipped' field on re-import that a desktop-written
  // file does not have (breaking bit-stable round trips).
  if (shapeIsClippable(nodeShape(node))) {
    const clippedOut = typeof node['clipped'] === 'boolean' ? node['clipped'] : true;
    w.emit(d, `<shapeclipped>${clippedOut}</shapeclipped>`);
  }
  shapeParamXml(w, d, node);
  // A transition's radius is automatic when the flag says so, and also when
  // the key is missing: that is how a tree without the flag spells it, and
  // how the reader reads the file.
  const transAuto = (key: 'foreRadius' | 'aftRadius') =>
    node[`${key}Auto`] === true || typeof node[key] !== 'number' ? 'auto' : String(node[key]);
  w.emit(d, `<foreradius>${transAuto('foreRadius')}</foreradius>`);
  w.emit(d, `<aftradius>${transAuto('aftRadius')}</aftradius>`);
  for (const side of ['fore', 'aft'] as const) {
    const key = side === 'fore' ? 'foreShoulder' : 'aftShoulder';
    w.emit(d, `<${side}shoulderradius>${num(node, `${key}Radius`, 0)}</${side}shoulderradius>`);
    w.emit(d, `<${side}shoulderlength>${num(node, `${key}Length`, 0)}</${side}shoulderlength>`);
    w.emit(d, `<${side}shoulderthickness>${num(node, `${key}Thickness`, 0)}</${side}shoulderthickness>`);
    w.emit(d, `<${side}shouldercapped>${node[`${key}Capped`] === true}</${side}shouldercapped>`);
  }
};

// A part writes `<motormount>` when it is flagged as a mount or when any
// configuration loads a motor into it.
const mountXml: NodeWriter = (w, node, d) => {
  if (node['motorMount'] === true || mountConfigs(w, node.id).length > 0) {
    motorMountXml(w, d, node);
  }
};

const writeBodytube: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Body Tube');
  finishXml(w, d, node);
  material(w, d, node);
  const bt = COMPONENT_DEFAULTS.bodytube;
  w.emit(d, `<length>${num(node, 'length', bt.length)}</length>`);
  thicknessXml(w, d, node, bt.thickness);
  w.emit(d, `<radius>${node['outerRadiusAuto'] === true ? 'auto' : num(node, 'outerRadius', bt.outerRadius)}</radius>`);
  // Extension tag (desktop warns-and-ignores): sub-minimum flag.
  if (node['caseAirframe'] === true) {
    w.emit(d, '<caseairframe>true</caseairframe>');
  }
  // Min-diameter: the body tube itself is the motor mount.
  mountXml(w, node, d);
};

const writeTrapezoidFinset: NodeWriter = (w, node, d) => {
  planarFinHead(w, node, d, 'Trapezoidal Fin Set');
  const fin = COMPONENT_DEFAULTS.trapezoidfinset;
  w.emit(d, `<rootchord>${num(node, 'rootChord', fin.rootChord)}</rootchord>`);
  w.emit(d, `<tipchord>${num(node, 'tipChord', fin.tipChord)}</tipchord>`);
  w.emit(d, `<sweeplength>${num(node, 'sweep', fin.sweep)}</sweeplength>`);
  w.emit(d, `<height>${num(node, 'height', fin.height)}</height>`);
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
  const fin = COMPONENT_DEFAULTS.ellipticalfinset;
  w.emit(d, `<rootchord>${num(node, 'rootChord', fin.rootChord)}</rootchord>`);
  w.emit(d, `<height>${num(node, 'height', fin.height)}</height>`);
};

const writeTubeFinset: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Tube Fin Set');
  finCountXml(w, d, node, COMPONENT_DEFAULTS.tubefinset.finCount);
  w.emit(d, '<radiusoffset method="coaxial">0.0</radiusoffset>');
  finAngleXml(w, d, node, 'fixed');
  position(w, d, node, 'bottom');
  finishXml(w, d, node);
  material(w, d, node);
  // A tube fin set with no diameter is sized by the kernel from the body
  // radius and the fin count, so the flag has to survive the save.
  autoRadius(w, d, node, 'outerRadius', 'radius');
  w.emit(d, `<length>${num(node, 'length', COMPONENT_DEFAULTS.tubefinset.length)}</length>`);
  // No wall is no tag: the bridge sets a tube fin set's wall only from a stated
  // key (ComponentFactory.applyWallThickness) and otherwise leaves the kernel's
  // unset NaN wall, and desktop reads an absent <thickness> the same way, so a
  // number here would fly one wall and save another.
  if (typeof node['thickness'] === 'number') w.emit(d, `<thickness>${node['thickness']}</thickness>`);
};

const writeInnertube: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Inner Tube');
  position(w, d, node, 'bottom');
  material(w, d, node);
  const it = COMPONENT_DEFAULTS.innertube;
  w.emit(d, `<length>${num(node, 'length', it.length)}</length>`);
  // Preserve the off-axis / split-cluster offset (see the innertube reader).
  radialXml(w, d, node);
  w.emit(d, `<outerradius>${num(node, 'outerRadius', it.outerRadius)}</outerradius>`);
  w.emit(d, `<thickness>${num(node, 'thickness', it.thickness)}</thickness>`);
  // Desktop stores cluster rotation in degrees; we keep radians inside.
  w.emit(
    d,
    `<clusterconfiguration>${escapeXml(typeof node['cluster'] === 'string' ? node['cluster'] : 'single')}</clusterconfiguration>`,
  );
  w.emit(d, `<clusterscale>${num(node, 'clusterScale', 1)}</clusterscale>`);
  w.emit(d, `<clusterrotation>${(num(node, 'clusterRotation', 0) * 180) / Math.PI}</clusterrotation>`);
  if (typeof node['maxMotorLength'] === 'number') {
    // Extension tag (desktop warns-and-ignores): the mount's physical
    // motor-length limit travels with the design.
    w.emit(d, `<maxmotorlength>${node['maxMotorLength']}</maxmotorlength>`);
  }
  mountXml(w, node, d);
};

const writeTubecoupler: NodeWriter = (w, node, d) => {
  ringLikeBody(w, node, d, 'Tube Coupler', COMPONENT_DEFAULTS.tubecoupler.length);
  w.emit(d, `<thickness>${num(node, 'thickness', COMPONENT_DEFAULTS.tubecoupler.thickness)}</thickness>`);
};

const writeCenteringring: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Centering Ring');
  instancesXml(w, d, node, 1);
  position(w, d, node, 'bottom');
  material(w, d, node);
  w.emit(d, `<length>${num(node, 'length', COMPONENT_DEFAULTS.centeringring.length)}</length>`);
  radialXml(w, d, node);
  autoRadius(w, d, node, 'outerRadius', 'outerradius');
  autoRadius(w, d, node, 'innerRadius', 'innerradius');
};

const writeBulkhead: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Bulkhead');
  instancesXml(w, d, node, 1);
  position(w, d, node, 'bottom');
  material(w, d, node);
  w.emit(d, `<length>${num(node, 'length', COMPONENT_DEFAULTS.bulkhead.length)}</length>`);
  radialXml(w, d, node);
  autoRadius(w, d, node, 'outerRadius', 'outerradius');
  // No inner radius for a bulkhead, which is solid - upstream's saver does
  // the same (RadiusRingComponentSaver skips it for Bulkhead).
};

const writeEngineblock: NodeWriter = (w, node, d) => {
  ringLikeBody(w, node, d, 'Engine Block', COMPONENT_DEFAULTS.engineblock.length);
  w.emit(d, `<thickness>${num(node, 'thickness', COMPONENT_DEFAULTS.engineblock.thickness)}</thickness>`);
};

// Extension element (the camera shroud): our own reader round-trips it; the
// desktop warns-and-skips (same contract as the airfoil-section tags).
// Unreachable from the editor; see ComponentType in openRocketEngine.ts.
const writeFairing: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Camera shroud');
  position(w, d, node, 'middle');
  finishXml(w, d, node);
  const fr = COMPONENT_DEFAULTS.fairing;
  w.emit(d, `<length>${num(node, 'length', fr.length)}</length>`);
  w.emit(d, `<width>${num(node, 'width', fr.width)}</width>`);
  w.emit(d, `<height>${num(node, 'height', fr.height)}</height>`);
  w.emit(d, `<fairingshape>${escapeXml(str(node, 'fairingShape', 'halfround'))}</fairingshape>`);
  w.emit(d, `<mass>${num(node, 'mass', fr.mass)}</mass>`);
};

const writeLaunchlug: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Launch Lug');
  instancesXml(w, d, node, 1);
  const lug = COMPONENT_DEFAULTS.launchlug;
  const lugAngle = KERNEL_DEFAULTS.launchlug.angleOffset;
  w.emit(d, `<angleoffset method="relative">${(num(node, 'angleOffset', lugAngle) * 180) / Math.PI}</angleoffset>`);
  w.emit(d, `<radialdirection>${(num(node, 'angleOffset', lugAngle) * 180) / Math.PI}</radialdirection>`);
  position(w, d, node, 'middle');
  finishXml(w, d, node);
  material(w, d, node);
  w.emit(d, `<radius>${num(node, 'outerRadius', lug.outerRadius)}</radius>`);
  w.emit(d, `<length>${num(node, 'length', lug.length)}</length>`);
  w.emit(d, `<thickness>${num(node, 'thickness', lug.thickness)}</thickness>`);
};

const writeRailbutton: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Rail Button');
  instancesXml(w, d, node, 1);
  const rbAngle = KERNEL_DEFAULTS.railbutton.angleOffset;
  w.emit(d, `<angleoffset method="relative">${(num(node, 'angleOffset', rbAngle) * 180) / Math.PI}</angleoffset>`);
  position(w, d, node, 'middle');
  finishXml(w, d, node);
  // Material and the five other dimensions come from the node when the reader
  // kept them (see the railbutton import case); the constructor constants are
  // only the fallback.
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

/**
 * A line or cord length that may be automatic. Desktop 24.12 has no automatic
 * line or cord length and reads `auto` in these tags as its default (a 0.3 m
 * line, a 0.4 m cord), so the tag carries the length the kernel flies and an
 * app-only `<…auto>true</…auto>` beside it (desktop warns and ignores it) keeps
 * the setting for the app's own reader. With no kernel figures, the stored
 * length.
 */
function autoLengthXml(
  w: OrkWriter,
  d: number,
  node: ComponentNode,
  key: 'lineLength' | 'cordLength',
  flag: 'lineLengthAuto' | 'cordLengthAuto',
  tag: string,
  fallback: number,
): void {
  if (node[flag] !== true) {
    w.emit(d, `<${tag}>${num(node, key, fallback)}</${tag}>`);
    return;
  }
  const flown = typeof node.id === 'string' ? w.componentInfo?.(node.id)?.[key] : undefined;
  w.emit(d, `<${tag}>${flown ?? num(node, key, fallback)}</${tag}>`);
  w.emit(d, `<${tag}auto>true</${tag}auto>`);
}

const writeParachute: NodeWriter = (w, node, d) => {
  recoveryHead(w, node, d, 'Parachute');
  const chute = COMPONENT_DEFAULTS.parachute;
  w.emit(d, `<diameter>${num(node, 'diameter', chute.diameter)}</diameter>`);
  if (typeof node['spillHoleDiameter'] === 'number' && node['spillHoleDiameter'] > 0) {
    // Extension tag (desktop warns-and-ignores, same as airfoilsection).
    w.emit(d, `<spillholediameter>${node['spillHoleDiameter']}</spillholediameter>`);
  }
  w.emit(d, `<linecount>${num(node, 'lineCount', chute.lineCount)}</linecount>`);
  autoLengthXml(w, d, node, 'lineLength', 'lineLengthAuto', 'linelength', chute.lineLength);
  if (typeof node['lineDensity'] === 'number') {
    const lname = typeof node['lineMaterialName'] === 'string' ? node['lineMaterialName'] : 'custom';
    w.emit(d, `<linematerial type="line" density="${node['lineDensity']}">${escapeXml(lname)}</linematerial>`);
  } else {
    // The kernel's own line, the row `material` writes under <material>; a
    // parachute's line has a tag of its own, so the row is written from the
    // table here rather than through `material`.
    const line = KERNEL_MATERIALS.line;
    w.emit(
      d,
      `<linematerial type="line" density="${line.density}" group="${line.group}">${escapeXml(line.name)}</linematerial>`,
    );
  }
};

const writeStreamer: NodeWriter = (w, node, d) => {
  recoveryHead(w, node, d, 'Streamer');
  w.emit(d, `<striplength>${num(node, 'stripLength', COMPONENT_DEFAULTS.streamer.stripLength)}</striplength>`);
  w.emit(d, `<stripwidth>${num(node, 'stripWidth', COMPONENT_DEFAULTS.streamer.stripWidth)}</stripwidth>`);
};

const writeShockcord: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Shock Cord');
  position(w, d, node, 'top');
  packedXml(w, d, node);
  radialXml(w, d, node);
  autoLengthXml(w, d, node, 'cordLength', 'cordLengthAuto', 'cordlength', COMPONENT_DEFAULTS.shockcord.cordLength);
  material(w, d, node, 'line');
};

const writeMasscomponent: NodeWriter = (w, node, d) => {
  header(w, d, node, 'Mass Component');
  position(w, d, node, 'top');
  const mc = COMPONENT_DEFAULTS.masscomponent;
  w.emit(d, `<packedlength>${num(node, 'length', mc.length)}</packedlength>`);
  w.emit(d, packedRadiusXml(node, mc.radius));
  // Off-axis placement, so a mass off the centerline keeps its place on save.
  radialXml(w, d, node);
  w.emit(d, `<mass>${num(node, 'mass', mc.mass)}</mass>`);
  // Legal values = MassComponent.MassComponentType lowercased:
  // masscomponent, altimeter, flightcomputer, deploymentcharge,
  // tracker, payload, recoveryhardware, battery.
  w.emit(d, `<masscomponenttype>${escapeXml(str(node, 'massComponentType', 'masscomponent'))}</masscomponenttype>`);
};

/** ComponentAssembly (pod set, parallel stage): the placement block they share. */
const assemblyHead = (w: OrkWriter, node: ComponentNode, d: number, fallback: string) => {
  header(w, d, node, fallback);
  // ComponentAssembly: no <radialdirection>, which the desktop savers
  // suppress for assemblies.
  const assembly = node.type === 'podset' ? KERNEL_DEFAULTS.podset : KERNEL_DEFAULTS.parallelstage;
  w.emit(d, `<instancecount>${num(node, 'instanceCount', assembly.instanceCount)}</instancecount>`);
  const rMethod = node['radiusMethod'] === 'free' ? 'free' : 'relative';
  w.emit(d, `<radiusoffset method="${rMethod}">${num(node, 'radiusOffset', 0)}</radiusoffset>`); // meters
  const aMethod = node['angleMethod'] === 'fixed' ? 'fixed' : 'relative';
  // angleOffset is stored in radians → degrees on disk (same as cant).
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
  // RocketComponentSaver.addParams, as for every other component: the comment,
  // line style, color, overrides and carried appearance all belong to a stage
  // too. Only the name differs, since a stage the user never named is written
  // under its positional default.
  header(w, depth + 1, { ...st, name: stageFileName(st, i) }, '');
  // RASAero power-on base-drag input (meters, no conversion). Non-standard
  // element (OpenRocket desktop ignores it); only emitted when set > 0 so a
  // plain design round-trips exactly. Applies to every stage incl. sustainer.
  if (typeof st['nozzleExitDiameter'] === 'number' && st['nozzleExitDiameter'] > 0) {
    emit(depth + 1, `<nozzleexitdiameter>${st['nozzleExitDiameter']}</nozzleexitdiameter>`);
  }
  if (i > 0) {
    // Separation (lower stages only): desktop writes the default params
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
