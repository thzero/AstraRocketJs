// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup } from '@testing-library/react';

/**
 * The workspace effects: hydration gate, debounced autosave, unload journal,
 * engine rebuild and result invalidation.
 *
 * Five audit findings lived in this file and none of them were reachable from
 * `store.test.ts`, because every one is about the ORDER and the GUARDS around
 * the async edges — not about what the store actions do. So this drives the
 * real hook with the edges stubbed: a workspace store whose load can be made
 * to reject or to resolve late, and a `computeStaticInfo` that just counts.
 */

const load = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());
const saveSync = vi.hoisted(() => vi.fn());
vi.mock('../services/workspaceStore', () => ({
  getWorkspaceStore: () => ({ load, save, saveSync }),
}));

const computeStaticInfo = vi.hoisted(() => vi.fn());
vi.mock('../services/buildRocket', async (orig) => ({
  ...(await orig<typeof import('../services/buildRocket')>()),
  computeStaticInfo,
}));

vi.mock('../engine/simClient', () => ({ warmSimWorker: vi.fn() }));
vi.mock('../services/persistStorage', () => ({ requestPersistentStorage: vi.fn(() => Promise.resolve(true)) }));

const degraded = vi.hoisted(() => ({ fire: null as null | (() => void) }));
vi.mock('../services/idbKeyValueStore', async (orig) => ({
  ...(await orig<typeof import('../services/idbKeyValueStore')>()),
  onStorageDegraded: (cb: () => void) => {
    degraded.fire = cb;
    return () => {
      degraded.fire = null;
    };
  },
}));

import { useWorkspaceEffects } from './useWorkspaceEffects';
import { useWorkspaceStore } from './store';
import { renderWithProviders } from '../testing/renderWithProviders';
import i18n from '../i18n';

function Host() {
  useWorkspaceEffects();
  return null;
}

const s = () => useWorkspaceStore.getState();
/** A saved workspace distinguishable from the default design. */
const saved = () => ({
  version: 1 as const,
  tree: { ...s().tree, name: 'Restored' },
  sims: s().sims,
  activeId: s().activeId,
  extraMotors: {},
  loadedMeta: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  s().resetWorkspace();
  load.mockReset().mockResolvedValue(null);
  save.mockReset().mockResolvedValue(undefined);
  saveSync.mockReset();
  computeStaticInfo.mockReset().mockReturnValue({ info: { length: 1 }, rocket: {} });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Render and let the load promise settle. */
const mount = async (ui = <Host />) => {
  const r = renderWithProviders(ui);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return r;
};

describe('hydration', () => {
  it('hydrates the saved workspace and then builds once', async () => {
    load.mockResolvedValue(saved());
    await mount();
    expect(s().tree.name).toBe('Restored');
    expect(computeStaticInfo).toHaveBeenCalledTimes(1);
    // And it built the RESTORED design, not the default it was mounted with.
    expect((computeStaticInfo.mock.calls[0]![0] as { name: string }).name).toBe('Restored');
  });

  /**
   * StrictMode runs the effect twice and cancels the first. `hydrated` and
   * `setReady(true)` used to run OUTSIDE the `if (live)` guard, so the
   * cancelled first load flipped the gate while the tree was still the default
   * — the rebuild effect then built the default rocket and ran a full drag
   * sweep, and the real load built it all again. Two full engine builds on
   * every page load, which is the exact thing the gate exists to stop.
   */
  it('does not open the gate from a cancelled load', async () => {
    // Re-run the load effect (it depends on `t`) so the first load is cancelled
    // while still in flight, then let that cancelled one resolve. This is the
    // shape StrictMode produces on every real mount, and the shape a language
    // switch produces at any time.
    let settleFirst!: (v: unknown) => void;
    load.mockReturnValueOnce(new Promise((r) => (settleFirst = r))).mockReturnValueOnce(new Promise(() => {}));

    renderWithProviders(<Host />);
    await act(async () => {
      await i18n.changeLanguage('es');
    });
    expect(load).toHaveBeenCalledTimes(2);

    await act(async () => {
      settleFirst(saved());
      await Promise.resolve();
    });

    // The second load is still in flight, so the tree is still the default.
    // Opening the gate here builds it — and then the real load builds again:
    // two full engine builds plus two drag sweeps on every page load.
    expect(computeStaticInfo).not.toHaveBeenCalled();
    expect(s().tree.name).not.toBe('Restored');
  });

  /**
   * A rejected load used to leave `hydrated` and `ready` false forever: no
   * autosave, no unload flush, no engine rebuild, `info` null — the app sitting
   * there with no stats and no stability badge, saving nothing, and nothing on
   * screen to say why.
   */
  it('degrades to a working workspace when the load rejects, and says so', async () => {
    load.mockRejectedValue(new Error('idb blocked'));
    await mount();

    // In the warning slot, NOT `setErr`: opening the gate runs the rebuild
    // effect, and its success path calls `setErr(null)` — a message written
    // there is wiped in the same tick and the user never sees it.
    expect(s().storageWarning).toBeTruthy();
    expect(computeStaticInfo).toHaveBeenCalledTimes(1); // the engine still built

    // ...and autosave still runs, so work done after the failure is not lost too.
    act(() => s().addPartToTree('bodytube'));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalled();
  });
});

describe('autosave', () => {
  it('debounces to one write per 500 ms of quiet', async () => {
    await mount();
    save.mockClear();

    act(() => s().addPartToTree('bodytube'));
    act(() => vi.advanceTimersByTime(400));
    act(() => s().addPartToTree('bodytube'));
    expect(save).not.toHaveBeenCalled(); // the second edit restarted the clock

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does not save before hydration has finished', async () => {
    let settle!: (v: unknown) => void;
    load.mockReturnValue(new Promise((r) => (settle = r)));
    renderWithProviders(<Host />);

    act(() => s().addPartToTree('bodytube'));
    act(() => vi.advanceTimersByTime(1000));
    // Saving now would write the DEFAULT design over the one still being read.
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      settle(null);
      await Promise.resolve();
    });
  });

  it('raises a storage warning when the write fails, and clears it when one succeeds', async () => {
    await mount();

    save.mockRejectedValueOnce(new Error('QuotaExceeded'));
    act(() => s().addPartToTree('bodytube'));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(s().storageWarning).toBeTruthy();

    act(() => s().addPartToTree('bodytube'));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(s().storageWarning).toBeNull();
  });

  it('warns when IndexedDB is unavailable at all', async () => {
    await mount();
    act(() => degraded.fire!());
    expect(s().storageWarning).toBeTruthy();
  });
});

