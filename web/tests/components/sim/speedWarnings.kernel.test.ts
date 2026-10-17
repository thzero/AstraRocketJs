import { describe, expect, it, vi } from 'vitest';
import { deploymentVerdict, lastDeployment } from '../../../src/components/sim/speedWarnings';
import { sharedDeviceNames } from '../../../src/services/flight/recoveryFlown';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import type { FlightResult } from '../../../src/engine/openRocketEngine';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * The deployment-speed verdict reads only the warnings raised for the devices
 * of the branch the tile shows.
 *
 * The kernel's warning list is the whole flight's, and the tile's speed is one
 * branch's. The flight here is the kernel's, through the bridge, with a
 * threshold low enough that its chute warns.
 */

const TREE = {
  name: 'R',
  components: [
    {
      id: 'st',
      type: 'stage',
      name: 'Sustainer',
      children: [
        { id: 'n', type: 'nosecone', shape: 'ogive', length: 0.07, aftRadius: 0.013, thickness: 0.001 },
        {
          id: 'm',
          type: 'bodytube',
          length: 0.3,
          outerRadius: 0.013,
          thickness: 0.0005,
          motorMount: true,
          children: [
            {
              id: 'f',
              type: 'trapezoidfinset',
              finCount: 3,
              rootChord: 0.06,
              tipChord: 0.03,
              sweep: 0.03,
              height: 0.05,
              thickness: 0.003,
            },
            { id: 'chute', type: 'parachute', name: 'Main', diameter: 0.4, cd: 0.8 },
          ],
        },
      ],
    },
  ],
};

describe('deploymentVerdict', () => {
  it('takes a warning for a device of the branch, and ignores one for another stage’s device', async () => {
    const engine = await loadEngine();
    engine.reset();
    const h = engine.buildRocket(JSON.stringify(TREE));
    engine.setMotorById(h, 'm', 'C6', 0.018, 0.07, [0, 0.2, 1.8], [0, 14, 0], [0.024, 0.022, 0.012], 0.035, 3);
    const result = JSON.parse(
      engine.simulateJson(h, JSON.stringify({ launchRodLength: 1, randomSeed: 7, recoverySpeedWarn: 0.01 })),
    ) as FlightResult;
    const speed = result.summary.deploymentVelocity!;
    expect(speed).toBeGreaterThan(0.01);
    // The kernel warned, naming the chute.
    expect(result.warnings?.some((w) => w.message.includes('"Main"'))).toBe(true);

    expect(deployedSources(result.events)).toEqual(['Main']);
    const devices = lastDeployment(result.events);
    expect(deploymentVerdict(speed, result.warnings, 0.01, devices)).toBe('tooFast');
    // A branch whose own chute is another one: the warning is not its.
    expect(deploymentVerdict(speed, result.warnings, 0.01, [{ name: 'Booster chute' }])).toBeNull();
  });

  /**
   * Two chutes the user never named fly under the same kernel default name, so
   * the name in the message cannot say which stage's chute the warning is for.
   * Only the booster's opens fast here: it deploys at the booster's burnout,
   * the sustainer's near its apogee.
   */
  it('keeps a booster chute’s warning off the sustainer when neither chute is named', async () => {
    const result = await flyTwoStage();
    const [sustainer, booster] = result.branches!;
    // Both chutes fly under the kernel's default name.
    expect(deployedSources(sustainer!.events)).toEqual(['[Parachute.Parachute]']);
    expect(deployedSources(booster!.events)).toEqual(['[Parachute.Parachute]']);
    const sDevices = lastDeployment(sustainer!.events);
    const bDevices = lastDeployment(booster!.events);
    // The kernel warned once, for the booster's chute.
    const fast = result.warnings!.filter((w) => w.key === 'HighSpeedDeployment');
    expect(fast).toHaveLength(1);
    expect(fast[0]!.message).toContain('"[Parachute.Parachute]"');

    expect(deploymentVerdict(0, result.warnings, WARN, bDevices)).toBe('tooFast');
    expect(deploymentVerdict(0, result.warnings, WARN, sDevices)).toBeNull();
  });

  /**
   * A result stored before the engine sent node ids has the same warnings with
   * names only. The two chutes' shared default name could be either stage's, so
   * the warning marks neither tile.
   */
  it('takes no verdict from an id-less warning whose name two chutes share', async () => {
    const result = await flyTwoStage();
    const stored = JSON.parse(
      JSON.stringify(result, (k, v) => (k === 'sourceId' || k === 'sourceIds' ? undefined : v)),
    ) as FlightResult;
    const [sustainer, booster] = stored.branches!;
    const shared = sharedDeviceNames(TWO_STAGE.components as unknown as ComponentNode[]);
    expect([...shared]).toEqual(['[Parachute.Parachute]']);
    expect(stored.warnings!.some((w) => w.key === 'HighSpeedDeployment')).toBe(true);
    expect(deploymentVerdict(0, stored.warnings, WARN, lastDeployment(sustainer!.events), shared)).toBeNull();
    expect(deploymentVerdict(0, stored.warnings, WARN, lastDeployment(booster!.events), shared)).toBeNull();
  });
});

