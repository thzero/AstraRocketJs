// @vitest-environment jsdom
import { afterAll, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { MotorDetail } from '../../../src/components/sim/MotorDetail';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { __setEngineForTests } from '../../../src/engine/openRocketEngine';
import { useEngineStore } from '../../../src/state/engineStore';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import type { CatalogMotor } from '../../../src/services/motors/motorDb';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * "Hide very similar thrust curves" filters the curve list once the engine
 * arrives, when the picker opened before it. Which curve is a near duplicate is
 * the kernel's MotorCorrelation through the bridge, against desktop's 0.95.
 */

const curve = (src: string, pts: [number, number][]) => ({ src, samples: pts });
const SHOWN: [number, number][] = [
  [0, 0],
  [0.1, 10],
  [0.8, 0],
];
const NEAR: [number, number][] = [
  [0, 0],
  [0.1, 10.2],
  [0.8, 0],
];
const FAR: [number, number][] = [
  [0, 0],
  [0.5, 20],
  [0.8, 0],
];
const motor = {
  designation: 'C6',
  manufacturer: 'Estes',
  class: 'C',
  diameter: 18,
  impulse: 9,
  burn: 1.8,
  mass: 24,
  curves: [curve('Certified · RASP', SHOWN), curve('near', NEAR), curve('far', FAR)],
} as CatalogMotor;

const options = () => [...(screen.getByRole('combobox') as HTMLSelectElement).options].map((o) => o.textContent);
const initial = useEngineStore.getState();

afterAll(() => {
  __setEngineForTests(null);
  useEngineStore.setState(initial);
});

describe('the curve choice, with the engine arriving after the picker opened', () => {
  it('hides the kernel’s near duplicates once the engine is ready', async () => {
    const engine = await loadEngine();
    const score = (pts: [number, number][]) =>
      engine.getMotorSimilarity(
        SHOWN.map((p) => p[0]),
        SHOWN.map((p) => p[1]),
        pts.map((p) => p[0]),
        pts.map((p) => p[1]),
      ) as number;
    expect(score(NEAR)).toBeGreaterThanOrEqual(0.95);
    expect(score(FAR)).toBeLessThan(0.95);

    localStorage.clear();
    __setEngineForTests(null);
    act(() => useEngineStore.setState({ phase: 'loading' }));
    renderWithProviders(<MotorDetail motor={motor} curveIndex={0} onCurveChange={vi.fn()} />);
    expect(options()).toEqual(['Certified · RASP (3)', 'near (3)', 'far (3)']);

    __setEngineForTests(engine);
    act(() => useEngineStore.setState({ phase: 'ready' }));
    expect(options()).toEqual(['Certified · RASP (3)', 'far (3)']);
  });
});
