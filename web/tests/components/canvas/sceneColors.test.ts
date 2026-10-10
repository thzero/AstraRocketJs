// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { SCENE_TOKENS, useSceneColors } from '../../../src/components/canvas/sceneColors';

/** The 3D views read their colors from the tokens, and follow a theme change. */
describe('useSceneColors', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-theme');
  });

  it('reads every scene token from the root element', () => {
    document.documentElement.style.setProperty('--c-scene-cg', '#2b6cff');
    const { result } = renderHook(() => useSceneColors());
    expect(result.current['scene-cg']).toBe('#2b6cff');
    expect(Object.keys(result.current).sort()).toEqual([...SCENE_TOKENS].sort());
  });

  it('gives the same object while nothing changes, so a memo on it holds', () => {
    const { result, rerender } = renderHook(() => useSceneColors());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('does not resolve styles again on a render where nothing changed', () => {
    const { rerender } = renderHook(() => useSceneColors());
    const spy = vi.spyOn(window, 'getComputedStyle');
    for (let i = 0; i < 10; i++) rerender();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('picks up a theme change on the root element', async () => {
    document.documentElement.style.setProperty('--c-scene-floor', '#0b1724');
    const { result } = renderHook(() => useSceneColors());
    expect(result.current['scene-floor']).toBe('#0b1724');
    await act(async () => {
      document.documentElement.style.setProperty('--c-scene-floor', '#e8eef4');
      document.documentElement.setAttribute('data-theme', 'light');
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current['scene-floor']).toBe('#e8eef4');
  });
});
