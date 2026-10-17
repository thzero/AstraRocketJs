// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { useWorkspaceStore } from '../../../src/state/store';
import { SimSummary } from '../../../src/components/sim/SimSummary';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { FlightResult } from '../../../src/engine/openRocketEngine';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * The deploy-speed tile shows the speed of the last deployment, the kernel's
 * deployment velocity. A chute opened earlier on the same branch, fast enough
 * for the kernel to warn, does not mark that tile.
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
            { id: 'early', type: 'parachute', name: 'Early', diameter: 0.6, cd: 0.8, deployEvent: 'ejection' },
            {
              id: 'late',
              type: 'parachute',
              name: 'Late',
              diameter: 0.4,
              cd: 0.8,
              deployEvent: 'altitude',
              deployAltitude: 40,
            },
          ],
        },
      ],
    },
  ],
};

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
const fly = (engine: any, warn: number): FlightResult => {
  engine.reset();
  const h = engine.buildRocket(JSON.stringify(TREE));
  engine.setMotorById(h, 'm', 'C6', 0.018, 0.07, [0, 0.2, 1.8], [0, 14, 0], [0.024, 0.022, 0.012], 0.035, 1);
  return JSON.parse(
    engine.simulateJson(h, JSON.stringify({ launchRodLength: 1, randomSeed: 7, recoverySpeedWarn: warn })),
  ) as FlightResult;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('SimSummary deploy speed with two deployments', () => {
  const before = useWorkspaceStore.getState();
  afterEach(() =>
    act(() => useWorkspaceStore.setState({ sims: before.sims, activeId: before.activeId, tree: before.tree })),
  );
  const subOf = (label: RegExp) => screen.getByText(label).nextElementSibling?.nextElementSibling?.textContent;

  it('takes no verdict from the earlier chute the kernel warned for', async () => {
    const engine = await loadEngine();
    const late = fly(engine, 0.01).summary.deploymentVelocity!;
    const warn = late + 1;
    const flown = fly(engine, warn);
    // The kernel warned, for the early chute only.
    const fast = flown.warnings!.filter((w) => w.key === 'HighSpeedDeployment');
    expect(fast.map((w) => w.sourceIds)).toEqual([['early']]);
    act(() =>
      useWorkspaceStore.setState({
        tree: TREE as never,
        sims: [{ id: 'x', name: 'X', configId: 'c', launch: {}, result: flown, prefs: { deploymentSpeedWarn: warn } }],
        activeId: 'x',
        resultSimId: null,
      } as never),
    );
    renderWithProviders(<SimSummary sim={flown} />);
    expect(subOf(/^Deploy speed$/)).not.toContain('Too fast');
  });

  it('still marks the tile when the last chute is the one the kernel warned for', async () => {
    const engine = await loadEngine();
    const flown = fly(engine, 0.01);
    act(() =>
      useWorkspaceStore.setState({
        tree: TREE as never,
        sims: [{ id: 'x', name: 'X', configId: 'c', launch: {}, result: flown, prefs: { deploymentSpeedWarn: 0.01 } }],
        activeId: 'x',
        resultSimId: null,
      } as never),
    );
    renderWithProviders(<SimSummary sim={flown} />);
    expect(subOf(/^Deploy speed$/)).toContain('Too fast');
  });
});
