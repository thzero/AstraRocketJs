// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  __setEngineForTests,
  OpenRocketDesign,
  type MotorSpec,
  type SimulationOptions,
} from '../../../src/engine/openRocketEngine';
import { exportOrk, importOrk } from '../../../src/services/files/orkFile';
import { wireLoadedOrk } from '../../../src/services/files/wireLoadedOrk';
import { simConditions } from '../../../src/services/flight/simulations';
import type { CompleteLaunch } from '../../../src/services/flight/requiredLaunch';
import type { LaunchConditions } from '../../../src/services/design/orkTree';
import type { LoadedOrk } from '../../../src/services/files/loadOrk';
import { specToTree, type RocketSpec } from '../../testing/specTree';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

beforeAll(async () => {
  __setEngineForTests(await import('../../../src/engine/vendor/openrocket-engine.mjs'));
});

/**
 * Which air a file's `<atmosphere>` flies, against the kernel's own.
 *
 * Desktop's AtmosphereHandler.storeSettings flies ISA for every model but
 * `extendedisa` (an unknown or missing one warns and uses ISA), and ISA flies
 * none of the base values. So a file's ISA has to come in with no temperature,
 * pressure or humidity at all: a Settings default filling any one of them
 * would fly the bridge's ExtendedISAModel, sea-level air placed at the site.
 * The expected density is the kernel's ISA at the launch altitude, flown with
 * no atmosphere fields.
 */

const spec = {
  noseCone: { length: 0.1, aftRadius: 0.013, thickness: 0.001 },
  bodyTube: { length: 0.3, outerRadius: 0.013, thickness: 0.0005 },
  fins: { count: 3, rootChord: 0.06, tipChord: 0.03, sweep: 0.03, height: 0.04, thickness: 0.003 },
  motorMount: { length: 0.07, outerRadius: 0.0092, thickness: 0.0004 },
} as unknown as RocketSpec;
const { tree, mountId } = specToTree(spec);

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

const SITE_M = 1500;

const fileLaunch: LaunchConditions = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 0,
  windAverage: 0,
  windStdDev: 0,
  launchAltitudeM: SITE_M,
  latitudeDeg: 40,
  longitudeDeg: -105,
  temperatureC: null,
  pressureHPa: null,
};

/** Settings defaults with a humidity of their own, as a user who set one has. */
const defaults: LaunchConditions = { ...fileLaunch, launchAltitudeM: 0, relativeHumidity: 0.5 };

/** The pad's air density the kernel flies under these options. */
function padDensity(options: SimulationOptions): number {
  const d = OpenRocketDesign.buildTree(tree);
  d.setMotorById(mountId, C6);
  return d.simulate({ launchRodLength: 1, randomSeed: 7, series: 'full', ...options }).series['ρ']![0]!;
}

/** A desktop-shaped file whose atmosphere element is `atmosphere`, opened over the defaults. */
function opened(atmosphere: string): CompleteLaunch {
  const xml = exportOrk({ name: 'Air', tree, launch: fileLaunch }).replace('<atmosphere model="isa"/>', atmosphere);
  expect(xml).toContain(atmosphere);
  const wired = wireLoadedOrk(importOrk(xml) as unknown as LoadedOrk, defaults);
  return wired.sims[0]!.launch as CompleteLaunch;
}

describe("a file's atmosphere model", () => {
  const isa = () => padDensity({ launchAltitude: SITE_M });

  it.each([
    ['isa', '<atmosphere model="isa"/>'],
    [
      'isa, with base values the model does not fly',
      '<atmosphere model="isa"><basetemperature>300</basetemperature><basepressure>90000</basepressure><baserelativehumidity>0.8</baserelativehumidity></atmosphere>',
    ],
    ['no model', '<atmosphere/>'],
    [
      'an unknown model',
      '<atmosphere model="tropical"><basetemperature>300</basetemperature><baserelativehumidity>0.8</baserelativehumidity></atmosphere>',
    ],
  ])('flies the kernel ISA at the site for %s', (_label, atmosphere) => {
    const launch = opened(atmosphere);
    expect(padDensity(simConditions(launch))).toBeCloseTo(isa(), 9);
    expect(launch.temperatureC).toBeNull();
    expect(launch.pressureHPa).toBeNull();
    expect(launch.relativeHumidity ?? null).toBeNull();
  });

  it('flies an extendedisa file with its own humidity', () => {
    const launch = opened(
      '<atmosphere model="extendedisa"><basetemperature>300</basetemperature><basepressure>90000</basepressure><baserelativehumidity>0.8</baserelativehumidity></atmosphere>',
    );
    expect(launch.relativeHumidity).toBeCloseTo(0.8, 12);
    const own = padDensity({ launchAltitude: SITE_M, temperature: 300, pressure: 90_000, relativeHumidity: 0.8 });
    expect(padDensity(simConditions(launch))).toBeCloseTo(own, 9);
  });

  it('takes the Settings humidity for an extendedisa file that states none', () => {
    const launch = opened(
      '<atmosphere model="extendedisa"><basetemperature>300</basetemperature><basepressure>90000</basepressure></atmosphere>',
    );
    expect(launch.relativeHumidity).toBe(0.5);
  });
});
