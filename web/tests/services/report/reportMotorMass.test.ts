import { describe, it, expect, beforeAll, vi } from 'vitest';
import { __setEngineForTests, type MotorSpec, type RocketTree } from '../../../src/engine/openRocketEngine';
import { C6 } from '../../../src/engine/api';
import { buildConfiguredRocket } from '../../../src/services/design/buildRocket';
import { newFlightConfig, type FlightConfig } from '../../../src/services/flight/flightConfigs';
import { assembleReport, configMotors, type ReportBuild } from '../../../src/services/report/reportModel';
import { twRatio } from '../../../src/services/report/motorsSection';
import { useWorkspaceStore } from '../../../src/state/store';
import { resultKey, type Simulation } from '../../../src/services/flight/simulations';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

/**
 * Thrust-to-weight is the motor's average thrust over the weight it lifts, and
 * that weight is its own configuration's: a heavier motor in another
 * configuration is a heavier rocket. The expected masses come from the kernel,
 * each from a build of that configuration alone.
 */
vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

beforeAll(async () => {
  __setEngineForTests(await import('../../../src/engine/vendor/openrocket-engine.mjs'));
});

const G = 9.80665;

const tube = (id: string) => ({
  id,
  type: 'bodytube',
  length: 0.2,
  outerRadius: 0.013,
  thickness: 0.0005,
  motorMount: true,
  children: [
    {
      id: `${id}-fins`,
      type: 'trapezoidfinset',
      finCount: 3,
      rootChord: 0.06,
      tipChord: 0.03,
      sweep: 0.03,
      height: 0.05,
      thickness: 0.003,
    },
  ],
});

const nose = { id: 'nose', type: 'nosecone', length: 0.1, aftRadius: 0.013, thickness: 0.001, shape: 'ogive' };

const SINGLE = {
  name: 'One',
  components: [{ id: 'stage1', type: 'stage', children: [nose, tube('mount')] }],
} as unknown as RocketTree;

const SUSTAINER = { id: 'sustainer', type: 'stage', name: 'Sustainer', children: [nose, tube('sus')] };
const BOOSTER = { id: 'booster', type: 'stage', name: 'Booster', children: [tube('boo')] };
const TWO = { name: 'Two', components: [SUSTAINER, BOOSTER] } as unknown as RocketTree;

/** The C6 curve with three times the propellant and case mass. */
const HEAVY = { ...C6, designation: 'C6-heavy', masses: C6.masses.map((m) => m * 3) } as MotorSpec;

const massOf = (tree: RocketTree, config: FlightConfig) => buildConfiguredRocket(tree, config).staticInfo().mass;
const ratio = (avg: number, mass: number) => `${(avg / (mass * G)).toFixed(2)}:1`;

