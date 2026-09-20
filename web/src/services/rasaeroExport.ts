import type { RocketTree } from '../engine/openRocketEngine';
import type { LaunchConditions } from './orkTree';
import { asStageNodes } from './orkTree';
import { escapeXml as esc } from './xmlUtil';
import { saveBlob, safeFilename } from './saveFile';
import { createCdx1Writer } from './rasaero/units';
import { designSurface } from './rasaero/surface';
import { CDX1_ENGINE_EXPORT, stageEngineSlots, type Cdx1ExportEngine } from './rasaero/engines';
import { writeSustainerChain } from './rasaero/sustainer';
import { writeBoosters } from './rasaero/booster';
import { writeRecovery } from './rasaero/recovery';
import { writeLaunchSite } from './rasaero/launchSite';
import { writeMachAlt, writeSimulationList, type MachAltTable } from './rasaero/simulation';

export { rasaeroSurface, RASAERO_SURFACE_DEFAULT } from './rasaero/surface';
export type { Cdx1ExportEngine } from './rasaero/engines';
export type { MachAltTable } from './rasaero/simulation';

/**
 * RASAero II (.CDX1) design EXPORT. Ported from the sibling mmrocket-sim
 * `services/rasaeroFile.ts` (proven against real RASAero II 2026-08-25: the
 * exported single-stage file opened cleanly — "Motor: J350W (AT)", Loaded Wt.
 * 5.9966 lb). Format knowledge mirrors the desktop's file/rasaero package:
 * - Geometry in INCHES (× 39.37 from meters), diameters not radii; angles
 *   degrees; altitudes feet; weights pounds; speeds mph; pressure in-Hg.
 * - The airframe is a FLAT part list (NoseCone/BodyTube/Transition/Booster),
 *   each with an absolute <Location>; fins nest inside their parent tube. A
 *   <Booster> element IS a lower stage.
 * - RASAero is aerodynamics-only — masses/CG live in a mandatory <Simulation>
 *   block as CUMULATIVE per-stage launch weights (only the whole-rocket loaded
 *   mass/CG is known here, so it fills the last stage's cell; desktop parity).
 *
 * This module is the orchestrator: the sustainer chain, boosters, recovery,
 * launch site, engines and simulation blocks each live under `rasaero/`.
 */

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
  /**
   * Collects the non-fatal notes the desktop exporter would raise as warnings
   * (a finish with no RASAero surface, say). Optional so existing callers are
   * untouched; without it the notes are simply not kept.
   */
  warnings?: string[];
}

export function exportCdx1({
  name,
  tree,
  launchMassKg,
  launchCgM,
  launch,
  motors,
  engineExport,
  machAlt,
  warnings,
}: Cdx1ExportInput): string {
  const stagesIn = asStageNodes(tree);
  if (stagesIn.length > 3) throw new Error('RASAero supports at most 3 stages.');

  const slots = stageEngineSlots(stagesIn, motors, engineExport ?? CDX1_ENGINE_EXPORT);
  const w = createCdx1Writer();
  const { emit } = w;

  emit('<RASAeroDocument>');
  emit('<FileVersion>2</FileVersion>');
  emit('<RocketDesign>');
  writeSustainerChain(w, stagesIn[0]!);
  writeBoosters(w, stagesIn);
  emit(`<Surface>${designSurface(stagesIn, warnings)}</Surface>`);
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
  writeLaunchSite(w, launch);
  writeRecovery(w, stagesIn);
  writeMachAlt(w, machAlt);
  writeSimulationList(w, stagesIn, slots, launchMassKg, launchCgM);
  emit('</RASAeroDocument>');
  return w.lines.join('\n');
}

/** Export a design as a .CDX1 file the user downloads. */
export function downloadCdx1(input: Cdx1ExportInput): void {
  const xml = exportCdx1(input);
  const blob = new Blob([xml], { type: 'application/xml' });
  void saveBlob(blob, `${safeFilename(input.name)}.CDX1`);
}
