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
   * A language switch must not touch the workspace.
   *
   * The load effect used to depend on `t`, whose identity changes on
   * `i18n.changeLanguage`, so switching language re-ran `load()` and re-hydrated
   * — and `hydrate` runs `sanitizeSims`, which nulls every sim result. Changing
   * the language silently threw away every flight the user had run. It could
   * also re-hydrate the persisted design over a freshly imported .ork, because
   * `openOrkFile` clears only the in-memory activeId.
   *
   * An earlier version of this test USED that re-run as a convenient way to
   * cancel the first load, and asserted `load` was called twice — documenting
   * the bug as intended behavior.
   */
  it('does not reload or re-hydrate when the language changes', async () => {
    load.mockResolvedValue(saved());
    await mount();
    expect(load).toHaveBeenCalledTimes(1);

    // Give the user a flight result to lose.
    act(() => useWorkspaceStore.setState({ sims: s().sims.map((x) => ({ ...x, result: { fake: true } })) } as never));

    await act(async () => {
      await i18n.changeLanguage('es');
    });

    expect(load).toHaveBeenCalledTimes(1); // no second read
    expect(s().sims.every((x) => x.result)).toBe(true); // and the flights survive
    await act(async () => void (await i18n.changeLanguage('en')));
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
    expect(s().storageWarningKind).toBe('loadFailed');
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

  it('raises a storage warning when the write fails, and a later save retires it', async () => {
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
    // "Full" is transient: the write that just succeeded disproves it.
    expect(s().storageWarning).toBeNull();
  });

  /**
   * ...but only that one. `markDegraded()` is one-way and never notifies twice
   * (idbKeyValueStore.ts:56), so clearing its message on the next successful
   * write retired it for the whole session — one keystroke after it appeared.
   * The user then met the 5 MB cap with nothing on screen to explain it, which
   * is the exact outcome the warning exists to prevent.
   */
  it.each([
    ['degraded', () => degraded.fire!()],
    ['loadFailed', null],
  ] as const)('a successful save does not retire the %s warning', async (_kind, raise) => {
    if (!raise) load.mockRejectedValue(new Error('idb blocked'));
    await mount();
    if (raise) act(() => raise());

    const standing = s().storageWarning;
    expect(standing).toBeTruthy();

    act(() => s().addPartToTree('bodytube'));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalled(); // the save really did succeed
    expect(s().storageWarning).toBe(standing); // and the warning still stands
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
    const markOutdated = vi.spyOn(useWorkspaceStore.getState(), 'markOutdated');

    act(() => s().updateDesignMeta({ designer: 'Ada Lovelace' }));

    expect(computeStaticInfo).not.toHaveBeenCalled();
    expect(markOutdated).not.toHaveBeenCalled();
    markOutdated.mockRestore();
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

  it('changing a dimension rebuilds and ages the results without destroying them', async () => {
    await mount();
    computeStaticInfo.mockClear();
    // Seed a result, so this asserts the KEEP as well as the flag. Without one
    // the old `every(x => !x.result)` passed vacuously — no sim had ever run.
    act(() => {
      useWorkspaceStore.setState((st) => ({
        sims: st.sims.map((x) => ({ ...x, result: { summary: { maxAltitude: 271 } } as never })),
      }));
    });

    act(() => {
      s().setSelectedId(s().tree.components[0]!.id as string);
      s().patchSelected({ length: 0.2 });
    });

    expect(computeStaticInfo).toHaveBeenCalledTimes(1);
    expect(s().sims.every((x) => !!x.result)).toBe(true); // still readable
    expect(s().sims.every((x) => x.outdated)).toBe(true); // …but flagged
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

describe('a hydrate does not re-stamp the design', () => {
  /**
   * `hydrate()` replaces tree/sims/extraMotors, which re-runs the autosave
   * effect and schedules a write of the bytes just read — and
   * `DesignLibrary.write` stamps `updatedAt: Date.now()`. Opening the app
   * therefore re-stamped the design, so the library's "most recently updated"
   * order meant "most recently opened".
   */
  it('writes nothing after loading a saved workspace', async () => {
    load.mockResolvedValue(saved());
    await mount();
    save.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('still saves the first REAL edit after that hydrate', async () => {
    load.mockResolvedValue(saved());
    await mount();
    save.mockClear();

    act(() => s().addPartToTree('bodytube'));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves normally when there was no saved workspace to hydrate from', async () => {
    load.mockResolvedValue(null); // nothing stored: no hydrate, so nothing to skip
    await mount();
    save.mockClear();

    act(() => s().addPartToTree('bodytube'));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);
  });
});
