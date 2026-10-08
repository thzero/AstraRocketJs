import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  __setEngineForTests,
  OpenRocketDesign,
  type ComponentNode,
  type MotorSpec,
  type RocketTree,
} from '../../src/engine/openRocketEngine';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';

/**
 * The two launch-guide clearance models, flown through the real kernel.
 *
 * `guideAwareRodClearance` is off by default, and off means the bridge attaches
 * nothing at all, so the first case here is also the standing proof that the
 * default flight is upstream's: a design whose guide sits well above its aft end
 * reports the same departure as one with no guide whatever, because upstream
 * compares travel with the full rod length and never reads the lug-aware length
 * it computes.
 *
 * On, the guided phase ends when the rocket stops being held, and a rod and a
 * rail do not hold it the same way. A lug is a tube threaded onto the rod and
 * holds the rocket's angle by itself, so it guides until its aft end leaves the
 * rod. A button is a stud in a slot and holds nothing alone: two of them in one
 * rail are what stop the rocket pivoting, so a rail guides until the
 * second-to-last button station leaves it, and a single button guides not at
 * all. The cases at the end are that difference, which is invisible in the
 * numbers unless something compares them.
 *
 * Flies the real kernel, so it takes seconds rather than milliseconds. See
 * `testing/kernelTimeout.ts` for the cap and why it is three times the measured
 * work rather than just over it.
 */
vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

type Engine = typeof import('../../src/engine/vendor/openrocket-engine.mjs');
let engine: Engine;

beforeAll(async () => {
  engine = await import('../../src/engine/vendor/openrocket-engine.mjs');
  __setEngineForTests(engine);
});

/** Meters of airframe behind the guide, so the two models cannot agree. */
const TUBE_LENGTH = 0.6;

/**
 * A rocket with one guide mounted at the very front of its body tube, so its aft
 * edge is most of a tube length above the rocket's aft end. A guide that reaches
 * the aft end would make both models agree, which would prove nothing.
 *
 * The guide's own mass and drag are overridden to nothing, so the only thing
 * that can move between the two runs is where the guided phase ends.
 */
