import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  __setEngineForTests,
  OpenRocketDesign,
  type ComponentNode,
  type MotorSpec,
  type RocketTree,
} from '../../src/engine/openRocketEngine';

/**
 * The two launch-guide clearance models, flown through the REAL kernel.
 *
 * `guideAwareRodClearance` is off by default, and off means the bridge attaches
 * nothing at all, so the first case here is also the standing proof that the
 * default flight is upstream's: a design whose guide sits well above its aft end
 * reports the same departure as one with no guide whatever, because upstream
 * compares travel with the FULL rod length and never reads the lug-aware length
 * it computes.
 *
 * On, the guided phase ends when the aft-most guide leaves the rod. Lugs and
 * rail buttons are one rule with two geometries, which is what the pair of
 * symmetry cases at the end is for: a lug's guiding point runs to its aft END
 * and a button's to its aft EDGE (its origin is its axial center and it has no
 * length at all), so measuring a button like a lug would silently lose its
 * radius. That asymmetry is invisible in the numbers unless something compares
 * the two, so something does.
 *
 * Flies the real kernel, so it takes seconds rather than milliseconds - see
 * engineBoundary.test.ts for why the timeout is scoped to the file.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type Engine = typeof import('../../src/engine/vendor/openrocket-engine.mjs');
let engine: Engine;

beforeAll(async () => {
  engine = await import('../../src/engine/vendor/openrocket-engine.mjs');
  __setEngineForTests(engine);
});

/** Meters of airframe behind the guide, so the two models cannot agree. */
const TUBE_LENGTH = 0.6;

/**
 * A rocket with one guide mounted at the very FRONT of its body tube, so its aft
 * edge is most of a tube length above the rocket's aft end. A guide that reaches
 * the aft end would make both models agree, which would prove nothing.
 *
 * The guide's own mass and drag are overridden to nothing, so the only thing
 * that can move between the two runs is where the guided phase ends.
 */
const design = (guide: ComponentNode | null): RocketTree =>
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
              ...(guide ? [guide] : []),
            ],
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

/** At the tube's front, weightless and drag-free: only its POSITION is the test. */
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

/** A button is measured across its OUTER DIAMETER, not along a length. */
const button = (outerDiameter: number): ComponentNode =>
  ({
    id: 'button',
    type: 'railbutton',
    outerDiameter,
    totalHeight: 0.008,
    position: { method: 'top', offset: 0 },
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

/** Rod exit and the time it happened, flown on a 2 m rod. */
function fly(tree: RocketTree, guideAware: boolean): { speed: number; time: number } {
  const d = OpenRocketDesign.buildTree(tree);
  d.setMotorById('tube', C6);
  // A fine step on purpose: the LAUNCHROD event lands at the END of whichever
  // step crossed the threshold, so at the default 0.05 s two departures 40 mm
  // apart fall in the same step and report the same time. 1 ms resolves them.
  const r = d.simulate({
    launchRodLength: 2,
    guideAwareRodClearance: guideAware,
    randomSeed: 1,
    timeStep: 0.001,
  });
  const ev = r.events.find((e) => e.type === 'LAUNCHROD');
  expect(ev, 'the flight must reach rod clearance').toBeTruthy();
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

describe('a lug and a rail button are measured by the same rule', () => {
  /**
   * The aft-most point still touching the rail. A 40 mm lug at the tube's front
   * reaches 40 mm down it; a button whose OUTER DIAMETER is 80 mm has its center
   * at the front and its aft edge 40 mm down. Same guide point, so the same
   * departure, and the only way to get that is to measure each by its own
   * geometry.
   */
  it('agrees when their aft-most points coincide', () => {
    const byLug = fly(design(lug(0.04)), true);
    const byButton = fly(design(button(0.08)), true);
    expect(byButton.time).toBeCloseTo(byLug.time, 9);
    expect(byButton.speed).toBeCloseTo(byLug.speed, 9);
  });

  /**
   * And the button is NOT measured by its origin: were its radius dropped, an
   * 80 mm button would depart with the same numbers as a zero-length lug at the
   * same place. This is the case that fails if the two branches are collapsed
   * into one.
   */
  it('does not measure a button from its center', () => {
    const atOrigin = fly(design(lug(0)), true);
    const byButton = fly(design(button(0.08)), true);
    expect(byButton.time).toBeGreaterThan(atOrigin.time);
  });
});