/**
 * The tile shows the speed of the branch's last deployment (the kernel's
 * deployment velocity), so a device opened earlier on the same branch, and the
 * warning the kernel raised for it, is not what the tile judges.
 */
describe('the last deployment', () => {
  /**
   * One stage, two chutes: "Early" opens on the ejection charge while the
   * rocket still climbs fast, "Late" at 40 m under it, slowly.
   */
  const tree = () => {
    const t = JSON.parse(JSON.stringify(TREE)) as typeof TREE;
    const kids = t.components[0]!.children[1]!.children as Record<string, unknown>[];
    kids.splice(1, 1, {
      id: 'early',
      type: 'parachute',
      name: 'Early',
      diameter: 0.6,
      cd: 0.8,
      deployEvent: 'ejection',
    });
    kids.push({
      id: 'late',
      type: 'parachute',
      name: 'Late',
      diameter: 0.4,
      cd: 0.8,
      deployEvent: 'altitude',
      deployAltitude: 40,
    });
    return t;
  };
  const fly = async (delay: number, warn: number): Promise<FlightResult> => {
    const engine = await loadEngine();
    engine.reset();
    const h = engine.buildRocket(JSON.stringify(tree()));
    engine.setMotorById(h, 'm', 'C6', 0.018, 0.07, [0, 0.2, 1.8], [0, 14, 0], [0.024, 0.022, 0.012], 0.035, delay);
    return JSON.parse(
      engine.simulateJson(h, JSON.stringify({ launchRodLength: 1, randomSeed: 7, recoverySpeedWarn: warn })),
    ) as FlightResult;
  };

  for (const delay of [0.5, 1, 2]) {
    it(`judges the chute that opened last, with the first opened on a ${delay} s delay`, async () => {
      // A low threshold first, to read both deployment speeds off the kernel.
      const probe = await fly(delay, 0.01);
      const deploys = probe.events.filter((e) => e.type === 'RECOVERY_DEVICE_DEPLOYMENT');
      expect(deploys.map((e) => e.source)).toEqual(['Early', 'Late']);
      const lateSpeed = probe.summary.deploymentVelocity!;

      // Then a threshold over the last deployment's speed: the kernel warns
      // for "Early" alone.
      const warn = lateSpeed + 1;
      const result = await fly(delay, warn);
      const warned = result.warnings!.filter((w) => w.key === 'HighSpeedDeployment');
      expect(warned).toHaveLength(1);
      expect(warned[0]!.sourceIds).toEqual(['early']);
      expect(result.summary.deploymentVelocity!).toBeLessThan(warn);

      const devices = lastDeployment(result.events);
      expect(devices.map((d) => d.id)).toEqual(['late']);
      expect(deploymentVerdict(result.summary.deploymentVelocity!, result.warnings, warn, devices)).toBeNull();
      // Named only (a result read from a file): the same verdict.
      const named = devices.map((d) => ({ name: d.name }));
      const withoutIds = result.warnings!.map(({ sourceIds: _, ...w }) => w);
      expect(deploymentVerdict(result.summary.deploymentVelocity!, withoutIds, warn, named)).toBeNull();
    });
  }

  it('judges both chutes when they open at the same instant', async () => {
    const engine = await loadEngine();
    engine.reset();
    const t = tree();
    const kids = t.components[0]!.children[1]!.children as Record<string, unknown>[];
    kids[kids.length - 1] = { ...kids[kids.length - 1], deployEvent: 'ejection' };
    const h = engine.buildRocket(JSON.stringify(t));
    engine.setMotorById(h, 'm', 'C6', 0.018, 0.07, [0, 0.2, 1.8], [0, 14, 0], [0.024, 0.022, 0.012], 0.035, 1);
    const result = JSON.parse(
      engine.simulateJson(h, JSON.stringify({ launchRodLength: 1, randomSeed: 7, recoverySpeedWarn: 0.01 })),
    ) as FlightResult;
    expect(
      lastDeployment(result.events)
        .map((d) => d.id)
        .sort(),
    ).toEqual(['early', 'late']);
  });
});

