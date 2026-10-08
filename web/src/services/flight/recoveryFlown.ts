import type { FlightResult } from '../../engine/openRocketEngine';
import { seriesAt } from './flightEvents';
import { flightBranches } from './flightColumns';

/**
 * What a run reported about one recovery device, as opposed to what
 * `recoverySizing` estimates from the design.
 *
 * Nothing here computes: every number is read out of the kernel's own series at
 * the time of the kernel's own event. The estimate exists so a design can be
 * sized before it has ever flown, and it is replaced by these figures the moment
 * a run has them - which also settles the multi-stage case the estimate cannot,
 * since a booster that separates descends on its own branch with its own mass.
 */

/** The one deployment event type the kernel raises for a recovery device. */
const DEPLOYMENT = 'RECOVERY_DEVICE_DEPLOYMENT';

/** Events that end a device's descent phase: the next chute out, or the ground. */
const PHASE_END = new Set([DEPLOYMENT, 'GROUND_HIT']);

export interface DeviceDescent {
  /**
   * The stage branch it deployed on, as the kernel names it ("Sustainer",
   * "Booster"). Empty for a single-branch flight, which has no other branch to
   * distinguish it from.
   */
  branch: string;
  /** When it opened (s), the kernel's own event time. */
  time: number;
  /**
   * The mass under it (kg), read from the branch's mass series at that moment.
   *
   * This is the figure the estimate approximates by subtracting propellant from
   * the loaded mass, and it is right where the estimate cannot be: the series
   * belongs to the branch, so a separated booster reports its own mass rather
   * than the whole stack's.
   */
  mass: number;
  /**
   * The settled descent speed under it (m/s), or null when the run did not
   * record one.
   *
   * Read at the end of the device's own phase (the next deployment, or the
   * ground), because that is where the descent under this device has settled.
   * Read immediately after it opened would report the speed it was still
   * slowing from.
   */
  rate: number | null;
}

/**
 * What the run reported for the recovery device named `deviceName`, or null when
 * no branch of it deployed that device.
 *
 * Matched on the event's `source`, which is the component's own name from the
 * design tree. Two devices sharing a name is a design the app allows, and the
 * first branch to deploy one wins: there is nothing else in the event to tell
 * them apart, and reporting one of them beats reporting neither.
 */
export function deviceDescent(result: FlightResult | null | undefined, deviceName: string): DeviceDescent | null {
  if (!result || !deviceName) return null;
  for (const branch of flightBranches(result)) {
    const events = branch.events ?? [];
    const i = events.findIndex((e) => e.type === DEPLOYMENT && e.source === deviceName);
    if (i < 0) continue;
    const opened = events[i]!;
    const mass = seriesAt(branch.series, 'mass', opened.time);
    if (mass == null || !(mass > 0)) return null;
    // The phase ends at the next chute or the ground; failing both, at the last
    // sample the run recorded.
    const next = events.slice(i + 1).find((e) => PHASE_END.has(e.type));
    const times = branch.series.time ?? [];
    const endsAt = next?.time ?? times[times.length - 1];
    const rate = endsAt == null ? null : seriesAt(branch.series, 'velocity', endsAt);
    return {
      branch: branch.name,
      time: opened.time,
      mass,
      // Descending, so the series is negative on the way down; the readout wants
      // a speed.
      rate: rate == null ? null : Math.abs(rate),
    };
  }
  return null;
}

/**
 * The mass the first recovery device on the sustainer came down under, for the
 * whole-rocket stats tile.
 *
 * The sustainer because the tile is one number for the design on screen, and the
 * sustainer is what "the rocket" means once the boosters are gone. A branch's own
 * figure belongs to that branch's own readout.
 */
export function sustainerDescentMass(result: FlightResult | null | undefined): number | null {
  if (!result) return null;
  const branch = flightBranches(result)[0];
  if (!branch) return null;
  const opened = (branch.events ?? []).find((e) => e.type === DEPLOYMENT);
  if (!opened) return null;
  const mass = seriesAt(branch.series, 'mass', opened.time);
  return mass != null && mass > 0 ? mass : null;
}
