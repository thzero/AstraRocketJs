// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore, selectConfig, workspaceSnapshot } from '../../src/state/store';
import { DesignLibrary, getDesignLibrary, setDesignLibrary } from '../../src/services/storage/designLibrary';
import { lean } from '../../src/services/storage/workspaceStore';
import type { KeyValueStore } from '../../src/services/storage/keyValueStore';
import { __setEngineForTests, motorStatistics, type MotorSpec } from '../../src/engine/openRocketEngine';
import { loadEngine } from '../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/** The certified Estes C6 row of the bundled catalog. */
const row = (
  JSON.parse(readFileSync(join(__dirname, '../../public/data/motors.generated.json'), 'utf8')) as {
    manufacturer: string;
    designation: string;
    impulse: number;
    maxThrust: number;
  }[]
).find((r) => r.manufacturer === 'Estes' && r.designation === 'C6')!;

/** The catalog states impulse to two decimals. */
const CATALOG_ROUNDING = 0.005;

/** The built-in C6 as designs stored by an earlier build seat it. */
const storedC6: MotorSpec = {
  designation: 'C6',
  manufacturer: 'Estes',
  diameter: 0.018,
  length: 0.07,
  times: [0, 0.2, 0.4, 2.0, 2.1],
  thrusts: [0, 12, 5, 5, 0],
  masses: [0.0227, 0.0165, 0.0165, 0.013, 0.012],
  cgX: 0.035,
  ejectionDelay: 3,
};

class MemoryKv implements KeyValueStore {
  map = new Map<string, string>();
  async get(k: string) {
    return this.map.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.map.set(k, v);
    return true;
  }
  async remove(k: string) {
    this.map.delete(k);
  }
  async update(k: string, fn: (raw: string | null) => string | null) {
    const next = fn(this.map.get(k) ?? null);
    if (next === null) this.map.delete(k);
    else this.map.set(k, next);
    return true;
  }
}

const s = () => useWorkspaceStore.getState();
const pairs = (spec: MotorSpec) => spec.times.map((t, i) => [t, spec.thrusts[i]!] as [number, number]);

let original: DesignLibrary;

beforeAll(async () => {
  __setEngineForTests(await loadEngine());
});

beforeEach(() => {
  localStorage.clear();
  original = getDesignLibrary();
  setDesignLibrary(new DesignLibrary(new MemoryKv()));
});

afterEach(() => setDesignLibrary(original));

/**
 * A design stored while the built-in C6 was a placeholder curve opens flying
 * the Estes C6 the catalog lists, with the delay it was stored with.
 */
describe('a stored design seating the placeholder C6', () => {
  it("opens with the catalog row's impulse and peak thrust, as the kernel computes them", async () => {
    s().resetWorkspace();
    const base = workspaceSnapshot(s());
    const configs = base.configs.map((c) => ({
      ...c,
      motors: Object.fromEntries(Object.keys(c.motors).map((id) => [id, { spec: storedC6 }])),
    }));
    expect(Object.keys(configs[0]!.motors)).not.toHaveLength(0);
    const id = (await getDesignLibrary().create('Old', lean({ ...base, configs }))).id;

    await s().openDesign(id);

    const seated = Object.values(selectConfig(s()).motors).map((m) => m.spec);
    expect(seated).not.toHaveLength(0);
    for (const spec of seated) {
      const stats = motorStatistics(pairs(spec))!;
      expect(stats).not.toBeNull();
      expect(Math.abs(stats.totalImpulse - row.impulse)).toBeLessThanOrEqual(CATALOG_ROUNDING);
      expect(stats.maxThrust).toBeCloseTo(row.maxThrust, 9);
      expect(spec.ejectionDelay).toBe(storedC6.ejectionDelay);
    }
  });
});
