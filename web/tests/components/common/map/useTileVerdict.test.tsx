// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTileVerdict } from '../../../../src/components/common/map/useTileVerdict';
import { TILE_FAILURES_OFFLINE } from '../../../../src/components/common/map/mapStyle';
import type { TileSourceId } from '../../../../src/services/map/slippyMap';

const fail = (h: { current: ReturnType<typeof useTileVerdict> }, n = TILE_FAILURES_OFFLINE) => {
  for (let i = 0; i < n; i++) act(() => h.current.onTileError());
};

describe('useTileVerdict', () => {
  it('reads unknown until a tile answers', () => {
    const { result } = renderHook(() => useTileVerdict('satellite'));
    expect(result.current.imagery).toBe('unknown');
  });

  it('calls the imagery unavailable after a screenful of failures with nothing loaded', () => {
    const { result } = renderHook(() => useTileVerdict('satellite'));
    fail(result, TILE_FAILURES_OFFLINE - 1);
    expect(result.current.imagery).toBe('unknown');
    fail(result, 1);
    expect(result.current.imagery).toBe('unavailable');
  });

  it('treats failures after a load as holes in the coverage, not an outage', () => {
    const { result } = renderHook(() => useTileVerdict('satellite'));
    act(() => result.current.onTileLoad());
    fail(result, TILE_FAILURES_OFFLINE * 2);
    expect(result.current.imagery).toBe('ok');
  });

  it('does not re-render for every tile that loads', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useTileVerdict('satellite');
    });
    act(() => result.current.onTileLoad());
    const after = renders;
    for (let i = 0; i < 10; i++) act(() => result.current.onTileLoad());
    // React may render once more before it bails out on an unchanged state;
    // what matters is that ten tiles are not ten renders.
    expect(renders - after).toBeLessThanOrEqual(1);
  });

  it('makes pressing the layer again a retry', () => {
    const { result } = renderHook(() => useTileVerdict('satellite'));
    fail(result);
    act(() => result.current.retry());
    expect(result.current.imagery).toBe('unknown');
    // The count started over too: one more failure is not an outage.
    fail(result, 1);
    expect(result.current.imagery).toBe('unknown');
  });

  it('reads a different source as not asked yet', () => {
    const { result, rerender } = renderHook(({ src }: { src: TileSourceId | null }) => useTileVerdict(src), {
      initialProps: { src: 'satellite' },
    });
    fail(result);
    rerender({ src: 'street' });
    expect(result.current.imagery).toBe('unknown');
    rerender({ src: null });
    expect(result.current.imagery).toBe('unknown');
  });
});
