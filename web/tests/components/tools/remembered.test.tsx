// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { defaultToolSite, rememberedSlot, useRemembered } from '../../../src/components/tools/remembered';

interface Form {
  mass: number | null;
  state: { kind: 'idle' } | { kind: 'loading' };
}

describe('useRemembered', () => {
  it('starts from the default, then from what the last mount left', () => {
    const slot = rememberedSlot<Form>();
    const first = renderHook(() => useRemembered(slot, 'mass', 0.5));
    expect(first.result.current[0]).toBe(0.5);
    act(() => first.result.current[1](2));
    first.unmount();
    const second = renderHook(() => useRemembered(slot, 'mass', 0.5));
    expect(second.result.current[0]).toBe(2);
  });

  it('keeps a cleared value cleared rather than restoring the default', () => {
    const slot = rememberedSlot<Form>();
    const first = renderHook(() => useRemembered(slot, 'mass', 0.5));
    act(() => first.result.current[1](null));
    first.unmount();
    expect(renderHook(() => useRemembered(slot, 'mass', 0.5)).result.current[0]).toBeNull();
  });

  it('passes a held value through restore', () => {
    const slot = rememberedSlot<Form>();
    slot.value.state = { kind: 'loading' };
    const { result } = renderHook(() =>
      useRemembered(slot, 'state', { kind: 'idle' }, (s): Form['state'] =>
        s.kind === 'loading' ? { kind: 'idle' } : s,
      ),
    );
    expect(result.current[0]).toEqual({ kind: 'idle' });
  });

  it('starts from the defaults again after forget', () => {
    const slot = rememberedSlot<Form>();
    slot.value.mass = 3;
    slot.forget();
    expect(renderHook(() => useRemembered(slot, 'mass', 0.5)).result.current[0]).toBe(0.5);
  });
});

describe('defaultToolSite', () => {
  it('takes the launch defaults coordinates and leaves the elevation to the terrain model', () => {
    expect(defaultToolSite({ latitudeDeg: 40, longitudeDeg: -105 })).toEqual({
      latitudeDeg: 40,
      longitudeDeg: -105,
      launchAltitudeM: null,
    });
  });
});
