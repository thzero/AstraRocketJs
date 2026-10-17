// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import i18n from '../../../src/i18n';
import { NO_VALUE } from '../../../src/i18n/noValue';
import { __setEngineForTests } from '../../../src/engine/openRocketEngine';
import { useEngineStore } from '../../../src/state/engineStore';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { renderWithProviders } from '../../testing/renderWithProviders';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/** 10 N for a second: enough to leave a 1 m rail with a 0.5 kg rocket. */
const MOTOR = vi.hoisted(() => ({
  designation: 'T10',
  times: [0, 1],
  thrusts: [10, 10],
  masses: [0.02, 0.02],
}));

// The tool keeps its inputs in a module slot; this one starts with a motor
// loaded, so the results block renders without driving the motor picker.
vi.mock('../../../src/components/tools/remembered', async (orig) => {
  const m = await orig<typeof import('../../../src/components/tools/remembered')>();
  return {
    ...m,
    rememberedSlot: <T,>() => {
      const slot = m.rememberedSlot<T>();
      slot.value = { motor: MOTOR } as unknown as Partial<T>;
      return slot;
    },
  };
});

import { OffTheRail } from '../../../src/components/tools/OffTheRail';

afterEach(() => {
  cleanup();
  __setEngineForTests(null);
});

/** The value beside a result label. */
const statValue = (label: string) => screen.getByText(label).nextElementSibling?.textContent ?? '';

/**
 * The average thrust to weight is the kernel's average thrust, unknown until
 * the engine has loaded. A tool opened before then shows a dash, and has to
 * show the kernel's figure once the engine is ready, with no input touched.
 */
describe('the off-the-rail average thrust to weight', () => {
  it('fills in when the engine becomes ready', async () => {
    const label = i18n.t('rail.twrAverage');
    __setEngineForTests(null);
    act(() => useEngineStore.setState({ phase: 'loading' }));
    renderWithProviders(<OffTheRail />);
    expect(statValue(label)).toContain(NO_VALUE);

    const engine = await loadEngine();
    __setEngineForTests(engine);
    act(() => useEngineStore.setState({ phase: 'ready' }));
    const shown = statValue(label);

    // What the tool prints when it is opened with the kernel already loaded.
    cleanup();
    renderWithProviders(<OffTheRail />);
    const fresh = statValue(label);
    expect(fresh).not.toContain(NO_VALUE);
    expect(shown).toBe(fresh);
  });
});
