import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  __setEngineForTests,
  OpenRocketDesign,
  type MotorSpec,
  type RocketTree,
  type SimulationOptions,
} from '../../src/engine/openRocketEngine';
import { simConditions } from '../../src/services/flight/simulations';
import { airDensity } from '../../src/services/flight/recoverySizing';
import type { AtmosphereLevel } from '../../src/services/design/orkTree';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

beforeAll(async () => {
  __setEngineForTests(await import('../../src/engine/vendor/openrocket-engine.mjs'));
});

/**
 * A forecast atmosphere reaches the kernel (bridge AtmosphereProfile) and moves
 * the flight the way air density says it should. The parity golden holds the
 * exact numbers on JVM, JS and WASM; this holds the direction of each effect.
 */

const TREE = {
  components: [
    {
      id: 'stage1',
      type: 'stage',
      children: [
        { id: 'nose', type: 'nosecone', length: 0.1, aftRadius: 0.012, thickness: 0.002, shape: 'ogive' },
        {
          id: 'tube',
          type: 'bodytube',
          length: 0.45,
          outerRadius: 0.012,
          thickness: 0.0005,
          motorMount: true,
          children: [
            {
              id: 'fins',
              type: 'trapezoidfinset',
              finCount: 3,
              rootChord: 0.05,
              tipChord: 0.03,
              sweep: 0.02,
              height: 0.025,
              thickness: 0.003,
            },
          ],
        },
      ],
    },
  ],
} as unknown as RocketTree;

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

const apogee = (options: SimulationOptions): number => {
  const d = OpenRocketDesign.buildTree(TREE);
  d.setMotorById('tube', C6);
  return d.simulate({ launchRodLength: 1, randomSeed: 7, ...options }).summary.maxAltitude;
};

/** A column in degrees C and hPa, as the app stores it. */
const column = (tC: number, pHPa: number): AtmosphereLevel[] => [
  { altitudeM: 0, temperatureC: tC, pressureHPa: pHPa, relativeHumidity: 0 },
  { altitudeM: 500, temperatureC: tC - 3, pressureHPa: pHPa * 0.94, relativeHumidity: 0 },
  { altitudeM: 3000, temperatureC: tC - 19, pressureHPa: pHPa * 0.69, relativeHumidity: 0 },
];

const levelsOf = (levels: AtmosphereLevel[]) =>
  levels.map((l) => ({
    altitude: l.altitudeM,
    temperature: l.temperatureC + 273.15,
    pressure: l.pressureHPa * 100,
    relativeHumidity: l.relativeHumidity,
  }));

