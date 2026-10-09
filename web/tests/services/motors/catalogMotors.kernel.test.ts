import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { samplesToMotorSpec } from '../../../src/services/motors/thrustcurve';
import { defaultNode } from '../../../src/services/design/treeEdit';
import type { CatalogMotor } from '../../../src/services/motors/motorDb';
import type { ComponentType } from '../../../src/engine/openRocketEngine';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * Every thrust curve in the shipped catalog, seated in a mount by the real
 * engine. The kernel's motor builder refuses a curve that does not start at
 * t = 0 or that holds two thrusts at one time, and the catalog has both, so a
 * motor the picker offers could fail to fly. Motors the app refuses on purpose
 * (no published weights, more propellant than mass) are not the kernel's
 * business and are skipped.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
const loadEngine = async (): Promise<any> => {
  (globalThis as any).$rt_putStdoutCustom ??= () => {};
  (globalThis as any).$rt_putStderrCustom ??= () => {};
  return import('../../../src/engine/vendor/openrocket-engine.mjs' as string);
};

const catalog = JSON.parse(
  readFileSync(join(__dirname, '../../../public/data/motors.generated.json'), 'utf8'),
) as CatalogMotor[];

const node = (type: string, id: string, extra: object = {}, children: object[] = []) => ({
  ...defaultNode(type as ComponentType),
  id,
  ...extra,
  children,
});
const TREE = JSON.stringify({
  components: [
    node('stage', 'st', {}, [
      node('nosecone', 'n'),
      node('bodytube', 'b', { outerRadius: 0.1, length: 2 }, [
        node('innertube', 'mm', { motorMount: true, outerRadius: 0.08, length: 1.5 }),
      ]),
    ]),
  ],
});

describe('the shipped motor catalog', () => {
  it('builds every curve in the kernel', async () => {
    const engine = await loadEngine();
    const failed: string[] = [];
    let built = 0;
    for (const m of catalog) {
      if (m.length == null || m.propWeightG == null) continue;
      for (const curve of m.curves ?? []) {
        let spec;
        try {
          spec = samplesToMotorSpec(
            {
              motorId: m.designation,
              designation: m.designation,
              commonName: m.designation,
              manufacturerAbbrev: m.manufacturer,
              diameter: m.diameter,
              length: m.length,
              totalWeightG: m.mass,
              propWeightG: m.propWeightG,
              availability: 'regular',
            },
            curve.samples.map(([time, thrust]) => ({ time, thrust })),
            6,
          );
        } catch {
          continue; // refused by the app on purpose, with its own message
        }
        engine.reset();
        const h = engine.buildRocket(TREE);
        try {
          engine.setMotorById(
            h,
            'mm',
            spec.designation,
            spec.diameter,
            spec.length,
            spec.times,
            spec.thrusts,
            spec.masses,
            spec.cgX,
            6,
          );
          built++;
        } catch (e) {
          failed.push(`${m.manufacturer} ${m.designation} (${curve.src}): ${String(e).slice(0, 80)}`);
        }
      }
    }
    expect(built).toBeGreaterThan(1500);
    expect(failed).toEqual([]);
  });
});
