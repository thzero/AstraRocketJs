import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { __setEngineForTests, motorStatistics } from '../../../src/engine/openRocketEngine';
import { finalizeSamples } from '../../../src/services/motors/curveFinalize';
import { combineCurves, type Sample } from '../../../src/services/motors/motorCombine';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

interface CatalogRow {
  manufacturer: string;
  designation: string;
  curves?: { samples: Sample[] }[];
}

const rows = JSON.parse(
  readFileSync(join(__dirname, '../../../public/data/motors.generated.json'), 'utf8'),
) as CatalogRow[];

/** First curve of every catalog row, as the Combine pane reads it. */
const curves = rows.map((r) => r.curves?.[0]?.samples ?? []).filter((c) => c.length >= 2);
const lateStart = curves.filter((c) => c[0]![0] > 0);
const zeroStart = curves.filter((c) => c[0]![0] === 0);

/** Pairs spread across the catalog: late with late, late with zero-start, and triples. */
function clusters(): Sample[][][] {
  const out: Sample[][][] = [];
  const step = Math.max(1, Math.floor(lateStart.length / 20));
  for (let i = 0; i + step < lateStart.length; i += step) {
    out.push([lateStart[i]!, lateStart[i + step]!]);
    out.push([lateStart[i]!, zeroStart[i % zeroStart.length]!]);
    out.push([lateStart[i]!, lateStart[i]!, lateStart[(i + 2 * step) % lateStart.length]!]);
  }
  return out;
}

beforeAll(async () => {
  __setEngineForTests(await loadEngine());
});

describe('combineCurves against the kernel', () => {
  it('the catalog has curves that start after t = 0', () => {
    expect(lateStart.length).toBeGreaterThan(100);
  });

  it('gives a summed curve the kernel takes, with the impulse the kernel flies for each motor', () => {
    const all = clusters();
    expect(all.length).toBeGreaterThan(40);
    for (const cluster of all) {
      const c = combineCurves(cluster);
      const summed = motorStatistics(c.samples);
      expect(summed, 'kernel refused the summed curve').not.toBeNull();
      // The kernel's own impulse for each motor as it flies it.
      const each = cluster.map((m) => motorStatistics(finalizeSamples(m)));
      for (const e of each) expect(e).not.toBeNull();
      const kernelSum = each.reduce((s, e) => s + e!.totalImpulse, 0);
      expect(c.totalImpulse).toBeCloseTo(kernelSum, 6);
      // The kernel's impulse of the sum is the sum of the kernel's impulses.
      expect(summed!.totalImpulse).toBeCloseTo(kernelSum, 3);
      expect(summed!.maxThrust).toBeCloseTo(c.peakThrust, 6);
    }
  });
});
