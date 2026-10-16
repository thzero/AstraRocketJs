import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __setEngineForTests } from '../../../src/engine/openRocketEngine';
import { loadCatalog } from '../../../src/services/motors/motorDb';
import { avgThrustOf } from '../../../src/services/motors/motorMath';
import type { CustomMotor } from '../../../src/services/motors/motorStore';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/** The bundled Apogee C6's curve, imported as a custom motor. */
const c6Samples = (): { time: number; thrust: number }[] => {
  const rows = JSON.parse(readFileSync(join(__dirname, '../../../public/data/motors.generated.json'), 'utf8')) as {
    manufacturer: string;
    designation: string;
    curves: { samples: [number, number][] }[];
  }[];
  const row = rows.find((r) => r.manufacturer === 'Apogee' && /^C6\b/.test(r.designation))!;
  return row.curves[0]!.samples.map(([time, thrust]) => ({ time, thrust }));
};

let stored: CustomMotor[] = [];
vi.mock('../../../src/services/app/remoteData', () => ({ fetchCatalog: vi.fn(async () => []) }));
vi.mock('../../../src/services/motors/motorStore', () => ({
  getMotorStore: () => ({ listCustomMotors: async () => stored }),
}));

beforeAll(async () => {
  __setEngineForTests(await loadEngine());
});

/**
 * A custom motor's picker row shows the burn and average the kernel states for
 * it (ThrustCurveMotor.computeStatistics: between the crossings of 5% of peak),
 * as the spec dialog and the report do, not the last sample's time and the
 * impulse over it.
 */
describe("a custom motor's picker row", () => {
  it("shows the kernel's burn time and average thrust", async () => {
    stored = [
      {
        id: 'custom:Test:C6',
        designation: 'C6',
        manufacturer: 'Test',
        class: 'C',
        diameter: 18,
        length: 70,
        totalWeightG: 24,
        propWeightG: 12,
        samples: c6Samples(),
      } as unknown as CustomMotor,
    ];
    const row = (await loadCatalog()).find((r) => r.custom)!;
    expect(row.burn).toBeCloseTo(1.2, 1);
    expect(avgThrustOf(row)).toBeCloseTo(8.3, 1);
  });
});
