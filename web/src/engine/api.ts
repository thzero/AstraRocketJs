/**
 * Thin app-facing helpers over the OpenRocket engine wrapper (openRocketEngine.ts).
 * Keeps the UI free of engine handle bookkeeping.
 */
import { OpenRocketDesign, resetEngine, type MotorSpec, type RocketTree } from './openRocketEngine';

export type { StaticInfo, FlightResult } from './openRocketEngine';

/**
 * The Estes C6 (SI units) as the bundled catalog states it: the certified RASP
 * curve with a t = 0 point ahead of it, and the catalog's 23.1 g loaded and
 * 10.8 g propellant weights.
 *
 * Seated into any mount that has no motor (`flightConfigs.reconcileConfig`), so
 * it is what the default design flies until somebody picks something. The
 * masses fall from loaded to burnout in proportion to cumulative impulse, as
 * `thrustcurve.samplesToMotorSpec` builds them for a catalog row, so this motor
 * flies the same as the Estes C6 picked from the catalog.
 *
 * The 5 s delay is the one the picker itself would choose: Estes sells the C6 in
 * 0, 3, 5 and 7, and `MotorDialog.choose` takes the middle of a motor's own
 * charges rather than a fixed number, so the motor the app seats for you matches
 * what the picker would have chosen.
 */
export const C6: MotorSpec = {
  designation: 'C6',
  manufacturer: 'Estes',
  diameter: 0.018,
  length: 0.07,
  times: [
    0, 0.031, 0.092, 0.139, 0.192, 0.209, 0.231, 0.248, 0.292, 0.37, 0.475, 0.671, 0.702, 0.723, 0.85, 1.063, 1.211,
    1.242, 1.303, 1.468, 1.656, 1.821, 1.834, 1.847, 1.86,
  ],
  thrusts: [
    0, 0.946, 4.826, 9.936, 14.09, 11.446, 7.381, 6.151, 5.489, 4.921, 4.448, 4.258, 4.542, 4.164, 4.448, 4.353, 4.353,
    4.069, 4.258, 4.353, 4.448, 4.448, 2.933, 1.325, 0,
  ],
  masses: [
    0.0231, 0.023082, 0.0228664, 0.0224415, 0.0216616, 0.0213958, 0.0211421, 0.0210012, 0.0206875, 0.0201903, 0.0195878,
    0.0185427, 0.0183757, 0.0182637, 0.0175938, 0.0164458, 0.0156566, 0.0154967, 0.0151857, 0.0143155, 0.0133022,
    0.0124032, 0.0123445, 0.0123105, 0.0123,
  ],
  cgX: 0.035,
  ejectionDelay: 5.0,
};

/**
 * Build a rocket from an editable component tree, with no motors in it.
 *
 * Motors are seated by `services/design/buildRocket.buildConfiguredRocket`, from the
 * flight configuration being flown: one place decides which motor goes in which
 * mount, so the drawing, the static readouts and the flight cannot disagree.
 *
 * resetEngine() frees the previous design's handles, so always rebuild before
 * reading static info / simulating.
 */
export function buildRocketTree(tree: RocketTree): OpenRocketDesign {
  resetEngine();
  return OpenRocketDesign.buildTree(tree);
}
