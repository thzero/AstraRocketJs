// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useGuardedSelection } from '../../../src/components/common/MasterDetail';
import { useConfirmStore } from '../../../src/state/confirmStore';

describe('useGuardedSelection', () => {
  it('moves freely while the editor is clean', async () => {
    const { result } = renderHook(() => useGuardedSelection('Discard?'));
    let moved = false;
    await act(async () => {
      moved = await result.current.select('a');
    });
    expect(moved).toBe(true);
    expect(result.current.selectedId).toBe('a');
    expect(useConfirmStore.getState().request).toBeNull();
  });

  it('asks before a move would throw away an edit, and stays when told to', async () => {
    const { result } = renderHook(() => useGuardedSelection('Discard?'));
    await act(async () => void (await result.current.select('a')));
    act(() => result.current.onDirtyChange(true));

    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.select('b');
    });
    expect(useConfirmStore.getState().request?.message).toBe('Discard?');
    await act(async () => {
      useConfirmStore.getState().settle(false);
      expect(await pending).toBe(false);
    });
    expect(result.current.selectedId).toBe('a');
  });

  it('moves after a confirmed discard, and the edit no longer counts', async () => {
    const { result } = renderHook(() => useGuardedSelection('Discard?'));
    await act(async () => void (await result.current.select('a')));
    act(() => result.current.onDirtyChange(true));

    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.select('b');
    });
    await act(async () => {
      useConfirmStore.getState().settle(true);
      await pending;
    });
    expect(result.current.selectedId).toBe('b');
    expect(result.current.dirty).toBe(false);
  });

  it('settles after a save without asking', () => {
    const { result } = renderHook(() => useGuardedSelection('Discard?'));
    act(() => result.current.onDirtyChange(true));
    act(() => result.current.settle('saved'));
    expect(result.current.selectedId).toBe('saved');
    expect(result.current.dirty).toBe(false);
    expect(useConfirmStore.getState().request).toBeNull();
  });
});