const design = (guide: ComponentNode | ComponentNode[] | null): RocketTree =>
  ({
    components: [
      {
        id: 'stage1',
        type: 'stage',
        children: [
          { id: 'nose', type: 'nosecone', length: 0.1, aftRadius: 0.013, thickness: 0.001, shape: 'ogive' },
          {
            id: 'tube',
            type: 'bodytube',
            length: TUBE_LENGTH,
            outerRadius: 0.013,
            thickness: 0.0005,
            motorMount: true,
            children: [
              {
                id: 'fins',
                type: 'trapezoidfinset',
                finCount: 3,
                rootChord: 0.06,
                tipChord: 0.03,
                sweep: 0.03,
                height: 0.05,
                thickness: 0.003,
              },
              ...(guide ? (Array.isArray(guide) ? guide : [guide]) : []),
            ],
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

/** At the tube's front, weightless and drag-free: only its position is the test. */
const lug = (length: number): ComponentNode =>
  ({
    id: 'lug',
    type: 'launchlug',
    length,
    outerRadius: 0.005,
    thickness: 0.001,
    position: { method: 'top', offset: 0 },
    overrideMass: 0,
    overrideCD: 0,
  }) as unknown as ComponentNode;

/**
 * A button is measured across its outer diameter, not along a length, and its
 * origin is its axial center. `offset` places it down the tube and `angle`
 * turns it around the body, which is what decides whether two of them are one
 * line the rail can hold.
 */
let buttonSeq = 0;
const button = (outerDiameter: number, offset = 0, angle = 0): ComponentNode =>
  ({
    id: `button${++buttonSeq}`,
    type: 'railbutton',
    outerDiameter,
    totalHeight: 0.008,
    angleOffset: angle,
    position: { method: 'top', offset },
    overrideMass: 0,
    overrideCD: 0,
  }) as unknown as ComponentNode;

const C6 = {
  designation: 'C6',
  diameter: 0.018,
  length: 0.07,
  cgX: 0.035,
  ejectionDelay: 5,
  times: [0, 0.5, 1.0, 1.5, 1.86],
  thrusts: [0, 12, 5, 4.5, 0],
  masses: [0.0242, 0.021, 0.017, 0.013, 0.0108],
} as unknown as MotorSpec;

/** Seconds of flight simulated. The latest departure here, a full 2 m rod, is at 0.33 s. */
const MAX_TIME = 0.5;

/** Rod exit and the time it happened, flown on a 2 m rod. */
function fly(tree: RocketTree, guideAware: boolean): { speed: number; time: number } {
  const d = OpenRocketDesign.buildTree(tree);
  d.setMotorById('tube', C6);
  // A fine step on purpose: the LAUNCHROD event lands at the end of whichever
  // step crossed the threshold, so at the default 0.05 s two departures 40 mm
  // apart fall in the same step and report the same time. 1 ms resolves them.
  //
  // Only the departure is read, so the flight stops at MAX_TIME rather than
  // flying to the ground: at a 1 ms step the rest of the trajectory is nearly
  // all of the cost, and this file is the longest in the suite.
  const r = d.simulate({
    launchRodLength: 2,
    guideAwareRodClearance: guideAware,
    randomSeed: 1,
    timeStep: 0.001,
    maxTime: MAX_TIME,
  });
  const ev = r.events.find((e) => e.type === 'LAUNCHROD');
  expect(ev, 'the flight must reach rod clearance').toBeTruthy();
  expect(ev!.time, 'rod clearance must come before the flight is cut off').toBeLessThan(MAX_TIME);
  return { speed: r.summary.launchRodVelocity, time: ev!.time };
}

describe('the default clearance model is upstream', () => {
  it('reports the same departure with a forward lug as with no guide at all', () => {
    const none = fly(design(null), false);
    const forward = fly(design(lug(0.04)), false);
    // Upstream compares travel with the full rod length whatever the guides do,
    // so the lug cannot move this. Anything but equality here means the default
    // path has stopped being upstream's.
    expect(forward.time).toBeCloseTo(none.time, 9);
    expect(forward.speed).toBeCloseTo(none.speed, 9);
  });

  it('reports the same departure with a rail button as with no guide at all', () => {
    const none = fly(design(null), false);
    const rail = fly(design(button(0.01)), false);
    expect(rail.time).toBeCloseTo(none.time, 9);
    expect(rail.speed).toBeCloseTo(none.speed, 9);
  });
});

describe('the guide-aware clearance model', () => {
  it('ends the guided phase sooner for a lug above the aft end', () => {
    const upstream = fly(design(lug(0.04)), false);
    const aware = fly(design(lug(0.04)), true);
    expect(aware.time).toBeLessThan(upstream.time);
    // Sooner off the rod means slower off the rod, which is the whole point:
    // upstream credits the rocket with travel it has not made.
    expect(aware.speed).toBeLessThan(upstream.speed);
    expect(aware.speed).toBeGreaterThan(0);
  });

  it('leaves a design with no guide alone, which is a tower', () => {
    const upstream = fly(design(null), false);
    const aware = fly(design(null), true);
    expect(aware.time).toBeCloseTo(upstream.time, 9);
    expect(aware.speed).toBeCloseTo(upstream.speed, 9);
  });

  it('ends the guided phase sooner for a rail button too', () => {
    const upstream = fly(design(button(0.01)), false);
    const aware = fly(design(button(0.01)), true);
    expect(aware.time).toBeLessThan(upstream.time);
    expect(aware.speed).toBeLessThan(upstream.speed);
  });
});

/**
 * A rail needs two points of contact.
 *
 * A lug is a tube on the rod and holds the rocket's angle on its own. A button
 * is a stud in a slot: with only one of them engaged the rocket is free to
 * pivot about it, so it is no longer guided however much rail is left. The
 * guided phase on a rail therefore ends when the second-to-last button station
 * leaves the rail, not the last.
 */
describe('a rail is guided by two buttons, not one', () => {
  /** A 40 mm lug at the tube's front: its aft end is 40 mm down the tube. */
  const forwardLug = () => fly(design(lug(0.04)), true);

  it('gives a single button no guided travel at all', () => {
    // One button holds nothing, so the rocket is off the rail the moment it
    // moves. Measured to its own aft edge it would report the same departure as
    // the lug above, crediting a pivoting rocket with most of a rod.
    const one = fly(design(button(0.08)), true);
    const upstream = fly(design(button(0.08)), false);
    expect(one.time).toBeLessThan(upstream.time);
    expect(one.time).toBeLessThan(forwardLug().time);
    expect(one.speed).toBeLessThan(forwardLug().speed);
  });

  /**
   * A pair at the tube's front and 200 mm down it. The aft one is the last to
   * leave; the forward one is what the departure is measured to, and its aft
   * edge is 40 mm down the tube, the same point as the 40 mm lug. So the pair
   * and the lug must agree, which is also how we know the button is measured by
   * its own geometry: its origin is its center, so dropping its radius would
   * move this.
   */
  it('is guided to the second-to-last station, not the last', () => {
    const pair = fly(design([button(0.08), button(0.08, 0.2)]), true);
    const byLug = forwardLug();
    expect(pair.time).toBeCloseTo(byLug.time, 9);
    expect(pair.speed).toBeCloseTo(byLug.speed, 9);
  });

  it('counts buttons side by side as one station, so still no guidance', () => {
    // Two buttons at the same place along the rocket are one point of contact
    // however many there are, and the rocket pivots about it just the same.
    const sideBySide = fly(design([button(0.08), button(0.08, 0.0002)]), true);
    const one = fly(design(button(0.08)), true);
    expect(sideBySide.time).toBeCloseTo(one.time, 9);
  });

  it('does not pair buttons on opposite sides of the body', () => {
    // A rail holds one line. Two buttons a half turn apart are two lines of one
    // station each, and neither can guide.
    const opposite = fly(design([button(0.08), button(0.08, 0.2, Math.PI)]), true);
    const one = fly(design(button(0.08)), true);
    expect(opposite.time).toBeCloseTo(one.time, 9);
  });
});

/**
 * A rod and a rail are never used together, so a design carrying both flies off
 * whichever holds it for the shorter distance.
 */
describe('a design with both a lug and buttons', () => {
  /** A pair far enough aft that the rail would guide longer than the lug does. */
  const aftPair = () => [button(0.08, 0.3), button(0.08, 0.5)];

  it('takes the shorter of the two', () => {
    const both = fly(design([lug(0.04), ...aftPair()]), true);
    const lugOnly = fly(design(lug(0.04)), true);
    const railOnly = fly(design(aftPair()), true);
    expect(railOnly.time).toBeGreaterThan(lugOnly.time); // the premise
    expect(both.time).toBeCloseTo(lugOnly.time, 9);
  });

  it('ignores buttons that cannot guide rather than counting them as nothing', () => {
    // A lone button is not an answer of "no guided travel" when there is a lug
    // doing the work; it is simply not the guide this rocket flies off.
    const withStray = fly(design([lug(0.04), button(0.08, 0.3)]), true);
    const lugOnly = fly(design(lug(0.04)), true);
    expect(withStray.time).toBeCloseTo(lugOnly.time, 9);
  });
});
