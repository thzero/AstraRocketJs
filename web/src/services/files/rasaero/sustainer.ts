import type { ComponentNode, ComponentPosition } from '../../../engine/openRocketEngine';
import { COMPONENT_DEFAULTS } from '../../design/componentDefaults';
import { nodeShape, shapeParamDefault } from '../../../tree/shapeProfile';
import { IN, fmt, type Cdx1Writer } from './units';
import { SECTION_TO_AIRFOIL } from './surface';
import { num, positionOf, str } from '../../../tree/nodeProps';
import { partLength, startFromPosition } from '../../../tree/position';
import { trapezoidDims } from '../../../tree/finPlanform';
import { isFinSet } from '../../../tree/tubefins';
import { isAssembly } from '../../../tree/assembly';
import { KeyedError, type Keyed } from '../../../i18n/keyedError';
import { mathEquals } from '../../motors/mathEquals';

/** A part as an export refusal names it: its own name, else its translated type. */
export const partName = (node: ComponentNode): string | Keyed => node.name || { key: `part.${node.type}` };

/**
 * The sustainer's flat part chain (NoseCone / BodyTube / Transition, each
 * with an absolute <Location>) and the <Fin> block a tube or transition
 * nests. `finXml` is shared with the booster writer.
 */

const FIN_MIN = 3;
const FIN_MAX = 8;

/** Trapezoid planform of a fin set (m), or null when it has none. */
function finPlanform(fin: ComponentNode): { root: number; tip: number; sweep: number; height: number } | null {
  if (fin.type === 'trapezoidfinset') return trapezoidDims(fin);
  if (fin.type === 'freeformfinset') {
    // Exact conversion for trapezoid-shaped outlines.
    const pts = (fin['points'] as [number, number][] | undefined) ?? [];
    const eps = 1e-9;
    const flat = (v: number) => Math.abs(v) < eps;
    if (
      pts.length === 4 &&
      flat(pts[0]![1]) &&
      flat(pts[3]![1]) &&
      Math.abs(pts[1]![1] - pts[2]![1]) < eps &&
      pts[1]![1] > 0 &&
      pts[2]![0] >= pts[1]![0] - eps
    ) {
      return {
        root: pts[3]![0] - pts[0]![0],
        tip: pts[2]![0] - pts[1]![0],
        sweep: pts[1]![0] - pts[0]![0],
        height: pts[1]![1],
      };
    }
    if (pts.length === 3 && flat(pts[0]![1]) && flat(pts[2]![1]) && pts[1]![1] > 0) {
      return {
        root: pts[2]![0] - pts[0]![0],
        tip: 0,
        sweep: pts[1]![0] - pts[0]![0],
        height: pts[1]![1],
      };
    }
  }
  return null;
}

/**
 * The one fin set under `parent`, as a <Fin> block; nothing when it has none.
 * `parentStart` is where the parent starts from the nose tip, which an
 * `absolute` fin set is measured from.
 *
 * `below` is the length of body that continues past the parent's bottom
 * within the same RASAero part, which the fin's Location is measured from the
 * bottom of: a booster made of several tubes (see writeBoosters).
 */
