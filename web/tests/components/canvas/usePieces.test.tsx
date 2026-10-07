// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { BufferGeometry } from 'three';
import type { RocketTree } from '../../../src/engine/openRocketEngine';
import { DEFAULT_PART_COLORS } from '../../../src/services/design/partColors';
import { usePieces } from '../../../src/components/canvas/usePieces';
import '../../testing/renderWithProviders';

const tree = (length: number) =>
  ({
    components: [
      {
        id: 'stage',
        type: 'stage',
        children: [{ id: 'body', type: 'bodytube', length, outerRadius: 0.02 }],
      },
    ],
  }) as unknown as RocketTree;

describe('usePieces', () => {
  it('disposes the replaced geometry on a rebuild and the rest on unmount', () => {
    const dispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
    const { result, rerender, unmount } = renderHook(({ t }) => usePieces(t, undefined, DEFAULT_PART_COLORS), {
      initialProps: { t: tree(0.3) },
    });
    const first = result.current.pieces.length;
    expect(first).toBeGreaterThan(0);
    rerender({ t: tree(0.4) });
    expect(dispose).toHaveBeenCalledTimes(first);
    unmount();
    expect(dispose).toHaveBeenCalledTimes(first + result.current.pieces.length);
    dispose.mockRestore();
  });
});