describe('thrust-to-weight per configuration', () => {
  const light = newFlightConfig({ mount: { spec: C6 } }, 'Light', 'light');
  const heavy = newFlightConfig({ mount: { spec: HEAVY } }, 'Heavy', 'heavy');

  it('weighs each configuration with its own motor', () => {
    const lightMass = massOf(SINGLE, light);
    const heavyMass = massOf(SINGLE, heavy);
    expect(heavyMass - lightMass).toBeCloseTo((HEAVY.masses[0]! - C6.masses[0]!) * 1, 6);

    const [l] = configMotors(SINGLE, light, buildConfiguredRocket);
    const [h] = configMotors(SINGLE, heavy, buildConfiguredRocket);
    expect(l!.loadedMass).toBeCloseTo(lightMass, 9);
    expect(h!.loadedMass).toBeCloseTo(heavyMass, 9);
    expect(twRatio(l!.avgThrust, l!.loadedMass)).toBe(ratio(l!.avgThrust, lightMass));
    expect(twRatio(h!.avgThrust, h!.loadedMass)).toBe(ratio(h!.avgThrust, heavyMass));
    expect(twRatio(l!.avgThrust, l!.loadedMass)).not.toBe(twRatio(h!.avgThrust, h!.loadedMass));
  });

  it('gives the report each simulation its configuration mass, not the selected one', () => {
    const flown = buildConfiguredRocket(SINGLE, light);
    useWorkspaceStore.setState({
      tree: SINGLE,
      configs: [light, heavy],
      sims: [
        { id: 'a', name: 'Light flight', configId: 'light', launch: {} as never, result: null },
        { id: 'b', name: 'Heavy flight', configId: 'heavy', launch: {} as never, result: null },
      ],
      activeId: 'a',
      info: flown.staticInfo(),
      rocket: flown as never,
    });
    let rebuilt: ReportBuild | null = null;
    const model = assembleReport((b) => (rebuilt = b))!;
    expect(model.configs.map((c) => c.motors[0]!.loadedMass)).toEqual([
      expect.closeTo(massOf(SINGLE, light), 9),
      expect.closeTo(massOf(SINGLE, heavy), 9),
    ]);
    // The heavy configuration was built for its mass, so the live handle is
    // handed back rebuilt on the flown configuration.
    expect((rebuilt as ReportBuild | null)?.info.mass).toBeCloseTo(massOf(SINGLE, light), 9);
  });

  it('costs no build when every simulation flies the selected configuration', () => {
    const flown = buildConfiguredRocket(SINGLE, light);
    const info = flown.staticInfo();
    const build = vi.fn(buildConfiguredRocket);
    const [m] = configMotors(SINGLE, light, build, info.mass);
    expect(build).not.toHaveBeenCalled();
    expect(m!.loadedMass).toBe(info.mass);
  });

  /**
   * A motor lifts the stack from the top through its own stage: the sustainer's
   * motor does not lift the booster, the booster's motor lifts both.
   */
  it('weighs an upper-stage motor without the stages below it', () => {
    const cfg = newFlightConfig({ sus: { spec: C6 }, boo: { spec: HEAVY } });
    const rows = configMotors(TWO, cfg, buildConfiguredRocket);
    expect(rows.map((r) => r.designation)).toEqual(['C6', 'C6-heavy']);
    const sustainerOnly = massOf({ name: 'Two', components: [SUSTAINER] } as unknown as RocketTree, cfg);
    const stack = massOf(TWO, cfg);
    expect(rows[0]!.loadedMass).toBeCloseTo(sustainerOnly, 9);
    expect(rows[1]!.loadedMass).toBeCloseTo(stack, 9);
    expect(stack).toBeGreaterThan(sustainerOnly);
  });

  it('has no ratio for a configuration the kernel could not weigh', () => {
    const rows = configMotors(SINGLE, light, () => {
      throw new Error('no build');
    });
    expect(rows[0]!.loadedMass).toBeNaN();
    expect(twRatio(rows[0]!.avgThrust, rows[0]!.loadedMass)).not.toMatch(/:1$/);
  });
});

describe('simulation results in the report', () => {
  it('marks a result flown from an earlier state of the design as outdated', () => {
    const light = newFlightConfig({ mount: { spec: C6 } }, 'Light', 'light');
    const flown = buildConfiguredRocket(SINGLE, light);
    const summary = { maxAltitude: 100 } as never;
    const sim = (id: string): Simulation =>
      ({
        id,
        name: id,
        configId: 'light',
        launch: {},
        result: { summary },
        resultKey: 'stale',
      }) as unknown as Simulation;
    const fresh = sim('fresh');
    const stale = sim('stale');
    const { simPrefs } = useWorkspaceStore.getState();
    fresh.resultKey = resultKey(SINGLE, light, fresh, simPrefs);
    useWorkspaceStore.setState({
      tree: SINGLE,
      configs: [light],
      sims: [fresh, stale, { ...sim('none'), result: null }],
      activeId: 'fresh',
      info: flown.staticInfo(),
      rocket: flown as never,
    });
    const model = assembleReport(() => {})!;
    expect(model.configs.map((c) => [c.name, c.outdated])).toEqual([
      ['fresh', false],
      ['stale', true],
      ['none', false],
    ]);
  });
});
