import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import type { LaunchConditions } from './orkTree';
import { asStageNodes } from './orkTree';
import { escapeXml as esc } from './xmlUtil';

/**
 * RASAero II (.CDX1) design EXPORT. Ported from the sibling mmrocket-sim
 * `services/rasaeroFile.ts` (proven against real RASAero II 2026-08-25: the
 * exported single-stage file opened cleanly — "Motor: J350W (AT)", Loaded Wt.
 * 5.9966 lb). Format knowledge mirrors the desktop's file/rasaero package:
 * - Geometry in INCHES (× 39.37 from metres), diameters not radii; angles
 *   degrees; altitudes feet; weights pounds; speeds mph; pressure in-Hg.
 * - The airframe is a FLAT part list (NoseCone/BodyTube/Transition/Booster),
 *   each with an absolute <Location>; fins nest inside their parent tube. A
 *   <Booster> element IS a lower stage.
 * - RASAero is aerodynamics-only — masses/CG live in a mandatory <Simulation>
 *   block as CUMULATIVE per-stage launch weights (only the whole-rocket loaded
 *   mass/CG is known here, so it fills the last stage's cell; desktop parity).
 */

const IN = 39.37; // inches per metre (desktop OPENROCKET_TO_RASAERO_LENGTH)
const FT = 3.28084;
const LB = 2.20462262;
const MPH = 2.23694; // mph per m/s
const INHG = 33.8639; // hPa per in-Hg

/** Our airfoilSection ids → RASAero's supersonic airfoil strings (feature #4). */
const SECTION_TO_AIRFOIL: Record<string, string> = {
  doublewedge: 'Double Wedge',
  hexbluntbase: 'Hexagonal Blunt Base',
  hexagonal: 'Hexagonal',
  naca: 'NACA',
  biconvex: 'Biconvex',
  singlewedge: 'Single Wedge',
};

/** Our finish ids → RASAero's global surface strings (desktop mapping, approx). */
const FINISH_TO_SURFACE: Record<string, string> = {
  finishpolished: 'Polished',
  polished: 'Sheet Metal',
  smooth: 'Smooth Paint',
  normal: 'Rough Camouflage Paint',
  unfinished: 'Galvanized Metal',
  rough: 'Cast Iron (Very Rough)',
};

/**
 * Engine-string export gate — PROVEN against real RASAero II 2026-08-25. RASAero
 * looks every exported engine name up in its own motor database and throws a
 * NullReferenceException when the name is missing, so we only write manufacturers
 * it documents (unmapped ones are omitted entirely, never guessed).
 */
export const CDX1_ENGINE_EXPORT = true;

/**
 * Our manufacturer names → RASAero's engine-file abbreviations, from the
 * desktop's RASAeroCommonConstants.OPENROCKET_TO_RASAERO_MANUFACTURER. Keys are
 * matched normalized: uppercase, periods/commas stripped, whitespace collapsed.
 */