/** The names the kernel's deployment events carry, read straight off the events. */
const deployedSources = (events: FlightResult['events']) =>
  events.flatMap((e) => (e.type === 'RECOVERY_DEVICE_DEPLOYMENT' ? [e.source] : []));

/**
 * The two-stage flight through the bridge: the booster separates at its
 * burnout and its chute opens there, fast; the sustainer lights a second later
 * and its chute opens near apogee.
 */
async function flyTwoStage(): Promise<FlightResult> {
  const engine = await loadEngine();
  engine.reset();
  const h = engine.buildRocket(JSON.stringify(TWO_STAGE));
  const times = [0, 0.1, 0.3, 0.5, 1.0, 1.5, 1.85, 2.0];
  const thrusts = [0, 12.0, 6.0, 5.1, 4.9, 4.8, 4.5, 0];
  const masses = [0.024, 0.0231, 0.0215, 0.0202, 0.0174, 0.0147, 0.0133, 0.0132];
  engine.setMotorById(h, 'sustainer-mount', 'C6', 0.018, 0.07, times, thrusts, masses, 0.035, 5);
  engine.setMotorById(h, 'booster-mount', 'C6', 0.018, 0.07, times, thrusts, masses, 0.035, 0);
  engine.setMotorIgnitionById(h, 'sustainer-mount', 'burnout', 1);
  return JSON.parse(
    engine.simulateJson(h, JSON.stringify({ launchRodLength: 1, randomSeed: 7, recoverySpeedWarn: WARN })),
  ) as FlightResult;
}

/** The deployment-speed threshold for the two-stage flight (m/s). */
const WARN = 20;

const TWO_STAGE = {
  name: 'TwoStage',
  components: [
    {
      id: 'sus',
      type: 'stage',
      name: 'Sustainer',
      children: [
        { id: 'sn', type: 'nosecone', length: 0.07, aftRadius: 0.012, thickness: 0.002 },
        {
          id: 'sb',
          type: 'bodytube',
          length: 0.3,
          outerRadius: 0.012,
          thickness: 0.0003,
          density: 950,
          children: [
            {
              id: 'sf',
              type: 'trapezoidfinset',
              finCount: 3,
              rootChord: 0.05,
              tipChord: 0.03,
              sweep: 0.02,
              height: 0.025,
              thickness: 0.003,
            },
            {
              id: 'sustainer-mount',
              type: 'innertube',
              length: 0.07,
              outerRadius: 0.0095,
              thickness: 0.0005,
              motorMount: true,
              position: { method: 'bottom', offset: 0 },
            },
            { id: 'sustainer-chute', type: 'parachute', diameter: 0.35 },
          ],
        },
      ],
    },
    {
      id: 'boo',
      type: 'stage',
      name: 'Booster',
      separationEvent: 'burnout',
      children: [
        {
          id: 'bb',
          type: 'bodytube',
          length: 0.12,
          outerRadius: 0.012,
          thickness: 0.0003,
          density: 950,
          children: [
            {
              id: 'bf',
              type: 'trapezoidfinset',
              finCount: 3,
              rootChord: 0.05,
              tipChord: 0.03,
              sweep: 0.025,
              height: 0.035,
              thickness: 0.003,
            },
            {
              id: 'booster-mount',
              type: 'innertube',
              length: 0.07,
              outerRadius: 0.0095,
              thickness: 0.0005,
              motorMount: true,
              position: { method: 'bottom', offset: 0 },
            },
            { id: 'booster-chute', type: 'parachute', diameter: 0.25 },
          ],
        },
      ],
    },
  ],
};