describe('a forecast atmosphere', () => {
  it('flies higher in thin hot air and lower in thick cold air than in the standard one', () => {
    const standard = apogee({});
    expect(apogee({ atmosphereLevels: levelsOf(column(35, 950)) })).toBeGreaterThan(standard);
    expect(apogee({ atmosphereLevels: levelsOf(column(-10, 1040)) })).toBeLessThan(standard);
  });

  it('is anchored by the site values, which win near the ground', () => {
    // The same pressure at the pad, 45 degrees warmer: thinner air, a higher flight.
    const cold = levelsOf(column(-10, 1040));
    const hotSite = apogee({ atmosphereLevels: cold, temperature: 308.15, pressure: 104_000 });
    expect(hotSite).toBeGreaterThan(apogee({ atmosphereLevels: cold }));
  });

  it('drops a level whose pressure is not below the pad, as it drops one below the pad', () => {
    // 950 hPa at the pad under 977.6 hPa at 500 m: that level is ground the pad
    // stands on, not air above it. The flight goes ahead on the levels above.
    const levels = levelsOf(column(-10, 1040));
    const withLow = apogee({ atmosphereLevels: levels, temperature: 308.15, pressure: 95_000 });
    const without = apogee({ atmosphereLevels: [levels[2]!], temperature: 308.15, pressure: 95_000 });
    expect(withLow).toBeCloseTo(without, 9);
  });

  /**
   * The parachute sizing estimate reads the air at the pad from the same
   * levels the flight flies, so its density matches the engine's at liftoff:
   * between two levels, below the lowest one, and with no forecast at all (the
   * standard atmosphere, which the kernel tabulates every 500 m).
   */
  it('gives the air density the sizing estimate uses at the pad', () => {
    const rhoAtLiftoff = (launchAltitudeM: number, levels?: AtmosphereLevel[]): number => {
      const d = OpenRocketDesign.buildTree(TREE);
      d.setMotorById('tube', C6);
      const r = d.simulate({
        launchRodLength: 1,
        randomSeed: 7,
        launchAltitude: launchAltitudeM,
        atmosphereLevels: levels ? levelsOf(levels) : undefined,
        series: 'full',
      });
      return r.series['ρ']![0]!;
    };
    const between = column(20, 950);
    expect(rhoAtLiftoff(1500, between)).toBeCloseTo(
      airDensity({ launchAltitudeM: 1500, atmosphereLevels: between }),
      6,
    );
    const above = column(20, 950).map((l) => ({ ...l, altitudeM: l.altitudeM + 1000 }));
    expect(rhoAtLiftoff(500, above)).toBeCloseTo(airDensity({ launchAltitudeM: 500, atmosphereLevels: above }), 6);
    expect(rhoAtLiftoff(2682)).toBeCloseTo(airDensity({ launchAltitudeM: 2682 }), 6);
  });

  /**
   * The site values away from sea level, where a blank is filled with the
   * sea-level standard constant rather than the ISA value for the altitude,
   * and where site temperature and pressure together anchor a forecast.
   *
   * The custom model is read through the kernel's 500 m table, so between grid
   * points the pad value sits about 0.03 % off the anchor the estimate uses.
   * Three places still separate the branches: filling a blank from the site
   * altitude instead moves the density by tens of percent.
   */
  it('gives the air density the sizing estimate uses with site values set', () => {
    const rhoAtLiftoff = (launchAltitudeM: number, site: SimulationOptions, levels?: AtmosphereLevel[]): number => {
      const d = OpenRocketDesign.buildTree(TREE);
      d.setMotorById('tube', C6);
      const r = d.simulate({
        launchRodLength: 1,
        randomSeed: 7,
        launchAltitude: launchAltitudeM,
        atmosphereLevels: levels ? levelsOf(levels) : undefined,
        series: 'full',
        ...site,
      });
      return r.series['ρ']![0]!;
    };
    expect(rhoAtLiftoff(2682, { temperature: 303.15 })).toBeCloseTo(
      airDensity({ launchAltitudeM: 2682, temperatureC: 30 }),
      3,
    );
    expect(rhoAtLiftoff(2682, { pressure: 74_000 })).toBeCloseTo(
      airDensity({ launchAltitudeM: 2682, pressureHPa: 740 }),
      3,
    );
    // Dry air, so the kernel's humidity term leaves the gas constant alone and
    // only the branch changes.
    expect(rhoAtLiftoff(2682, { relativeHumidity: 0 })).toBeCloseTo(
      airDensity({ launchAltitudeM: 2682, relativeHumidity: 0 }),
      3,
    );
    const levels = column(20, 950).map((l) => ({ ...l, altitudeM: l.altitudeM + 2000 }));
    expect(rhoAtLiftoff(2682, { temperature: 288.15, pressure: 72_000 }, levels)).toBeCloseTo(
      airDensity({ launchAltitudeM: 2682, temperatureC: 15, pressureHPa: 720, atmosphereLevels: levels }),
      6,
    );
  });

  it('reaches the engine from launch conditions through simConditions', () => {
    const launch = {
      launchRodLengthM: 1,
      launchRodAngleDeg: 0,
      windAverage: 0,
      windStdDev: 0,
      launchAltitudeM: 0,
      latitudeDeg: 40,
      longitudeDeg: -105,
      temperatureC: null,
      pressureHPa: null,
      atmosphereLevels: column(35, 950),
    };
    const opts = simConditions(launch as never, { randomSeed: 7 } as never);
    expect(opts.atmosphereLevels).toEqual(levelsOf(column(35, 950)));
    // Against the same conditions without the profile: thin hot air, a higher flight.
    const withProfile = apogee(opts as SimulationOptions);
    expect(withProfile).toBeGreaterThan(apogee({ ...(opts as SimulationOptions), atmosphereLevels: undefined }));
  });

  it('refuses a level whose pressure does not fall with height, naming it', () => {
    const bad = levelsOf(column(15, 1013));
    bad[2]!.pressure = bad[1]!.pressure + 100;
    expect(() => apogee({ atmosphereLevels: bad })).toThrow(/atmosphere level 3 of 3/);
  });
});