const RASAERO_MFG: Array<[abbrev: string, names: string[]]> = [
  ['AT', ['AEROTECH', 'AT', 'ISP']],
  ['ES', ['ESTES', 'ESTES INDUSTRIES', 'ES', 'E']],
  ['AP', ['APOGEE', 'APOGEE COMPONENTS', 'AP']],
  ['QU', ['QUEST', 'QUEST AEROSPACE', 'QU', 'Q']],
  ['CTI', ['CESARONI', 'CESARONI TECHNOLOGY', 'CESARONI TECHNOLOGY INC',
    'CESARONI TECHNOLOGY INCORPORATED', 'CTI', 'CES', 'PRO38']],
  ['EM', ['ELLIS', 'ELLIS MOUNTAIN', 'EM']],
  ['Contrail', ['CONTRAIL', 'CONTRAIL ROCKETS', 'CONTRAIL ROCKET', 'CR']],
  ['RV', ['ROCKETVISION', 'ROCKETVISION FLIGHT-STAR', 'ROCKET VISION', 'RV']],
  ['RR', ['ROADRUNNER', 'ROADRUNNER ROCKETRY', 'RR']],
  ['SRS', ['SKYR', 'SKY RIPPER', 'SKYRIPPER', 'SKY RIPPER SYSTEMS', 'SRS']],
  ['LR', ['LOKI', 'LOKI RESEARCH', 'LR']],
  ['PML', ['PML', 'PUBLIC MISSILES', 'PUBLIC MISSILES LTD', 'PUBLIC MISSILES LIMITED']],
  ['KBA', ['KBA', 'KOSDON BY AEROTECH', 'KOSDON/AT', 'KOSDON/AEROTECH', 'K-AT']],
  ['GM', ['GORILLA', 'GORILLA ROCKET MOTORS', 'GORILLA MOTORS', 'GM']],
  ['RTW', ['RATT', 'RATT WORKS', 'RTW', 'RT']],
  ['HT', ['HYPERTEK', 'HT']],
  ['AMW', ['AMW', 'ANIMAL MOTOR WORKS', 'ANIMAL', 'AMW PROX', 'AMW/PROX']],
];
const RASAERO_MFG_LOOKUP: Record<string, string> = Object.fromEntries(
  RASAERO_MFG.flatMap(([abbrev, names]) => names.map((n) => [n, abbrev])));

/**
 * The RASAero abbreviation for one of our manufacturer strings, or null when
 * RASAero doesn't document the maker — writing a name RASAero's database lacks
 * is the NRE, so unknown means OMIT, never guess.
 */
export function rasaeroManufacturerAbbrev(mfg: string | undefined): string | null {
  if (!mfg) return null;
  const n = mfg.trim().toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');
  if (n.startsWith('AEROTECH') || n.startsWith('AT-') || n.startsWith('RCS-')) return 'AT';
  return RASAERO_MFG_LOOKUP[n] ?? null;
}

/** Design-level `[mach, altitude m]` conditions table (RASAero's Mach-Alt table). */
export type MachAltTable = [number, number][];

/** The slice of a motor assignment the engine-string writer reads — the .ork
    export map (OrkExportMotor) satisfies it verbatim, extra fields ignored. */
export interface Cdx1ExportEngine {
  designation: string;
  manufacturer?: string;
  /** Kernel ignition-event name; only 'burnout' has a delay RASAero can hold. */
  ignitionEvent?: string;
  /** Seconds after the stage below's burnout (RASAero's own semantics). */
  ignitionDelay?: number;
}

export interface Cdx1ExportInput {
  name: string;
  tree: RocketTree;
  /** Loaded launch mass (kg) and CG (m), for the mandatory simulation block. */
  launchMassKg?: number;
  launchCgM?: number;
  /** Launch panel conditions (SI) for <LaunchSite>; RASAero defaults when absent. */
  launch?: Partial<LaunchConditions>;
  /** The design's Mach-Alt conditions table (SI); absent ⇒ empty <MachAlt>. */
  machAlt?: MachAltTable;
  /** Assigned motors keyed by mount node id; each stage's first mounted motor
      becomes its Engine string. Only read when engine export is enabled. */
  motors?: Record<string, Cdx1ExportEngine>;
  /** Engine-string override for tests; defaults to the CDX1_ENGINE_EXPORT gate. */
  engineExport?: boolean;
}

const FIN_MIN = 3;
const FIN_MAX = 8;

