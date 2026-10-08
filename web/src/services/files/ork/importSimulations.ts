import type { FlightSummary } from '../../../engine/openRocketEngine';
import type { LaunchConditions } from '../../design/orkTree';
import { xmlText as text } from '../xmlUtil';
import { readSimulationLaunch } from './importLaunch';

/**
 * One <simulation> as a file carries it: its name, the configuration it flies,
 * its launch conditions and, when it was run, the summary of its result.
 */
export interface OrkSimulation {
  name: string;
  /** The `configid` it names; matched to a configuration by the caller. */
  configId: string | null;
  launch?: Partial<LaunchConditions>;
  /** The <flightdata> summary, when the file has one. */
  summary?: FlightSummary;
  /** The file says the result was out of date when it was saved. */
  outdated: boolean;
}

/**
 * Every simulation in the file, in file order.
 *
 * The desktop writes a <flightdata> summary for every simulation that has a
 * result, as attributes on the element, and loads any file that has one as
 * LOADED rather than not simulated, unless its status says outdated
 * (SingleSimulationHandler). The summary alone is what is read here: the
 * per-sample <databranch> data, when the desktop wrote it, is not, because the
 * app re-flies a simulation for its charts.
 */
export function readSimulations(doc: Document): OrkSimulation[] {
  return [...doc.querySelectorAll('openrocket > simulations > simulation')].map((el, i) => {
    const flight = el.querySelector(':scope > flightdata');
    const launch = readSimulationLaunch(el);
    return {
      name: (text(el, ':scope > name') ?? '').trim() || `Simulation ${i + 1}`,
      configId: (text(el, ':scope > conditions > configid') ?? '').trim() || null,
      ...(launch ? { launch } : {}),
      ...(flight ? { summary: summaryOf(flight) } : {}),
      outdated: (el.getAttribute('status') ?? '').trim().toLowerCase() === 'outdated',
    };
  });
}

/** The <flightdata> attributes as a summary; a figure the file left out reads as missing. */
function summaryOf(el: Element): FlightSummary {
  const num = (name: string): number => {
    const raw = el.getAttribute(name);
    const v = raw == null ? NaN : Number(raw);
    return Number.isFinite(v) ? v : NaN;
  };
  const orNull = (name: string): number | null => {
    const v = num(name);
    return Number.isNaN(v) ? null : v;
  };
  return {
    maxAltitude: num('maxaltitude'),
    maxVelocity: num('maxvelocity'),
    maxAcceleration: num('maxacceleration'),
    maxMachNumber: num('maxmach'),
    timeToApogee: num('timetoapogee'),
    flightTime: num('flighttime'),
    groundHitVelocity: num('groundhitvelocity'),
    launchRodVelocity: num('launchrodvelocity'),
    deploymentVelocity: orNull('deploymentvelocity'),
    optimumDelay: orNull('optimumdelay'),
  };
}
