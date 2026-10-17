// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { MotorCombinePane } from '../../../src/components/sim/MotorCombinePane';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { __setEngineForTests } from '../../../src/engine/openRocketEngine';
import { useEngineStore } from '../../../src/state/engineStore';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import type { CatalogMotor } from '../../../src/services/motors/motorDb';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * The cluster's burn time and average thrust are the kernel's, by the rule a
 * single motor's are (`ThrustCurveMotor.computeStatistics`: between the
 * crossings of 5% of peak). Two identical motors sum to the same curve at twice
 * the thrust, so the expected figures come from the bridge on that curve.
 */

const TIMES = [0, 0.1, 0.5, 1.5, 1.6, 2.5];
const THRUST = [0, 20, 10, 8, 0.5, 0];

const motor = (designation: string) =>
  ({
    designation,
    manufacturer: 'M',
    curves: [{ samples: TIMES.map((t, i) => [t, THRUST[i]!]) }],
  }) as unknown as CatalogMotor;

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
let engine: any;
const initial = useEngineStore.getState();

beforeAll(async () => {
  engine = await loadEngine();
  __setEngineForTests(engine);
});
afterAll(() => {
  __setEngineForTests(null);
  useEngineStore.setState(initial);
});

/** The number in the value cell under a spec label. */
const figure = (label: string) =>
  Number(/[\d.]+/.exec(screen.getByText(label).nextElementSibling?.textContent ?? '')?.[0]);

describe('the Combine pane', () => {
  it('states burn time and average thrust as the kernel does for the summed curve', () => {
    act(() => useEngineStore.setState({ phase: 'ready' }));
    const kernel = JSON.parse(
      engine.getMotorStatistics(
        TIMES,
        THRUST.map((f) => 2 * f),
      ),
    ) as {
      burnTime: number;
      averageThrust: number;
    };
    renderWithProviders(<MotorCombinePane motors={[motor('A'), motor('B')]} />);
    expect(figure('Burn time')).toBeCloseTo(kernel.burnTime, 2);
    expect(figure('Avg. thrust')).toBeCloseTo(kernel.averageThrust, 1);
  });

  it('shows a dash for both until the engine is ready', () => {
    act(() => useEngineStore.setState({ phase: 'loading' }));
    renderWithProviders(<MotorCombinePane motors={[motor('C'), motor('D')]} />);
    expect(screen.getByText('Burn time').nextElementSibling?.textContent).toBe('–');
    expect(screen.getByText('Avg. thrust').nextElementSibling?.textContent).toBe('–');
  });
});
