import type { ComponentNode } from '../../engine/openRocketEngine';
import { COMPONENT_DEFAULTS } from '../componentDefaults';
import { IN, fmt, nnum, type Cdx1Writer } from './units';
import { SECTION_TO_AIRFOIL } from './surface';

/**
 * The sustainer's flat part chain (NoseCone / BodyTube / Transition, each
 * with an absolute <Location>) and the <Fin> block a tube or transition
 * nests. `finXml` is shared with the booster writer.
 */

const FIN_MIN = 3;
const FIN_MAX = 8;

/** Trapezoid planform of a fin set (m), or null when it has none. */
function finPlanform(fin: ComponentNode): { root: number; tip: number; sweep: number; height: number } | null {
  if (fin.type === 'trapezoidfinset') {
    return {
      root: nnum(fin, 'rootChord', 0.05),
      tip: nnum(fin, 'tipChord', 0.03),
      sweep: nnum(fin, 'sweep', 0),
      height: nnum(fin, 'height', 0.03),
    };
  }
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

/** The ONE fin set under `parent`, as a <Fin> block; nothing when it has none. */
export function finXml(w: Cdx1Writer, parent: ComponentNode): void {
  const { emit } = w;
  const finSets = (parent.children ?? []).filter((c) => c.type.endsWith('finset'));
  if (finSets.length === 0) return;
  if (finSets.length > 1) {
    throw new Error('RASAero allows ONE fin set per tube — remove extras or export as .ork.');
  }
  const fin = finSets[0]!;
  const plan = finPlanform(fin);
  if (!plan) {
    // Never drop fins silently — an aero program with no fins is a radically
    // different rocket.
    throw new Error(
      fin.type === 'freeformfinset'
        ? `RASAero fins are trapezoids — the freeform outline of “${fin.name ?? 'Fins'}” isn't a simple 3/4-point trapezoid. Simplify it or export as .ork.`
        : `RASAero has no ${fin.type === 'ellipticalfinset' ? 'elliptical' : 'tube'} fins — “${fin.name ?? 'Fins'}” can't be exported. Use trapezoid fins or export as .ork.`,
    );
  }
  const count = Math.round(nnum(fin, 'finCount', 3));
  if (count < FIN_MIN || count > FIN_MAX) {
    throw new Error(`RASAero needs 3–8 fins per set (found ${count}). Adjust "${fin.name ?? 'Fins'}".`);
  }
  const pos = fin.position ?? { method: 'bottom', offset: 0 };
  // Convert any position method to a bottom-referenced offset.
  const tubeLen = nnum(parent, 'length', 0);
  const bottomOffset =
    pos.method === 'bottom'
      ? pos.offset
      : pos.method === 'top'
        ? pos.offset + plan.root - tubeLen
        : pos.method === 'middle'
          ? pos.offset + (plan.root - tubeLen) / 2
          : 0; // 'absolute' has no tube-relative meaning here
  // Fin Location = front edge from the tube bottom (inches).
  const locIn = (plan.root - bottomOffset) * IN;
  const cs = String(fin['crossSection'] ?? 'square');
  // A supersonic airfoil section (feature #4) beats the plain cross section.
  const section = SECTION_TO_AIRFOIL[String(fin['airfoilSection'] ?? '')];
  // No <PartType> inside <Fin> — RASAero's parser is rigid.
  emit('<Fin>');
  emit(`<Count>${count}</Count>`);
  emit(`<Chord>${fmt(plan.root * IN)}</Chord>`);
  emit(`<Span>${fmt(plan.height * IN)}</Span>`);
  emit(`<SweepDistance>${fmt(plan.sweep * IN)}</SweepDistance>`);
  emit(`<TipChord>${fmt(plan.tip * IN)}</TipChord>`);
  emit(`<Thickness>${fmt(nnum(fin, 'thickness', 0.003) * IN)}</Thickness>`);
  emit(`<LERadius>${section ? fmt(nnum(fin, 'finLeRadius', 0) * IN) : '0'}</LERadius>`);
  emit(`<Location>${fmt(locIn)}</Location>`);
  emit(
    `<AirfoilSection>${section ?? (cs === 'airfoil' ? 'Subsonic NACA' : cs === 'rounded' ? 'Rounded' : 'Square')}</AirfoilSection>`,
  );
  emit(`<FX1>${section ? fmt(nnum(fin, 'airfoilLeDiamond', 0) * IN) : '0'}</FX1>`);
  emit(`<FX3>${fin['airfoilSection'] === 'hexagonal' ? fmt(nnum(fin, 'airfoilTeDiamond', 0) * IN) : '0'}</FX3>`);
  emit('</Fin>');
}

function noseXml(w: Cdx1Writer, node: ComponentNode): void {
  const { emit } = w;
  const shape = String(node['shape'] ?? 'ogive');
  const param = nnum(node, 'shapeParameter', NaN);
  let rasShape: string;
  let powerLaw: number | null = null;
  if (shape === 'conical') rasShape = 'Conical';
  else if (shape === 'ogive') rasShape = 'Tangent Ogive';
  else if (shape === 'ellipsoid') rasShape = 'Elliptical';
  else if (shape === 'haack')
    rasShape = !Number.isNaN(param) && Math.abs(param - 0.33) < 0.01 ? 'LV-Haack' : 'Von Karman Ogive';
  else if (shape === 'power') {
    rasShape = 'Power Law';
    powerLaw = Number.isNaN(param) ? 0.5 : param;
  } else
    throw new Error(
      `RASAero has no "${shape}" nose shape — use conical/ogive/ellipsoid/haack/power, or export as .ork.`,
    );
  const len = nnum(node, 'length', 0.07);
  emit('<NoseCone>');
  emit('<PartType>NoseCone</PartType>');
  emit(`<Length>${fmt(len * IN)}</Length>`);
  emit(`<Diameter>${fmt(nnum(node, 'aftRadius', 0.012) * 2 * IN)}</Diameter>`);
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
  const len = nnum(node, 'length', 0.2);
  emit('<BodyTube>');
  emit('<PartType>BodyTube</PartType>');
  emit(`<Length>${fmt(len * IN)}</Length>`);
  emit(`<Diameter>${fmt(nnum(node, 'outerRadius', 0.012) * 2 * IN)}</Diameter>`);
  const lug = (node.children ?? []).find((c) => c.type === 'launchlug');
  emit(`<LaunchLugDiameter>${fmt(lug ? nnum(lug, 'outerRadius', 0.0022) * 2 * IN : 0)}</LaunchLugDiameter>`);
  emit(`<LaunchLugLength>${fmt(lug ? nnum(lug, 'length', 0.05) * IN : 0)}</LaunchLugLength>`);
  // A rail button is RASAero's rail guide: its outer diameter and its total
  // standoff height (the .ork <height>, COMPONENT_DEFAULTS when the node
  // never carried one). These were hard-wired to 0, so a button's drag was
  // dropped from the export while a lug's was kept.
  const rail = (node.children ?? []).find((c) => c.type === 'railbutton');
  const rb = COMPONENT_DEFAULTS.railbutton;
  emit(`<RailGuideDiameter>${fmt(rail ? nnum(rail, 'outerDiameter', rb.outerDiameter) * IN : 0)}</RailGuideDiameter>`);
  emit(`<RailGuideHeight>${fmt(rail ? nnum(rail, 'height', rb.height) * IN : 0)}</RailGuideHeight>`);
  emit('<LaunchShoeArea>0</LaunchShoeArea>');
  emit(`<Location>${fmt(w.locM * IN)}</Location>`);
  emit('<Color>Black</Color>');
  emit('<BoattailLength>0</BoattailLength>');
  emit('<BoattailRearDiameter>0</BoattailRearDiameter>');
  emit('<BoattailOffset>0</BoattailOffset>');
  emit('<Overhang>0</Overhang>');
  finXml(w, node);
  emit('</BodyTube>');
  w.locM += len;
}

function transitionXml(w: Cdx1Writer, node: ComponentNode): void {
  const { emit } = w;
  if (String(node['shape'] ?? 'conical') !== 'conical') {
    throw new Error('RASAero transitions must be conical — change the shape or export as .ork.');
  }
  const len = nnum(node, 'length', 0.04);
  emit('<Transition>');
  emit('<PartType>Transition</PartType>');
  emit(`<Length>${fmt(len * IN)}</Length>`);
  emit(`<Diameter>${fmt(nnum(node, 'foreRadius', 0.012) * 2 * IN)}</Diameter>`);
  emit(`<RearDiameter>${fmt(nnum(node, 'aftRadius', 0.009) * 2 * IN)}</RearDiameter>`);
  emit(`<Location>${fmt(w.locM * IN)}</Location>`);
  emit('<Color>Black</Color>');
  finXml(w, node); // RASAero transitions/boat tails carry fins too
  emit('</Transition>');
  w.locM += len;
}

/** Sustainer chain (flat): every external part in order, advancing the location. */
export function writeSustainerChain(w: Cdx1Writer, sustainer: ComponentNode): void {
  for (const node of sustainer.children ?? []) {
    if (node.type === 'nosecone') noseXml(w, node);
    else if (node.type === 'bodytube') tubeXml(w, node);
    else if (node.type === 'transition') transitionXml(w, node);
    else if (node.type === 'podset' || node.type === 'parallelstage') {
      // Never drop an assembly silently, like the fin cases: a pod or a
      // strap-on booster is external aerodynamics RASAero's flat part list
      // cannot hold, and a file that quietly omits it describes a different
      // rocket (the desktop refuses these too, RASAeroExport.error33).
      throw new Error(
        `RASAero has no ${node.type === 'podset' ? 'pods' : 'parallel (strap-on) stages'}: "${node.name ?? node.type}" can't be exported. Remove it or export as .ork.`,
      );
    }
    // internals/others have no RASAero representation — silently external-only
  }
}
