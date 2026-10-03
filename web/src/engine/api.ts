/**
 * Thin app-facing helpers over the OpenRocket engine wrapper (openRocketEngine.ts).
 * Keeps the UI free of engine handle bookkeeping.
 */
import { OpenRocketDesign, resetEngine, type MotorSpec, type RocketTree } from './openRocketEngine';

export type { StaticInfo, FlightResult } from './openRocketEngine';

/**
 * A stock Estes C6 (SI units): times→thrust, per-sample motor mass.
 *
 * Seated into any mount that has no motor (`flightConfigs.reconcileConfig`), so
 * it is what the default design flies until somebody picks something.
 *
 * The 5 s delay is the one the picker itself would choose: Estes sells the C6 in
 * 0, 3, 5 and 7, and `MotorDialog.choose` takes the middle of a motor's own
 * charges rather than a fixed number. A 3 here made the one motor the app seats
 * for you the one motor it would not have picked.
 */
export const C6: MotorSpec = {
  designation: 'C6',
  manufacturer: 'Estes',
  diameter: 0.018,
  length: 0.07,
  times: [0, 0.2, 0.4, 2.0, 2.1],
  thrusts: [0, 12, 5, 5, 0],
  masses: [0.0227, 0.0165, 0.0165, 0.013, 0.012],
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
