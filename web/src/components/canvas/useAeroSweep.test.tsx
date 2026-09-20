// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { AeroSweep } from '../../engine/openRocketEngine';
import { useAeroSweep } from './useAeroSweep';

/**
 * The deferred sweep's contract with the pane: `pending` is true from the
 * render that changes an input until the run for THOSE inputs lands, the
 * previous sweep stays up meanwhile, a run whose inputs changed before it
 * started never lands, and no rocket means nothing is pending and nothing is
 * shown. `pending` used to be a flag set at the top of the effect; now it is
 * derived, and these pin that the derivation says the same things.
 */

const fakeSweep = (machMax: number) => ({ machs: [0.05, machMax] }) as unknown as AeroSweep;
const rocketFor = (calls: number[]) => ({
  aeroSweep: (o?: { machMax?: number }) => {
    calls.push(o?.machMax ?? NaN);
    return fakeSweep(o?.machMax ?? NaN);
  },
});
const inputs = (machMax: number) => ({ machMax, aoaDeg: 0, thetaDeg: 0, rollRate: 0 });

afterEach(() => vi.useRealTimers());

describe('useAeroSweep', () => {
  it('is pending until the deferred run lands, then reports its sweep', async () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const rocket = rocketFor(calls);
    const { result } = renderHook(() => useAeroSweep(rocket, inputs(1)));
    expect(result.current).toEqual({ sweep: null, pending: true });
    expect(calls).toEqual([]); // nothing runs during render
    await act(() => vi.runAllTimersAsync());
    expect(calls).toEqual([1]);
    expect(result.current.pending).toBe(false);
    expect(result.current.sweep?.machs).toEqual([0.05, 1]);
  });

  it('keeps the previous sweep up while the next input runs', async () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const rocket = rocketFor(calls);
    const { result, rerender } = renderHook(({ machMax }) => useAeroSweep(rocket, inputs(machMax)), {
      initialProps: { machMax: 1 },
    });
    await act(() => vi.runAllTimersAsync());
    rerender({ machMax: 2 });
    expect(result.current.pending).toBe(true);
    expect(result.current.sweep?.machs).toEqual([0.05, 1]);
    await act(() => vi.runAllTimersAsync());
    expect(result.current.pending).toBe(false);
    expect(result.current.sweep?.machs).toEqual([0.05, 2]);
  });

  it('skips a run whose inputs changed before it started', async () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const rocket = rocketFor(calls);
    const { result, rerender } = renderHook(({ machMax }) => useAeroSweep(rocket, inputs(machMax)), {
      initialProps: { machMax: 1 },
    });
    rerender({ machMax: 3 });
    await act(() => vi.runAllTimersAsync());
    expect(calls).toEqual([3]);
    expect(result.current.sweep?.machs).toEqual([0.05, 3]);
  });

  it('shows nothing and is not pending without a rocket', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAeroSweep(null, inputs(1)));
    expect(result.current).toEqual({ sweep: null, pending: false });
    await act(() => vi.runAllTimersAsync());
    expect(result.current).toEqual({ sweep: null, pending: false });
  });

  it('reports null (not a stale sweep) when the kernel throws', async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rocket = {
      aeroSweep: () => {
        throw new Error('boom');
      },
    };
    const { result } = renderHook(() => useAeroSweep(rocket, inputs(1)));
    await act(() => vi.runAllTimersAsync());
    expect(result.current).toEqual({ sweep: null, pending: false });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