export function finXml(w: Cdx1Writer, parent: ComponentNode, parentStart: number, below = 0): void {
  const { emit } = w;
  const finSets = (parent.children ?? []).filter((c) => isFinSet(c.type));
  if (finSets.length === 0) return;
  if (finSets.length > 1) {
    throw new KeyedError('errors.rasaero.tubeFins');
  }
  const fin = finSets[0]!;
  const plan = finPlanform(fin);
  if (!plan) {
    // Never drop fins silently: an aero program with no fins is a radically
    // different rocket.
    throw new KeyedError(
      fin.type === 'freeformfinset'
        ? 'errors.rasaero.freeformFins'
        : fin.type === 'ellipticalfinset'
          ? 'errors.rasaero.ellipticalFins'
          : 'errors.rasaero.tubeFinsUnsupported',
      { name: partName(fin) },
    );
  }
  const count = Math.round(num(fin, 'finCount', 3));
  if (count < FIN_MIN || count > FIN_MAX) {
    throw new KeyedError('errors.rasaero.finCount', { found: count, name: partName(fin) });
  }
  const pos: ComponentPosition = fin.position ? positionOf(fin) : { method: 'bottom', offset: 0 };
  // Convert any position method to a bottom-referenced offset: the fin's front
  // from the tube's top, less the gap the root leaves to the tube's bottom.
  const tubeLen = num(parent, 'length', 0);
  const bottomOffset = startFromPosition(pos, plan.root, tubeLen, parentStart) + plan.root - tubeLen;
  // Fin Location = front edge from the part's bottom (inches).
  const locIn = (plan.root - bottomOffset + below) * IN;
  const cs = str(fin, 'crossSection', 'square');
  // A supersonic airfoil section beats the plain cross section.
  const section = SECTION_TO_AIRFOIL.get(str(fin, 'airfoilSection', ''));
  // No <PartType> inside <Fin>: RASAero's parser is rigid.
  emit('<Fin>');
  emit(`<Count>${count}</Count>`);
  emit(`<Chord>${fmt(plan.root * IN)}</Chord>`);
  emit(`<Span>${fmt(plan.height * IN)}</Span>`);
  emit(`<SweepDistance>${fmt(plan.sweep * IN)}</SweepDistance>`);
  emit(`<TipChord>${fmt(plan.tip * IN)}</TipChord>`);
  emit(`<Thickness>${fmt(num(fin, 'thickness', 0.003) * IN)}</Thickness>`);
  emit(`<LERadius>${section ? fmt(num(fin, 'finLeRadius', 0) * IN) : '0'}</LERadius>`);
  emit(`<Location>${fmt(locIn)}</Location>`);
  emit(
    `<AirfoilSection>${section ?? (cs === 'airfoil' ? 'Subsonic NACA' : cs === 'rounded' ? 'Rounded' : 'Square')}</AirfoilSection>`,
  );
  emit(`<FX1>${section ? fmt(num(fin, 'airfoilLeDiamond', 0) * IN) : '0'}</FX1>`);
  emit(`<FX3>${fin['airfoilSection'] === 'hexagonal' ? fmt(num(fin, 'airfoilTeDiamond', 0) * IN) : '0'}</FX3>`);
  emit('</Fin>');
}

function noseXml(w: Cdx1Writer, node: ComponentNode): void {
  const { emit } = w;
  // A flipped nose cone is a tail cone, which RASAero has no part for.
  if (node['flipped'] === true) throw new KeyedError('errors.rasaero.noseFlipped', { name: partName(node) });
  const shape = nodeShape(node);
  // An absent parameter flies as the shape's default (ogive 1, Haack 0).
  const param = num(node, 'shapeParameter', shapeParamDefault(shape));
  let rasShape: string;
  let powerLaw: number | null = null;
  // RASAero has one ogive (tangent) and two Haack noses, so desktop
  // (RASAeroCommonConstants.OPENROCKET_TO_RASAERO_SHAPE) takes an ogive only at
  // parameter 1 and a Haack only at 0 or 0.33, and refuses the rest rather than
  // export a different shape for RASAero to compute drag on.
  const value = Number(param.toFixed(3));
  if (shape === 'conical') rasShape = 'Conical';
  else if (shape === 'ogive') {
    if (!mathEquals(param, 1))
      throw new KeyedError('errors.rasaero.noseOgiveParameter', { name: partName(node), value });
    rasShape = 'Tangent Ogive';
  } else if (shape === 'ellipsoid') rasShape = 'Elliptical';
  else if (shape === 'haack') {
    if (mathEquals(param, 0)) rasShape = 'Von Karman Ogive';
    // Within 1% of 0.33, which leaves out 1/3 itself, as desktop does.
    else if (mathEquals(param, 0.33, 0.01)) rasShape = 'LV-Haack';
    else throw new KeyedError('errors.rasaero.noseHaackParameter', { name: partName(node), value });
  } else if (shape === 'power') {
    rasShape = 'Power Law';
    powerLaw = param;
  } else throw new KeyedError('errors.rasaero.noseShape', { shape: { key: `noseShape.${shape}` } });
  const len = num(node, 'length', 0.07);
  emit('<NoseCone>');
  emit('<PartType>NoseCone</PartType>');
  emit(`<Length>${fmt(len * IN)}</Length>`);
  emit(`<Diameter>${fmt(num(node, 'aftRadius', 0.012) * 2 * IN)}</Diameter>`);
  emit(`<Shape>${rasShape}</Shape>`);
  emit('<BluntRadius>0</BluntRadius>');
  emit(`<Location>${fmt(w.locM * IN)}</Location>`);
  emit('<Color>Black</Color>');
  if (powerLaw !== null) emit(`<PowerLaw>${fmt(powerLaw)}</PowerLaw>`);
  emit('</NoseCone>');
  w.locM += len;
}

