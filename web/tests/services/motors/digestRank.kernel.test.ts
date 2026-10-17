import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { __setEngineForTests, motorStatistics } from '../../../src/engine/openRocketEngine';
import { finalizeSamples } from '../../../src/services/motors/curveFinalize';
import type { CatalogMotor } from '../../../src/services/motors/motorDb';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
// @ts-expect-error - a plain .mjs build script helper, no types
import { flownMotor } from '../../../scripts/lib/digestRank.mjs';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * The digest sync ranks desktop's entries against what the app flies, so its
 * figures for a row have to be the kernel's for the curve the picker seats:
 * the row's first curve, finalized as the app finalizes it.
 */
const CATALOG = JSON.parse(
  readFileSync(join(__dirname, '../../../public/data/motors.generated.json'), 'utf8'),
) as CatalogMotor[];

interface Flown {
  launchMass?: number;
  impulse?: number;
  burn?: number;
  maxThrust?: number;
}

beforeAll(async () => {
  __setEngineForTests(await loadEngine());
});

describe('the digest sync reads a row as the app flies it', () => {
  it('states the kernel’s impulse, burn and peak for the seated curve of every catalog row', () => {
    const rows = CATALOG.filter((r) => (r.curves?.[0]?.samples.length ?? 0) > 1);
    expect(rows.length).toBeGreaterThan(1000);
    const off: string[] = [];
    for (const r of rows) {
      const kernel = motorStatistics(finalizeSamples(r.curves![0]!.samples));
      const ours = flownMotor(r) as Flown;
      const name = `${r.manufacturer} ${r.code ?? r.designation}`;
      if (!kernel) {
        if (ours.impulse !== undefined) off.push(`${name}: kernel has no statistics`);
        continue;
      }
      const close = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) <= 1e-9 * Math.max(1, b);
      if (!close(ours.impulse, kernel.totalImpulse))
        off.push(`${name} impulse ${ours.impulse} vs ${kernel.totalImpulse}`);
      if (!close(ours.burn, kernel.burnTime)) off.push(`${name} burn ${ours.burn} vs ${kernel.burnTime}`);
      if (!close(ours.maxThrust, kernel.maxThrust)) off.push(`${name} peak ${ours.maxThrust} vs ${kernel.maxThrust}`);
    }
    expect(off).toEqual([]);
  });

  it('takes the loaded mass the app seats, in kilograms', () => {
    const r = CATALOG.find((m) => m.manufacturer === 'AeroTech' && m.code === 'L339N')!;
    expect((flownMotor(r) as Flown).launchMass).toBe(r.mass / 1000);
  });
});
