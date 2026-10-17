// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMotorFilter } from '../../../src/components/sim/MotorFilterBar';
import { MAX_IDX, STD_DIAMS, fitIdx } from '../../../src/services/motors/motorPicker';

/**
 * Opening the picker on a mount caps the displayed diameter range to what the
 * mount takes. The range it remembers is the user's own, at both ends, so the
 * next mount opens on what the user chose and not on the last mount's cap.
 */
describe('the remembered diameter range', () => {
  /** Every saved range against every mount size, mm. */
  const ranges: [number, number][] = [];
  for (let lo = 0; lo <= MAX_IDX; lo++) for (let hi = lo; hi <= MAX_IDX; hi++) ranges.push([lo, hi]);

  it('is the saved range on opening, whatever the mount caps the slider to', () => {
    for (const bore of STD_DIAMS) {
      const cap = fitIdx(bore);
      for (const saved of ranges) {
        const { result, unmount } = renderHook(() => useMotorFilter([], { dia: saved, mount: { bore } }));
        // The slider shows the cap...
        expect(result.current.dia).toEqual([Math.min(saved[0], cap), Math.min(saved[1], cap)]);
        // ...and the preference stays the user's.
        expect(result.current.diaSaved, `${bore} mm, saved ${saved.join('-')}`).toEqual(saved);
        unmount();
      }
    }
  });

  it('gives the saved floor back when the fit box is cleared', () => {
    const saved: [number, number] = [6, 8];
    const { result } = renderHook(() => useMotorFilter([], { dia: saved, mount: { bore: 24 } }));
    expect(result.current.dia[0]).toBeLessThan(saved[0]);
    act(() => result.current.setFits(false));
    expect(result.current.dia).toEqual(saved);
    expect(result.current.diaSaved).toEqual(saved);
  });

  it('remembers a drag at both ends', () => {
    const { result } = renderHook(() => useMotorFilter([], { dia: [0, MAX_IDX], mount: { bore: 24 } }));
    act(() => result.current.setDia([1, 2]));
    expect(result.current.diaSaved).toEqual([1, 2]);
  });
});