function tubeXml(w: Cdx1Writer, node: ComponentNode): void {
  const { emit } = w;
  const len = partLength(node);
  emit('<BodyTube>');
  emit('<PartType>BodyTube</PartType>');
  emit(`<Length>${fmt(len * IN)}</Length>`);
  emit(`<Diameter>${fmt(num(node, 'outerRadius', 0.012) * 2 * IN)}</Diameter>`);
  const lug = (node.children ?? []).find((c) => c.type === 'launchlug');
  emit(`<LaunchLugDiameter>${fmt(lug ? num(lug, 'outerRadius', 0.0022) * 2 * IN : 0)}</LaunchLugDiameter>`);
  emit(`<LaunchLugLength>${fmt(lug ? num(lug, 'length', 0.05) * IN : 0)}</LaunchLugLength>`);
  // A rail button is RASAero's rail guide: its outer diameter and its total
  // standoff height (the .ork <height>, COMPONENT_DEFAULTS when the node
  // never carried one), so a button's drag reaches the export as a lug's does.
  const rail = (node.children ?? []).find((c) => c.type === 'railbutton');
  const rb = COMPONENT_DEFAULTS.railbutton;
  emit(`<RailGuideDiameter>${fmt(rail ? num(rail, 'outerDiameter', rb.outerDiameter) * IN : 0)}</RailGuideDiameter>`);
  emit(`<RailGuideHeight>${fmt(rail ? num(rail, 'height', rb.height) * IN : 0)}</RailGuideHeight>`);
  emit('<LaunchShoeArea>0</LaunchShoeArea>');
  emit(`<Location>${fmt(w.locM * IN)}</Location>`);
  emit('<Color>Black</Color>');
  emit('<BoattailLength>0</BoattailLength>');
  emit('<BoattailRearDiameter>0</BoattailRearDiameter>');
  emit('<BoattailOffset>0</BoattailOffset>');
  emit('<Overhang>0</Overhang>');
  finXml(w, node, w.locM);
  emit('</BodyTube>');
  w.locM += len;
}

function transitionXml(w: Cdx1Writer, node: ComponentNode, boattail: boolean): void {
  const { emit } = w;
  if (nodeShape(node) !== 'conical') {
    throw new KeyedError('errors.rasaero.transitionShape');
  }
  const len = partLength(node);
  const tag = boattail ? 'BoatTail' : 'Transition';
  emit(`<${tag}>`);
  emit(`<PartType>${tag}</PartType>`);
  emit(`<Length>${fmt(len * IN)}</Length>`);
  // Desktop's BasePartDTO writes a transition's <Diameter> from its aft radius,
  // the same value as <RearDiameter>.
  const rear = fmt(num(node, 'aftRadius', 0.009) * 2 * IN);
  emit(`<Diameter>${rear}</Diameter>`);
  emit(`<RearDiameter>${rear}</RearDiameter>`);
  emit(`<Location>${fmt(w.locM * IN)}</Location>`);
  emit('<Color>Black</Color>');
  finXml(w, node, w.locM); // RASAero transitions/boat tails carry fins too
  emit(`</${tag}>`);
  w.locM += len;
}

/**
 * Sustainer chain (flat): every external part in order, advancing the location.
 *
 * The order rules are RASAero's, as the desktop's RocketDesignDTO enforces them:
 * the chain starts with a nose cone and has no other; the second part is a body
 * tube, or a transition that ends the chain. A transition ending the chain of a
 * single-stage rocket is RASAero's boat tail.
 */
export function writeSustainerChain(w: Cdx1Writer, sustainer: ComponentNode, stageCount: number): void {
  const chain = (sustainer.children ?? []).filter(
    (c) => c.type === 'nosecone' || c.type === 'bodytube' || c.type === 'transition' || isAssembly(c.type),
  );
  chain.forEach((node, i) => {
    if (isAssembly(node.type)) {
      // Never drop an assembly silently, like the fin cases: a pod or a
      // strap-on booster is external aerodynamics RASAero's flat part list
      // cannot hold, and a file that quietly omits it describes a different
      // rocket (the desktop refuses these too, RASAeroExport.error33).
      throw new KeyedError(node.type === 'podset' ? 'errors.rasaero.noPods' : 'errors.rasaero.noParallel', {
        name: partName(node),
      });
    }
    const last = i === chain.length - 1;
    if (i === 0 && node.type !== 'nosecone') {
      throw new KeyedError('errors.rasaero.noseFirst', { name: partName(node) });
    }
    if (i === 1 && !(node.type === 'bodytube' || (node.type === 'transition' && last))) {
      throw new KeyedError('errors.rasaero.secondPart', { name: partName(node) });
    }
    if (node.type === 'nosecone') {
      if (i !== 0) throw new KeyedError('errors.rasaero.noseNotFirst', { name: partName(node) });
      noseXml(w, node);
    } else if (node.type === 'bodytube') tubeXml(w, node);
    else transitionXml(w, node, stageCount === 1 && last);
  });
  // Internals and other parts have no RASAero representation and are left out.
}
