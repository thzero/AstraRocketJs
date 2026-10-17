import type { RocketTree } from '../../engine/openRocketEngine';
import type { LaunchConditions } from '../design/orkTree';
import { asStageNodes } from '../design/orkTree';
import { escapeXml as esc } from './xmlUtil';
import { saveBlob, exportFilename } from './saveFile';
import { createCdx1Writer } from './rasaero/units';
import { designSurface } from './rasaero/surface';
import { CDX1_ENGINE_EXPORT, stageEngineSlots, type Cdx1ExportEngine } from './rasaero/engines';
import { writeSustainerChain } from './rasaero/sustainer';
import { writeBoosters } from './rasaero/booster';
import { writeRecovery } from './rasaero/recovery';
import { writeLaunchSite } from './rasaero/launchSite';
import { KeyedError, type Keyed } from '../../i18n/keyedError';
import { writeMachAlt, writeSimulationList, type MachAltTable } from './rasaero/simulation';
import type { StageLaunch } from './rasaero/stageLaunch';

/**
 * RASAero II (.CDX1) design export. Format knowledge mirrors the desktop's
 * file/rasaero package:
 * - Geometry in inches (× 39.37 from meters), diameters not radii; angles
 *   degrees; altitudes feet; weights pounds; speeds mph; pressure in-Hg.
 * - The airframe is a flat part list (NoseCone/BodyTube/Transition/Booster),
 *   each with an absolute <Location>; fins nest inside their parent tube. A
 *   <Booster> element is a lower stage.
 * - RASAero is aerodynamics-only: masses/CG live in a mandatory <Simulation>
 *   block as cumulative per-stage launch weights, each stage's cell the stack
 *   from the sustainer through it, from the kernel (`cumulativeStageLaunch`).
 *
 * This module is the orchestrator: the sustainer chain, boosters, recovery,
 * launch site, engines and simulation blocks each live under `rasaero/`.
 */

export interface Cdx1ExportInput {
  name: string;
  tree: RocketTree;
  /**
   * The whole rocket's loaded launch mass (kg) and CG (m): the only stage's
   * cell of a single-stage design. A design with more stages needs
   * `stageLaunch`, since the cells are cumulative per stage and the whole
   * rocket's figure is only the last one.
   */
  launchMassKg?: number;
  launchCgM?: number;
  /**
   * Each top-level stage's cell, by stage index: the launch mass and CG of
   * the stack from the sustainer through that stage with its motors, as the
   * kernel weighs it (`cumulativeStageLaunch`). Wins over `launchMassKg` and
   * `launchCgM` when given.
   */
  stageLaunch?: readonly StageLaunch[];
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
   * (a finish with no RASAero surface, say), keyed for the banner. Optional;
   * without it the notes are not kept.
   */
  warnings?: Keyed[];
}

export function exportCdx1({
  name,
  tree,
  launchMassKg,
  launchCgM,
  stageLaunch,
  launch,
  motors,
  engineExport,
  machAlt,
  warnings,
}: Cdx1ExportInput): string {
  const stagesIn = asStageNodes(tree);
  if (stagesIn.length > 3) throw new KeyedError('errors.rasaero.tooManyStages', { max: 3 });
  // A single stage's cell is the whole rocket; any other stage's needs its own
  // cumulative figure, which the whole rocket's mass does not give.
  const cells: readonly (StageLaunch | undefined)[] =
    stageLaunch ??
    (stagesIn.length === 1 && launchMassKg !== undefined ? [{ massKg: launchMassKg, cgM: launchCgM ?? 0 }] : []);

  const slots = stageEngineSlots(stagesIn, motors, engineExport ?? CDX1_ENGINE_EXPORT);
  const w = createCdx1Writer();
  const { emit } = w;

  emit('<RASAeroDocument>');
  emit('<FileVersion>2</FileVersion>');
  emit('<RocketDesign>');
  writeSustainerChain(w, stagesIn[0]!, stagesIn.length);
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
  writeSimulationList(w, stagesIn, slots, cells, warnings);
  emit('</RASAeroDocument>');
  return w.lines.join('\n');
}

/** Export a design as a .CDX1 file the user downloads. */
export function downloadCdx1(input: Cdx1ExportInput): void {
  const xml = exportCdx1(input);
  const blob = new Blob([xml], { type: 'application/xml' });
  void saveBlob(blob, exportFilename([input.name, 'design'], 'CDX1'));
}
