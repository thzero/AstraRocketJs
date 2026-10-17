import { describe, expect, it, vi } from 'vitest';
import type { FlightResult } from '../../src/engine/openRocketEngine';
import { loadEngine } from '../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * Motor events from mounts in one stage that fire at the same time come out in
 * the same order on every build of the design.
 *
 * `FlightEvent.compareTo` ties two events of one type, time and stage, so the
 * order they are queued in decides the order they are recorded in. That order
 * is `FlightConfiguration.motors.values()`, and the map's key hashes the
 * mount's id, a `UUID.randomUUID()` per component: a hashed map gives a
 * different order on every build. The order is not tree order: the event queue
 * is a binary heap, which does not keep ties in the order they were added. With
 * eight mounts, two builds of a hashed map agree by chance 1 in 40,320.
 */

const MOUNT_IDS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];

const TREE = {
  name: 'Cluster',
  components: [
    {
      id: 'st',
      type: 'stage',
      name: 'Sustainer',
      children: [
        { id: 'n', type: 'nosecone', shape: 'ogive', length: 0.15, aftRadius: 0.04, thickness: 0.002 },
        {
          id: 'b',
          type: 'bodytube',
          length: 0.5,
          outerRadius: 0.04,
          thickness: 0.001,
          children: [
            {
              id: 'f',
              type: 'trapezoidfinset',
              finCount: 4,
              rootChord: 0.12,
              tipChord: 0.06,
              sweep: 0.06,
              height: 0.08,
              thickness: 0.003,
            },
            ...MOUNT_IDS.map((id) => ({
              id,
              type: 'innertube',
              length: 0.07,
              outerRadius: 0.0095,
              thickness: 0.0005,
              motorMount: true,
              position: { method: 'bottom', offset: 0 },
            })),
            { id: 'chute', type: 'parachute', name: 'Main', diameter: 0.6, cd: 0.8 },
          ],
        },
      ],
    },
  ],
};

describe('same-time motor events', () => {
  it('records ignition and burnout in one order on every build', async () => {
    const engine = await loadEngine();
    const fly = (): FlightResult => {
      engine.reset();
      const h = engine.buildRocket(JSON.stringify(TREE));
      for (const id of MOUNT_IDS) {
        engine.setMotorById(h, id, 'C6', 0.018, 0.07, [0, 0.2, 1.8], [0, 14, 0], [0.024, 0.022, 0.012], 0.035, 3);
      }
      return JSON.parse(engine.simulateJson(h, JSON.stringify({ launchRodLength: 1, randomSeed: 7 }))) as FlightResult;
    };
    const order = (r: FlightResult, type: string) => r.events.filter((e) => e.type === type).map((e) => e.sourceId);
    const first = fly();
    const second = fly();
    const third = fly();
    // EJECTION_CHARGE names the stage, not the mount, so its order cannot show.
    for (const type of ['IGNITION', 'BURNOUT']) {
      // Every mount fires once, at one time.
      expect([...order(first, type)].sort(), type).toEqual(MOUNT_IDS);
      expect(new Set(first.events.filter((e) => e.type === type).map((e) => e.time)).size, type).toBe(1);
      expect(order(second, type), type).toEqual(order(first, type));
      expect(order(third, type), type).toEqual(order(first, type));
    }
  });
});
