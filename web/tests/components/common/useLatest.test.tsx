// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLatest } from '../../../src/components/common/useLatest';

/**
 * The generation guard for callbacks that land after an await.
 *
 * `LaunchPanel`'s geolocation callbacks, `WindProfileDialog.importCsv`,
 * `MotorDialog`'s import, delete and pick, and `useExportTemplates.onImport` each
 * await a file read, a permission prompt or an IndexedDB round trip and then call
 * an `onChange` that writes to whatever rows are the current edit targets. A
 * geolocation prompt can sit unanswered for minutes.
 */
describe('useLatest', () => {
  it('reports a fresh claim as current', () => {
    const { result } = renderHook(() => useLatest());
    const mine = result.current.claim();
    expect(mine()).toBe(true);
  });

  it('supersedes an earlier claim, so a second click wins', () => {
    const { result } = renderHook(() => useLatest());
    const first = result.current.claim();
    const second = result.current.claim();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('makes every outstanding claim stale on unmount', () => {
    // The case this covers: the dialog is gone and the result still arrives.
    const { result, unmount } = renderHook(() => useLatest());
    const mine = result.current.claim();
    expect(mine()).toBe(true);
    unmount();
    expect(mine()).toBe(false);
  });

  it('observes without superseding, for the caller that must not cancel a sibling', () => {
    const { result } = renderHook(() => useLatest());
    const inFlight = result.current.claim();
    const watcher = result.current.observe();
    // Taking the observation did not invalidate the claim already out.
    expect(inFlight()).toBe(true);
    expect(watcher()).toBe(true);
  });

  it('makes an observation stale on unmount too', () => {
    const { result, unmount } = renderHook(() => useLatest());
    const watcher = result.current.observe();
    unmount();
    expect(watcher()).toBe(false);
  });

  it('keeps the same claim function across re-renders', () => {
    // It goes into callbacks that live in props; a new identity per render would
    // defeat every memo those sit behind.
    const { result, rerender } = renderHook(() => useLatest());
    const before = result.current.claim;
    rerender();
    expect(result.current.claim).toBe(before);
  });

  it('aborts the previous request when a new signal is claimed', () => {
    const { result } = renderHook(() => useLatest());
    const first = result.current.claimSignal();
    const second = result.current.claimSignal();
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
  });

  it('aborts the outstanding request on unmount', () => {
    // A forecast fetch started by a tab that has since closed is canceled.
    const { result, unmount } = renderHook(() => useLatest());
    const signal = result.current.claimSignal();
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