export function exportCdx1({ name, tree, launchMassKg, launchCgM, launch, motors, engineExport, machAlt }: Cdx1ExportInput): string {
  const stagesIn = asStageNodes(tree);
  if (stagesIn.length > 3) throw new Error('RASAero supports at most 3 stages.');

  // Per-stage engine strings, desktop format 'DESIGNATION  (ABBREV)' — two
  // spaces, the exact shape the importer's parseEngine reads back. null = no
  // motor on the stage, or a manufacturer RASAero doesn't document (the NRE risk).
  const engineOn = engineExport ?? CDX1_ENGINE_EXPORT;
  const stageSlots = stagesIn.map((st): { engine: string | null; ignitionDelay: number } => {
    if (!engineOn || !motors) return { engine: null, ignitionDelay: 0 };
    let found: Cdx1ExportEngine | undefined;
    const seek = (nodes: ComponentNode[]) => {
      for (const n of nodes) {
        if (found) return;
        if (n.id && motors[n.id]) { found = motors[n.id]; return; }
        seek(n.children ?? []);
      }
    };
    seek(st.children ?? []); // one engine per stage in RASAero — first mount wins
    // Only a burnout-triggered motor has a delay this format can express.
    const ignitionDelay = found?.ignitionEvent === 'burnout' ? (found.ignitionDelay ?? 0) : 0;
    const abbrev = found ? rasaeroManufacturerAbbrev(found.manufacturer) : null;
    return {
      engine: found && abbrev ? `${found.designation}  (${abbrev})` : null,
      ignitionDelay,
    };
  });
  const stageEngines = stageSlots.map((s) => s.engine);
  const stageIgnitionDelays = stageSlots.map((s) => s.ignitionDelay);

  const nnum = (node: ComponentNode, key: string, fb: number): number =>
    typeof node[key] === 'number' ? (node[key] as number) : fb;
  const fmt = (v: number): string => {
    const s = v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  };
  const lines: string[] = [];
  const emit = (s: string) => lines.push(s);

  let locM = 0; // running absolute location (nose tip origin)

  /** Trapezoid planform of a fin set (m), or null when it has none. */
  const finPlanform = (fin: ComponentNode): { root: number; tip: number; sweep: number; height: number } | null => {
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
      if (pts.length === 4 && flat(pts[0]![1]) && flat(pts[3]![1])
          && Math.abs(pts[1]![1] - pts[2]![1]) < eps && pts[1]![1] > 0
          && pts[2]![0] >= pts[1]![0] - eps) {
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
  };

  const finXml = (parent: ComponentNode): void => {
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
      throw new Error(fin.type === 'freeformfinset'
        ? `RASAero fins are trapezoids — the freeform outline of “${fin.name ?? 'Fins'}” isn't a simple 3/4-point trapezoid. Simplify it or export as .ork.`
        : `RASAero has no ${fin.type === 'ellipticalfinset' ? 'elliptical' : 'tube'} fins — “${fin.name ?? 'Fins'}” can't be exported. Use trapezoid fins or export as .ork.`);
    }
    const count = Math.round(nnum(fin, 'finCount', 3));
    if (count < FIN_MIN || count > FIN_MAX) {
      throw new Error(`RASAero needs 3–8 fins per set (found ${count}). Adjust "${fin.name ?? 'Fins'}".`);
    }
    const pos = fin.position ?? { method: 'bottom', offset: 0 };
    // Convert any position method to a bottom-referenced offset.
    const tubeLen = nnum(parent, 'length', 0);
    const bottomOffset = pos.method === 'bottom' ? pos.offset
      : pos.method === 'top' ? pos.offset + plan.root - tubeLen
      : pos.method === 'middle' ? pos.offset + (plan.root - tubeLen) / 2
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
    emit(`<AirfoilSection>${section ?? (cs === 'airfoil' ? 'Subsonic NACA' : cs === 'rounded' ? 'Rounded' : 'Square')}</AirfoilSection>`);
    emit(`<FX1>${section ? fmt(nnum(fin, 'airfoilLeDiamond', 0) * IN) : '0'}</FX1>`);
    emit(`<FX3>${fin['airfoilSection'] === 'hexagonal' ? fmt(nnum(fin, 'airfoilTeDiamond', 0) * IN) : '0'}</FX3>`);
    emit('</Fin>');
  };

  const noseXml = (node: ComponentNode) => {
    const shape = String(node['shape'] ?? 'ogive');
    const param = nnum(node, 'shapeParameter', NaN);
    let rasShape: string;
    let powerLaw: number | null = null;
    if (shape === 'conical') rasShape = 'Conical';
    else if (shape === 'ogive') rasShape = 'Tangent Ogive';
    else if (shape === 'ellipsoid') rasShape = 'Elliptical';
    else if (shape === 'haack') rasShape = !Number.isNaN(param) && Math.abs(param - 0.33) < 0.01 ? 'LV-Haack' : 'Von Karman Ogive';
    else if (shape === 'power') { rasShape = 'Power Law'; powerLaw = Number.isNaN(param) ? 0.5 : param; }
    else throw new Error(`RASAero has no "${shape}" nose shape — use conical/ogive/ellipsoid/haack/power, or export as .ork.`);
    const len = nnum(node, 'length', 0.07);
    emit('<NoseCone>');
    emit('<PartType>NoseCone</PartType>');
    emit(`<Length>${fmt(len * IN)}</Length>`);
    emit(`<Diameter>${fmt(nnum(node, 'aftRadius', 0.012) * 2 * IN)}</Diameter>`);
    emit(`<Shape>${rasShape}</Shape>`);
    emit('<BluntRadius>0</BluntRadius>');
    emit(`<Location>${fmt(locM * IN)}</Location>`);
    emit('<Color>Black</Color>');
    if (powerLaw !== null) emit(`<PowerLaw>${fmt(powerLaw)}</PowerLaw>`);
    emit('</NoseCone>');
    locM += len;
  };

  const tubeXml = (node: ComponentNode) => {
    const len = nnum(node, 'length', 0.2);
    emit('<BodyTube>');
    emit('<PartType>BodyTube</PartType>');
    emit(`<Length>${fmt(len * IN)}</Length>`);
    emit(`<Diameter>${fmt(nnum(node, 'outerRadius', 0.012) * 2 * IN)}</Diameter>`);
    const lug = (node.children ?? []).find((c) => c.type === 'launchlug');
    emit(`<LaunchLugDiameter>${fmt(lug ? nnum(lug, 'outerRadius', 0.0022) * 2 * IN : 0)}</LaunchLugDiameter>`);
    emit(`<LaunchLugLength>${fmt(lug ? nnum(lug, 'length', 0.05) * IN : 0)}</LaunchLugLength>`);
    emit('<RailGuideDiameter>0</RailGuideDiameter>');
    emit('<RailGuideHeight>0</RailGuideHeight>');
    emit('<LaunchShoeArea>0</LaunchShoeArea>');
    emit(`<Location>${fmt(locM * IN)}</Location>`);
    emit('<Color>Black</Color>');
    emit('<BoattailLength>0</BoattailLength>');
    emit('<BoattailRearDiameter>0</BoattailRearDiameter>');
    emit('<BoattailOffset>0</BoattailOffset>');
    emit('<Overhang>0</Overhang>');
    finXml(node);
    emit('</BodyTube>');
    locM += len;
  };

  const transitionXml = (node: ComponentNode) => {
    if (String(node['shape'] ?? 'conical') !== 'conical') {
      throw new Error('RASAero transitions must be conical — change the shape or export as .ork.');
    }
    const len = nnum(node, 'length', 0.04);
    emit('<Transition>');
    emit('<PartType>Transition</PartType>');
    emit(`<Length>${fmt(len * IN)}</Length>`);
    emit(`<Diameter>${fmt(nnum(node, 'foreRadius', 0.012) * 2 * IN)}</Diameter>`);
    emit(`<RearDiameter>${fmt(nnum(node, 'aftRadius', 0.009) * 2 * IN)}</RearDiameter>`);
    emit(`<Location>${fmt(locM * IN)}</Location>`);
    emit('<Color>Black</Color>');
    finXml(node); // RASAero transitions/boat tails carry fins too
    emit('</Transition>');
    locM += len;
  };

  emit('<RASAeroDocument>');
  emit('<FileVersion>2</FileVersion>');
  emit('<RocketDesign>');

  // Sustainer chain (flat).
  for (const node of stagesIn[0]!.children ?? []) {
    if (node.type === 'nosecone') noseXml(node);
    else if (node.type === 'bodytube') tubeXml(node);
    else if (node.type === 'transition') transitionXml(node);
    // internals/others have no RASAero representation — silently external-only
  }

  // Boosters (each lower stage). A leading widening transition is the shoulder
  // into the stage above; a trailing narrowing one is the boat tail.
  for (let i = 1; i < stagesIn.length; i++) {
    const st = stagesIn[i]!;
    const kids = st.children ?? [];
    const tubes = kids.filter((c) => c.type === 'bodytube');
    if (tubes.length === 0) {
      throw new Error(`Stage "${st.name}" has no body tube — RASAero boosters need one.`);
    }
    const bodyLen = tubes.reduce((s, t) => s + nnum(t, 'length', 0.1), 0);
    const externals = kids.filter((c) => c.type === 'bodytube' || c.type === 'transition');
    const first = externals[0];
    const shoulder = first && first.type === 'transition'
      && nnum(first, 'foreRadius', 0) <= nnum(first, 'aftRadius', 0) ? first : null;
    const last = externals[externals.length - 1];
    const boattail = last && last !== shoulder && last.type === 'transition'
      && nnum(last, 'foreRadius', 0) > nnum(last, 'aftRadius', 0) ? last : null;
    const extraTrans = kids.filter((c) => c.type === 'transition' && c !== shoulder && c !== boattail);
    if (extraTrans.length > 0) {
      throw new Error(`RASAero boosters support only a shoulder and a boat tail — stage "${st.name}" has other transitions; export as .ork.`);
    }
    const shoulderLen = shoulder ? nnum(shoulder, 'length', 0) : 0;
    const btLen = boattail ? nnum(boattail, 'length', 0) : 0;
    const finParents = kids.filter((c) => (c.children ?? []).some((k) => k.type.endsWith('finset')));
    if (finParents.length > 1) {
      throw new Error(`RASAero allows ONE fin set per booster — stage "${st.name}" has several; export as .ork.`);
    }
    emit('<Booster>');
    emit('<PartType>Booster</PartType>');
    emit(`<Length>${fmt(bodyLen * IN)}</Length>`);
    emit(`<Diameter>${fmt(nnum(tubes[0]!, 'outerRadius', 0.012) * 2 * IN)}</Diameter>`);
    emit(`<InsideDiameter>${fmt((shoulder ? nnum(shoulder, 'foreRadius', 0.012) : nnum(tubes[0]!, 'outerRadius', 0.012)) * 2 * IN)}</InsideDiameter>`);
    emit('<LaunchLugDiameter>0</LaunchLugDiameter>');
    emit('<LaunchLugLength>0</LaunchLugLength>');
    emit('<RailGuideDiameter>0</RailGuideDiameter>');
    emit('<RailGuideHeight>0</RailGuideHeight>');
    emit('<LaunchShoeArea>0</LaunchShoeArea>');
    // The booster body starts after the shoulder (which slides into the stage above).
    emit(`<Location>${fmt((locM + shoulderLen) * IN)}</Location>`);
    emit('<Color>Black</Color>');
    emit(`<ShoulderLength>${fmt(shoulderLen * IN)}</ShoulderLength>`);
    emit('<NozzleExitDiameter>0</NozzleExitDiameter>');
    emit(`<BoattailLength>${fmt(btLen * IN)}</BoattailLength>`);
    emit(`<BoattailRearDiameter>${fmt(boattail ? nnum(boattail, 'aftRadius', 0) * 2 * IN : 0)}</BoattailRearDiameter>`);
    finXml(finParents[0] ?? tubes[0]!);
    emit('</Booster>');
    locM += shoulderLen + bodyLen + btLen;
  }

  // Global surface from the first finished external part.
  const surface = (() => {
    const walk = (nodes: ComponentNode[]): string | null => {
      for (const n of nodes) {
        if (typeof n['finish'] === 'string' && FINISH_TO_SURFACE[n['finish'] as string]) {
          return FINISH_TO_SURFACE[n['finish'] as string]!;
        }
        const hit = walk(n.children ?? []);
        if (hit) return hit;
      }
      return null;
    };
    return walk(stagesIn) ?? 'Rough Camouflage Paint';
  })();
  emit(`<Surface>${surface}</Surface>`);
  emit('<CD>0</CD>');
  emit('<ModifiedBarrowman>False</ModifiedBarrowman>');
  emit('<Turbulence>False</Turbulence>');
  emit('<SustainerNozzle>0</SustainerNozzle>');
  emit('<Booster1Nozzle>0</Booster1Nozzle>');
  emit('<Booster2Nozzle>0</Booster2Nozzle>');
  emit(`<UseBooster1>${stagesIn.length >= 2 ? 'True' : 'False'}</UseBooster1>`);
  emit(`<UseBooster2>${stagesIn.length === 3 ? 'True' : 'False'}</UseBooster2>`);
  emit(`<Comments>${esc(name)}</Comments>`);
  emit('</RocketDesign>');

  // Launch site back to RASAero units (feet / °F / in-Hg / mph). Pressure 0 is
  // RASAero's own "unset"; Temperature has no unset, so ISA null becomes 59 °F.
  emit('<LaunchSite>');
  emit(`<Altitude>${fmt((launch?.launchAltitudeM ?? 0) * FT)}</Altitude>`);
  emit(`<Pressure>${launch ? (launch.pressureHPa != null ? fmt(launch.pressureHPa / INHG) : '0') : '29.92'}</Pressure>`);
  emit(`<RodAngle>${fmt(launch?.launchRodAngleDeg ?? 0)}</RodAngle>`);
  emit(`<RodLength>${launch?.launchRodLengthM != null ? fmt(launch.launchRodLengthM * FT) : '10'}</RodLength>`);
  emit(`<Temperature>${launch?.temperatureC != null ? fmt(launch.temperatureC * 9 / 5 + 32) : '59'}</Temperature>`);
  emit(`<WindSpeed>${fmt((launch?.windAverage ?? 0) * MPH)}</WindSpeed>`);
  emit('</LaunchSite>');

  // Recovery: first two parachutes anywhere in the design.
  const chutes: ComponentNode[] = [];
  const findChutes = (nodes: ComponentNode[]) => {
    for (const n of nodes) {
      if (n.type === 'parachute' && chutes.length < 2) chutes.push(n);
      findChutes(n.children ?? []);
    }
  };
  findChutes(stagesIn);
  const slotVals = ([1, 2] as const).map((slot) => {
    const c = chutes[slot - 1];
    const ev = c ? String(c['deployEvent'] ?? 'apogee') : 'none';
    const evType = ev === 'apogee' ? 'Apogee' : ev === 'altitude' ? 'Altitude' : 'None';
    return {
      altitude: fmt(c && evType === 'Altitude' ? nnum(c, 'deployAltitude', 150) * FT : 0),
      deviceType: c ? 'Parachute' : 'None',
      event: c && evType !== 'None' ? 'True' : 'False',
      size: fmt(c ? nnum(c, 'diameter', 0.9) * IN : 0),
      eventType: c ? evType : 'None',
      cd: fmt(c ? nnum(c, 'cd', 0.75) : 0),
    };
  });
  emit('<Recovery>');
  for (const slot of [1, 2] as const) emit(`<Altitude${slot}>${slotVals[slot - 1]!.altitude}</Altitude${slot}>`);
  for (const slot of [1, 2] as const) emit(`<DeviceType${slot}>${slotVals[slot - 1]!.deviceType}</DeviceType${slot}>`);
  for (const slot of [1, 2] as const) emit(`<Event${slot}>${slotVals[slot - 1]!.event}</Event${slot}>`);
  for (const slot of [1, 2] as const) emit(`<Size${slot}>${slotVals[slot - 1]!.size}</Size${slot}>`);
  for (const slot of [1, 2] as const) emit(`<EventType${slot}>${slotVals[slot - 1]!.eventType}</EventType${slot}>`);
  for (const slot of [1, 2] as const) emit(`<CD${slot}>${slotVals[slot - 1]!.cd}</CD${slot}>`);
  emit('</Recovery>');

  // Mach-Alt conditions table. No table ⇒ the empty element (RASAero's "unset").
  if (machAlt && machAlt.length > 0) {
    emit('<MachAlt>');
    for (const [mach, altM] of machAlt) emit(`<Item>${fmt(mach)}, ${fmt(altM * FT)}</Item>`);
    emit('</MachAlt>');
  } else {
    emit('<MachAlt></MachAlt>');
  }

  // Simulation block: RASAero's loader dereferences EVERY child without null
  // checks, so its own files always carry all of these. The *Engine elements are
  // the only optional ones and must be OMITTED (not written empty) when there is
  // no motor. The per-stage weight/CG cells are CUMULATIVE — we know only the
  // whole rocket's loaded mass/CG, so only the LAST stage's cell can be filled.
  const lastStage = stagesIn.length - 1;
  const stackWt = (i: number): string => fmt((i === lastStage ? (launchMassKg ?? 0) : 0) * LB);
  const stackCg = (i: number): string => fmt((i === lastStage ? (launchCgM ?? 0) : 0) * IN);
  const stageSeparationDelay = (i: number): string => {
    const st = stagesIn[i];
    return fmt(st && String(st['separationEvent'] ?? 'ejection') === 'burnout'
      ? nnum(st, 'separationDelay', 0) : 0);
  };
  emit('<SimulationList>');
  emit('<Simulation>');
  if (stageEngines[0]) emit(`<SustainerEngine>${esc(stageEngines[0])}</SustainerEngine>`);
  emit(`<SustainerLaunchWt>${stackWt(0)}</SustainerLaunchWt>`);
  emit('<SustainerNozzleDiameter>0</SustainerNozzleDiameter>');
  emit(`<SustainerCG>${stackCg(0)}</SustainerCG>`);
  emit(`<SustainerIgnitionDelay>${stageIgnitionDelays[0] ?? 0}</SustainerIgnitionDelay>`);
  if (stageEngines[1]) emit(`<Booster1Engine>${esc(stageEngines[1])}</Booster1Engine>`);
  emit(`<Booster1LaunchWt>${stackWt(1)}</Booster1LaunchWt>`);
  emit(`<Booster1SeparationDelay>${stageSeparationDelay(1)}</Booster1SeparationDelay>`);
  emit(`<Booster1IgnitionDelay>${stageIgnitionDelays[1] ?? 0}</Booster1IgnitionDelay>`);
  emit(`<Booster1CG>${stackCg(1)}</Booster1CG>`);
  emit('<Booster1NozzleDiameter>0</Booster1NozzleDiameter>');
  emit(`<IncludeBooster1>${stageEngines[1] ? 'True' : 'False'}</IncludeBooster1>`);
  if (stageEngines[2]) emit(`<Booster2Engine>${esc(stageEngines[2])}</Booster2Engine>`);
  emit(`<Booster2LaunchWt>${stackWt(2)}</Booster2LaunchWt>`);
  emit(`<Booster2Delay>${stageSeparationDelay(2)}</Booster2Delay>`);
  emit(`<Booster2CG>${stackCg(2)}</Booster2CG>`);
  emit('<Booster2NozzleDiameter>0</Booster2NozzleDiameter>');
  emit(`<IncludeBooster2>${stageEngines[2] ? 'True' : 'False'}</IncludeBooster2>`);
  emit('<FlightTime>0</FlightTime>');
  emit('<TimetoApogee>0</TimetoApogee>');
  emit('<MaxAltitude>0</MaxAltitude>');
  emit('<MaxVelocity>0</MaxVelocity>');
  emit('<OptimumWt>0</OptimumWt>');
  emit('<OptimumMaxAlt>0</OptimumMaxAlt>');
  emit('</Simulation>');
  emit('</SimulationList>');
  emit('</RASAeroDocument>');
  return lines.join('\n');
}

/** Export a design as a .CDX1 file the user downloads. */
export function downloadCdx1(input: Cdx1ExportInput): void {
  const xml = exportCdx1(input);
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(input.name || 'rocket').trim().replace(/[^a-z0-9._-]+/gi, '_') || 'rocket'}.CDX1`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
