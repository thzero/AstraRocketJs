import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { catalogPatch, defaultNode } from '../../../src/services/design/treeEdit';
import { isComponentRow, type Component } from '../../../src/services/parts/componentDb';
import type { ComponentNode, ComponentType } from '../../../src/engine/openRocketEngine';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * Every kind of catalog row, applied to a part and built by the real engine.
 *
 * `catalogPatch` writes node keys the bridge reads by name, so a key spelled
 * wrong (or one the bridge does not know) is simply ignored: the part keeps its
 * default size and the picker looks like it did nothing. Building each row and
 * reading back the length the kernel gives the part catches that, and a
 * positive mass says the material reached it too.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const loadEngine = async (): Promise<any> => {
  (globalThis as any).$rt_putStdoutCustom ??= () => {};
  (globalThis as any).$rt_putStderrCustom ??= () => {};
  return import('../../../src/engine/vendor/openrocket-engine.mjs' as string);
};

const catalog = (
  JSON.parse(readFileSync(join(__dirname, '../../../public/data/components.generated.json'), 'utf8')) as {
    components: unknown[];
  }
).components.filter(isComponentRow) as Component[];

/** A few rows of a type, spread across the catalog rather than the first maker's. */
const sample = (type: string): Component[] => {
  const rows = catalog.filter((p) => p.type === type);
  return [0, 0.5, 0.999].map((at) => rows[Math.floor(at * (rows.length - 1))]!);
};

const node = (type: ComponentType, id: string, extra: Partial<ComponentNode> = {}, children: ComponentNode[] = []) =>
  ({ ...defaultNode(type), id, ...extra, children }) as ComponentNode;

/** The part inside something that may hold it, inside a stage. */
function design(probe: ComponentNode): unknown {
  const body = { outerRadius: 0.1, length: 1 } as Partial<ComponentNode>;
  const holders: Record<string, (p: ComponentNode) => ComponentNode[]> = {
    transition: (p) => [node('bodytube', 'tube', body), p],
    nosecone: (p) => [p],
    bodytube: (p) => [p],
    engineblock: (p) => [node('bodytube', 'tube', body, [node('innertube', 'mmt', { outerRadius: 0.05 }, [p])])],
  };
  const chain = (holders[probe.type] ?? ((p) => [node('bodytube', 'tube', body, [p])]))(probe);
  return { components: [node('stage' as ComponentType, 'st', {}, chain)] };
}

/** The length a row states, as the kernel should report it. */
const statedLength = (p: Component): number | null =>
  p.type === 'parachute' || p.type === 'streamer' ? null : p.length;

describe('catalogPatch through the kernel', () => {
  for (const type of ['transition', 'engineblock', 'launchlug', 'streamer', 'nosecone', 'bodytube', 'centeringring'])
    it(`builds ${type} rows at their stated size`, async () => {
      const engine = await loadEngine();
      for (const row of sample(type)) {
        const probe = { ...node(row.type as ComponentType, 'probe'), ...catalogPatch(row) } as ComponentNode;
        engine.reset();
        const handle = engine.buildRocket(JSON.stringify(design(probe)));
        const info = JSON.parse(engine.getComponentInfo(handle, 'probe'));
        expect(info.error, `${row.mfr} ${row.partNo}`).toBeUndefined();
        expect(info.mass, `${row.mfr} ${row.partNo}`).toBeGreaterThan(0);
        const length = statedLength(row);
        if (length != null) expect(info.length, `${row.mfr} ${row.partNo}`).toBeCloseTo(length, 6);
        // A streamer has no length of its own: its mass is the strip's area in its surface material.
        if (row.type === 'streamer')
          expect(info.mass, `${row.mfr} ${row.partNo}`).toBeCloseTo(
            row.stripLength * row.stripWidth * row.materialDensity,
            6,
          );
      }
    });
});
