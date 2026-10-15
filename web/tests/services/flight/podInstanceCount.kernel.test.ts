// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { MotorSpec, RocketTree } from '../../../src/engine/openRocketEngine';
import { seatedMotors } from '../../../src/services/flight/powerClass';
import { newFlightConfig } from '../../../src/services/flight/flightConfigs';
import { kernelGeometry, loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS });

const motor: MotorSpec = {
  designation: 'X',
  diameter: 0.018,
  length: 0.07,
  times: [0, 1],
  thrusts: [10, 10],
  masses: [0.02, 0.01],
  cgX: 0.035,
  delay: 3,
} as unknown as MotorSpec;

/** A core with a pod assembly around it, each pod carrying a motor mount. */
const design = (type: 'podset' | 'parallelstage', count?: number): RocketTree =>
  ({
    components: [
      {
        type: 'stage',
        id: 's',
        children: [
          { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.02, thickness: 0.001 },
          {
            type: 'bodytube',
            id: 'b',
            length: 0.3,
            outerRadius: 0.02,
            thickness: 0.0005,
            children: [
              {
                type,
                id: 'pods',
                ...(count === undefined ? {} : { instanceCount: count }),
                radiusOffset: 0,
                children: [
                  ...(type === 'parallelstage'
                    ? [{ type: 'nosecone', id: 'pn', length: 0.05, aftRadius: 0.01, thickness: 0.001 }]
                    : []),
                  {
                    type: 'bodytube',
                    id: 'pb',
                    length: 0.15,
                    outerRadius: 0.01,
                    thickness: 0.0005,
                    motorMount: true,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

describe('the motor count of a pod assembly', () => {
  for (const type of ['podset', 'parallelstage'] as const) {
    for (const count of [undefined, 1, 3, 5]) {
      it(`${type} with ${count === undefined ? 'no count' : `${count} copies`} counts the copies the kernel flies`, async () => {
        const tree = design(type, count);
        const engine = await loadEngine();
        const k = kernelGeometry(engine, tree, { fields: true }).get('pods')!;
        const flown = Number(k.fields?.['instanceCount']);
        expect(Number.isInteger(flown)).toBe(true);
        const config = newFlightConfig({ pb: { spec: motor } });
        expect(seatedMotors(tree, config).map((m) => m.count)).toEqual([flown]);
      });
    }
  }
});
