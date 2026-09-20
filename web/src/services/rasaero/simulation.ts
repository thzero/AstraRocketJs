import type { ComponentNode } from '../../engine/openRocketEngine';
import { escapeXml as esc } from '../xmlUtil';
import { FT, IN, LB, fmt, nnum, type Cdx1Writer } from './units';
import type { StageEngineSlot } from './engines';

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

/**
 * Simulation block: RASAero's loader dereferences EVERY child without null
 * checks, so its own files always carry all of these. The *Engine elements are
 * the only optional ones and must be OMITTED (not written empty) when there is
 * no motor. The per-stage weight/CG cells are CUMULATIVE — we know only the
 * whole rocket's loaded mass/CG, so only the LAST stage's cell can be filled.
 */
export function writeSimulationList(
  w: Cdx1Writer,
  stagesIn: ComponentNode[],
  slots: StageEngineSlot[],
  launchMassKg: number | undefined,
  launchCgM: number | undefined,
): void {
  const { emit } = w;
  const stageEngines = slots.map((s) => s.engine);
  const stageIgnitionDelays = slots.map((s) => s.ignitionDelay);
  const lastStage = stagesIn.length - 1;
  const stackWt = (i: number): string => fmt((i === lastStage ? (launchMassKg ?? 0) : 0) * LB);
  const stackCg = (i: number): string => fmt((i === lastStage ? (launchCgM ?? 0) : 0) * IN);
  const stageSeparationDelay = (i: number): string => {
    const st = stagesIn[i];
    return fmt(st && String(st['separationEvent'] ?? 'ejection') === 'burnout' ? nnum(st, 'separationDelay', 0) : 0);
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
}
