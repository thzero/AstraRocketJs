import type { ComponentNode, FlightEvent, FlightResult } from '../../engine/openRocketEngine';
import { kernelComponentName } from '../app/warningText';
import { walkNodes } from '../../tree/treeWalk';
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

/** The kernel's landing event. */
const GROUND_HIT = 'GROUND_HIT';

/**
 * Devices that open this close together (s) open as one: two chutes on one
 * event, or a main set a breath behind the drogue, come out within it. A
 * deployment at apogee is queued 1 ms after the apogee event, and a delay of a
 * tenth of a second is the finest a design is usually given, so neither is a
 * step of its own that a descent could settle in.
 */
const TOGETHER_S = 0.2;

/**
 * The deployments a branch's descent is measured from: those before it landed.
 * A charge that fires on the ground still raises its event (the kernel adds the
 * EventAfterLanding warning for it), but nothing descends under it.
 */
function airborneDeployments(events: readonly FlightEvent[]) {
  const landed = events.find((e) => e.type === GROUND_HIT)?.time ?? Infinity;
  return events.filter((e) => e.type === DEPLOYMENT && e.time < landed);
}

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
   * Read at the end of the device's own phase (the next deployment that is not
   * part of its own opening, or the ground), because that is where the descent
   * under this device has settled. Read immediately after it opened would report
   * the speed it was still slowing from. It is the vertical speed when the run
   * recorded it, so a wind does not count as descent, and the total speed
   * otherwise.
   */
  rate: number | null;
}

/** The component types the kernel deploys as recovery devices. */
const RECOVERY_DEVICES = new Set(['parachute', 'streamer']);

/**
 * The names the kernel flies more than one of the design's recovery devices
 * under. A result without node ids names its devices only this way, so a name
 * in this set could be any of them. Unnamed devices of one type all fly under
 * the kernel's default name (`kernelComponentName`).
 */
export function sharedDeviceNames(nodes: readonly ComponentNode[]): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const n of walkNodes(nodes)) {
    if (!RECOVERY_DEVICES.has(n.type)) continue;
    const name = kernelComponentName(n);
    if (seen.has(name)) shared.add(name);
    seen.add(name);
  }
  return shared;
}

/**
 * The recovery device a readout asks about: its app node id, the name the kernel
 * flies it under (the user's, or the kernel's default for an unnamed part,
 * `kernelComponentName`), and whether another recovery device in the design
 * flies under that same name.
 */
export interface RecoveryDeviceRef {
  id?: string;
  name: string;
  nameShared: boolean;
}

/**
 * What the run reported for `device`, or null when no branch of it deployed that
 * device.
 *
 * Matched on the event's `sourceId`, the app node id the bridge puts on each
 * event raised by a part the design gave an id. A name cannot do that job: every
 * unnamed parachute flies under the same kernel default, so a drogue and a main
 * the user never named are indistinguishable by name. A result with no ids on
 * its deployments (one read from a file) is matched on the event's `source`
 * name instead, and only when no other recovery device in the design shares the
 * name; a shared name could be either device, so it answers nothing and the
 * estimate stands.
 */
export function deviceDescent(
  result: FlightResult | null | undefined,
  device: RecoveryDeviceRef,
): DeviceDescent | null {
  if (!result) return null;
  const branches = flightBranches(result);
  const byId = branches.some((b) => (b.events ?? []).some((e) => e.type === DEPLOYMENT && e.sourceId != null));
  if (byId ? !device.id : !device.name || device.nameShared) return null;
  const isDevice = (e: { sourceId?: string; source?: string }) =>
    byId ? e.sourceId === device.id : e.source === device.name;
  for (const branch of branches) {
    const events = branch.events ?? [];
    const deployments = airborneDeployments(events);
    const opened = deployments.find(isDevice);
    if (!opened) continue;
    const mass = seriesAt(branch.series, 'mass', opened.time);
    if (mass == null || !(mass > 0)) return null;
    // The devices that opened with this one open as one step: its phase starts
    // at the step's first opening and ends at the next deployment past it, or
    // the ground; failing both, at the last sample the run recorded.
    const stepStart = deployments.find((e) => opened.time - e.time < TOGETHER_S && e.time <= opened.time)!.time;
    const next = events.find(
      (e) =>
        (e.type === GROUND_HIT && e.time > opened.time) || (e.type === DEPLOYMENT && e.time >= stepStart + TOGETHER_S),
    );
    const times = branch.series.time ?? [];
    const endsAt = next?.time ?? times[times.length - 1];
    const vertical = Array.isArray(branch.series['Vz']) ? 'Vz' : 'velocity';
    const rate = endsAt == null ? null : seriesAt(branch.series, vertical, endsAt);
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
  const opened = airborneDeployments(branch.events ?? [])[0];
  if (!opened) return null;
  const mass = seriesAt(branch.series, 'mass', opened.time);
  return mass != null && mass > 0 ? mass : null;
}
