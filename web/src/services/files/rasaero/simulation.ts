import type { ComponentNode } from '../../../engine/openRocketEngine';
import type { Keyed } from '../../../i18n/keyedError';
import { escapeXml as esc } from '../xmlUtil';
import { FT, IN, LB, fmt, type Cdx1Writer } from './units';
import type { StageEngineSlot } from './engines';
import type { StageLaunch } from './stageLaunch';
import { num, str } from '../../../tree/nodeProps';

/** Design-level `[mach, altitude m]` conditions table (RASAero's Mach-Alt table). */
export type MachAltTable = [number, number][];

/** Mach-Alt conditions table. No table ⇒ the empty element (RASAero's "unset"). */
export function writeMachAlt(w: Cdx1Writer, machAlt: MachAltTable | undefined): void {
  const { emit } = w;
  if (machAlt && machAlt.length > 0) {
    emit('<MachAlt>');
    for (const [mach, altM] of machAlt) emit(`<Item>${fmt(mach)}, ${fmt(altM * FT)}</Item>`);
    emit('</MachAlt>');
  } else {
    emit('<MachAlt></MachAlt>');
  }
}

/** The warning raised when the simulation block's weight and CG cells are written as 0. */
export const RASAERO_STAGE_MASS_WARNING: Keyed = { key: 'errors.exportRasaeroStageMass' };

/**
 * Simulation block: RASAero's loader dereferences every child without null
 * checks, so its own files always carry all of these. The *Engine elements are
 * the only optional ones and must be omitted (not written empty) when there is
 * no motor.
 *
 * The per-stage weight/CG cells are cumulative, each the stack from the
 * sustainer through that stage with its motors, as desktop's `SimulationDTO`
 * fills every one of them from `MassCalculator`. `stageLaunch` holds them by
 * stage index (`cumulativeStageLaunch`); RASAero flies a stage at the weight
 * its cell says, so a stage with no figure is written as 0 and the warning
 * says so, the way desktop warns when it has no stage mass to write.
 */
export function writeSimulationList(
  w: Cdx1Writer,
  stagesIn: ComponentNode[],
  slots: StageEngineSlot[],
  stageLaunch: readonly (StageLaunch | undefined)[],
  warnings: Keyed[] | undefined,
): void {
  const { emit } = w;
  const stageEngines = slots.map((s) => s.engine);
  const stageIgnitionDelays = slots.map((s) => s.ignitionDelay);
  if (stagesIn.some((_, i) => stageLaunch[i] === undefined)) warnings?.push(RASAERO_STAGE_MASS_WARNING);
  const stackWt = (i: number): string => fmt((stageLaunch[i]?.massKg ?? 0) * LB);
  const stackCg = (i: number): string => fmt((stageLaunch[i]?.cgM ?? 0) * IN);
  const stageSeparationDelay = (i: number): string => {
    const st = stagesIn[i];
    return fmt(st && str(st, 'separationEvent', 'ejection') === 'burnout' ? num(st, 'separationDelay', 0) : 0);
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
  // `Booster2Delay`, not `Booster2SeparationDelay`: RASAero names the two
  // boosters' separation delays differently, and desktop's
  // RASAeroCommonConstants.BOOSTER2_SEPARATION_DELAY is this same tag.
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
}