describe('the unload journal', () => {
  it('flushes synchronously on pagehide', async () => {
    await mount();
    act(() => window.dispatchEvent(new Event('pagehide')));
    // Synchronous path: an async IndexedDB write cannot finish during teardown.
    expect(saveSync).toHaveBeenCalledTimes(1);
  });

  it('does not journal a workspace it never hydrated', () => {
    load.mockReturnValue(new Promise(() => {})); // never settles
    renderWithProviders(<Host />);
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(saveSync).not.toHaveBeenCalled();
  });

  it('stops listening once unmounted', async () => {
    const { unmount } = await mount();
    unmount();
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(saveSync).not.toHaveBeenCalled();
  });
});

describe('what triggers a rebuild', () => {
  /**
   * The rebuild used to key on `tree`, which every store action replaces. So
   * typing a designer name ran a full engine build plus an aero sweep, and the
   * result invalidation — keyed the same way — threw away every simulation
   * result the user had.
   */
  it('editing the design metadata neither rebuilds nor invalidates', async () => {
    await mount();
    computeStaticInfo.mockClear();
    const invalidate = vi.spyOn(useWorkspaceStore.getState(), 'invalidateResults');

    act(() => s().updateDesignMeta({ designer: 'Ada Lovelace' }));

    expect(computeStaticInfo).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    invalidate.mockRestore();
  });

  it('renaming a part rebuilds — the engine labels its rows with the name', async () => {
    await mount();
    computeStaticInfo.mockClear();

    act(() => {
      s().setSelectedId(s().tree.components[0]!.id as string);
      s().patchSelected({ name: 'Ogive' });
    });

    expect(computeStaticInfo).toHaveBeenCalledTimes(1);
  });

  it('changing a dimension rebuilds and invalidates the results', async () => {
    await mount();
    computeStaticInfo.mockClear();

    act(() => {
      s().setSelectedId(s().tree.components[0]!.id as string);
      s().patchSelected({ length: 0.2 });
    });

    expect(computeStaticInfo).toHaveBeenCalledTimes(1);
    expect(s().sims.every((x) => !x.result)).toBe(true);
  });

  it('surfaces a build failure instead of leaving stale stats on screen', async () => {
    await mount();
    computeStaticInfo.mockReturnValue({ error: 'fin tab longer than the root chord' });

    act(() => {
      s().setSelectedId(s().tree.components[0]!.id as string);
      s().patchSelected({ length: 0.3 });
    });

    expect(s().info).toBeNull();
    expect(s().err).toBe('fin tab longer than the root chord');
  });
});
