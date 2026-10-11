import type { FlightSummary } from '../../../engine/openRocketEngine';
import type { LaunchConditions } from '../../design/orkTree';
import { xmlText as text } from '../xmlUtil';
import { readSimulationLaunch } from './importLaunch';
import { KNOWN_CONDITIONS_TAGS, KNOWN_SIMULATION_TAGS, readPassthrough, wrapConditionsChild } from './passthrough';
import { KeyedError } from '../../../i18n/keyedError';
import { MAX_SIMULATIONS } from './importLimits';
import { finiteNum } from './numbers';

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
  /**
   * Children this app does not model (desktop extensions and the like), as raw
   * XML, and the unread children of its `<conditions>`, each wrapped by
   * `wrapConditionsChild`; see passthrough.ts.
   */
  xmlExtra?: string[];
}

/**
 * Every simulation in the file, in file order.
 *
 * The desktop writes a <flightdata> summary for every simulation that has a
 * result, as attributes on the element, and loads any file that has one as
 * loaded rather than not simulated, unless its status says outdated
 * (SingleSimulationHandler). The summary alone is what is read here: the
 * per-sample <databranch> data, when the desktop wrote it, is not, because the
 * app re-flies a simulation for its charts.
 */
export function readSimulations(doc: Document): OrkSimulation[] {
  const els = doc.querySelectorAll('openrocket > simulations > simulation');
  // Counted before any is read: reading one costs DOM passes, and the count is
  // what a crafted file inflates.
  if (els.length > MAX_SIMULATIONS) throw new KeyedError('errors.file.tooManySimulations');
  return [...els].map((el, i) => {
    const flight = el.querySelector(':scope > flightdata');
    const launch = readSimulationLaunch(el);
    // The simulation's own unread children, then the unread children of its
    // conditions (see `wrapConditionsChild`).
    const condEl = el.querySelector(':scope > conditions');
    const carried = [
      ...(readPassthrough(el, KNOWN_SIMULATION_TAGS) ?? []),
      ...((condEl && readPassthrough(condEl, KNOWN_CONDITIONS_TAGS)) ?? []).map(wrapConditionsChild),
    ];
    const xmlExtra = carried.length ? carried : undefined;
    return {
      name: (text(el, ':scope > name') ?? '').trim() || `Simulation ${i + 1}`,
      configId: (text(el, ':scope > conditions > configid') ?? '').trim() || null,
      ...(launch ? { launch } : {}),
      ...(flight ? { summary: summaryOf(flight) } : {}),
      outdated: (el.getAttribute('status') ?? '').trim().toLowerCase() === 'outdated',
      ...(xmlExtra ? { xmlExtra } : {}),
    };
  });
}

/** The <flightdata> attributes as a summary; a figure the file left out reads as missing. */
function summaryOf(el: Element): FlightSummary {
  const num = (name: string): number => finiteNum(el.getAttribute(name)) ?? NaN;
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
