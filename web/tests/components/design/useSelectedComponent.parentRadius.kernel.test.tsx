// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSelectedComponent } from '../../../src/components/design/useSelectedComponent';
import { useWorkspaceStore } from '../../../src/state/store';
import { kernelGeometry, loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import type { RocketTree } from '../../../src/engine/openRocketEngine';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A tube fin set's body radius, which the tube-collision check reads, is the
 * radius its body tube flies at. A tube with no stored radius flies at the
 * bridge's default, read here from the kernel through the bridge.
 */

const TREE = {
  name: 'R',
  components: [
    {
      id: 'st',
      type: 'stage',
      name: 'Sustainer',
      children: [
        { id: 'n', type: 'nosecone', shape: 'ogive', length: 0.07, aftRadius: 0.012, thickness: 0.001 },
        {
          id: 'tube',
          type: 'bodytube',
          length: 0.3,
          thickness: 0.0005,
          children: [{ id: 'tf', type: 'tubefinset', finCount: 6, length: 0.05, outerRadius: 0.005 }],
        },
      ],
    },
  ],
} as unknown as RocketTree;

describe('the selected tube fin set’s body radius', () => {
  it('is the radius the kernel flies its body tube at', async () => {
    const engine = await loadEngine();
    const kernel = kernelGeometry(engine, TREE).get('tube')!.outerRadius!;
    expect(kernel).toBeGreaterThan(0);
    useWorkspaceStore.setState({ tree: TREE, selectedId: 'tf' });
    const { result } = renderHook(() => useSelectedComponent());
    expect(result.current.parentRadius).toBeCloseTo(kernel, 9);
  });
});
