// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { PropertyPanel } from '../../../src/components/design/PropertyPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { kernelGeometry, loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

type Pt = [number, number];

/**
 * The freeform editor in the property panel works on the outline the kernel
 * flies. `FreeformFinSet.setPoints` moves the first point to the origin and
 * snaps a coordinate past 2.5 m, so a stored list that does neither is not the
 * fin that flies. The expected outline is the kernel's `getFinPoints`, through
 * the bridge.
 */

const CASES: [string, Pt[]][] = [
  [
    'a first point off the origin in both axes',
    [
      [0.02, 0.01],
      [0.04, 0.06],
      [0.08, 0.06],
      [0.1, 0.01],
    ],
  ],
  [
    'a first point forward of the origin',
    [
      [-0.015, 0],
      [0.01, 0.04],
      [0.05, 0.03],
      [0.06, 0],
    ],
  ],
  [
    'points past the 2.5 m snap',
    [
      [0, 0],
      [0.5, 3],
      [2.8, 0.2],
      [3.0, 0],
    ],
  ],
  [
    'an outline the kernel already flies as stored',
    [
      [0, 0],
      [0.02, 0.05],
      [0.05, 0.05],
      [0.06, 0],
    ],
  ],
];

const treeOf = (points: Pt[]): RocketTree =>
  ({
    name: 'R',
    components: [
      {
        id: 'st',
        type: 'stage',
        children: [
          { id: 'n', type: 'nosecone', length: 0.1, aftRadius: 0.02, thickness: 0.002 },
          {
            id: 'b',
            type: 'bodytube',
            length: 0.3,
            outerRadius: 0.02,
            thickness: 0.001,
            children: [{ id: 'f', type: 'freeformfinset', finCount: 3, thickness: 0.003, points }],
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

describe('the freeform outline editor', () => {
  it.each(CASES)('edits the kernel outline for %s', async (_label, points) => {
    const engine = await loadEngine();
    const flown = kernelGeometry(engine, treeOf(points)).get('f')!.finPoints as Pt[];
    expect(flown).toHaveLength(points.length);

    const onChange = vi.fn();
    const node = { id: 'f', type: 'freeformfinset', finCount: 3, thickness: 0.003, points } as unknown as ComponentNode;
    renderWithProviders(<PropertyPanel node={node} onChange={onChange} onCommit={() => {}} onRemove={() => {}} />);
    // One edit on the second vertex; the editor hands back the whole outline it
    // holds, which is the one it drew.
    fireEvent.keyDown(screen.getByLabelText('Outline point 2'), { key: 'ArrowUp' });
    const edited = (onChange.mock.calls.at(-1)![0] as { points: Pt[] }).points;
    expect(edited).toHaveLength(flown.length);
    edited.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(flown[i]![0], 9);
      // The nudged vertex moves up; every other one is the kernel's.
      if (i === 1) expect(y).toBeGreaterThan(flown[i]![1]);
      else expect(y).toBeCloseTo(flown[i]![1], 9);
    });
  });
});
