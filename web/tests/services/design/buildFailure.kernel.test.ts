import { beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '../../../src/i18n';
import { __setEngineForTests, type RocketTree } from '../../../src/engine/openRocketEngine';
import { computeStaticInfo } from '../../../src/services/design/buildRocket';
import { syncDerived } from '../../../src/services/design/treeEdit';
import { newFlightConfig } from '../../../src/services/flight/flightConfigs';
import { buildFailureText, designBlockerText } from '../../../src/services/flight/runnability';
import { kernelGeometry, loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

beforeAll(async () => {
  __setEngineForTests(await import('../../../src/engine/vendor/openrocket-engine.mjs'));
});

/**
 * A fin set canted far enough that its root crosses the far side of its body:
 * a 100 mm root at 15 degrees on a 12 mm tube. The kernel computes its root
 * points as NaN (`FinSet.getRootPoints`), and the build fails on the NaN mass
 * that follows, a message that names no part. The Design tab says which fin set
 * it is, in the words the Run button uses.
 */
const overturned = (): RocketTree =>
  syncDerived({
    name: 'x',
    components: [
      {
        type: 'stage',
        id: 's',
        children: [
          { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.012, thickness: 0.002 },
          {
            type: 'bodytube',
            id: 'b',
            length: 0.4,
            outerRadius: 0.012,
            thickness: 0.0005,
            children: [
              {
                type: 'innertube',
                id: 'mm',
                length: 0.07,
                outerRadius: 0.009,
                thickness: 0.0005,
                motorMount: true,
                position: { method: 'bottom', offset: 0 },
              },
              {
                type: 'trapezoidfinset',
                id: 'fins',
                name: 'Canted fins',
                finCount: 3,
                rootChord: 0.1,
                tipChord: 0.03,
                height: 0.04,
                sweep: 0.02,
                thickness: 0.002,
                cant: (15 * Math.PI) / 180,
                position: { method: 'bottom', offset: 0 },
              },
            ],
          },
        ],
      },
    ],
  } as unknown as RocketTree);

describe('a design that does not build because of an overturned fin set', () => {
  it('names the fin set rather than the NaN mass', async () => {
    const tree = overturned();
    const engine = await loadEngine();
    const g = kernelGeometry(engine, tree).get('fins')!;
    const nan = [...(g.finPoints ?? []), ...(g.rootPoints ?? [])].some(([x, y]) => x === null || y === null);
    expect(nan).toBe(true);

    const res = computeStaticInfo(tree, newFlightConfig());
    expect('error' in res).toBe(true);
    if (!('error' in res)) return;
    expect(res.fins?.map((f) => f.id)).toEqual(['fins']);

    const t = i18n.t.bind(i18n);
    const text = buildFailureText(res, t);
    expect(text).toBe(designBlockerText({ kind: 'finCant', fins: res.fins! }, t));
    expect(text).toContain('Canted fins');
  });
});
