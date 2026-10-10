// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup } from '@testing-library/react';

/**
 * The workspace effects: hydration gate, debounced autosave, unload journal,
 * engine rebuild and result invalidation.
 *
 * None of this is reachable from `store.test.ts`, because it is about the order
 * and the guards around the async edges, not about what the store actions do.
 * So this drives the
 * real hook with the edges stubbed: a workspace store whose load can be made
 * to reject or to resolve late, and a `computeStaticInfo` that just counts.
 */

const load = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());
const saveSync = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/storage/workspaceStore', async (orig) => ({
  ...(await orig<typeof import('../../src/services/storage/workspaceStore')>()),
  getWorkspaceStore: () => ({ load, save, saveSync }),
}));

const computeStaticInfo = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/design/buildRocket', async (orig) => ({
  ...(await orig<typeof import('../../src/services/design/buildRocket')>()),
  computeStaticInfo,
}));

vi.mock('../../src/engine/simClient', () => ({ warmSimWorker: vi.fn() }));
vi.mock('../../src/services/storage/persistStorage', () => ({
  requestPersistentStorage: vi.fn(() => Promise.resolve(true)),
}));

const degraded = vi.hoisted(() => ({ fire: null as null | (() => void) }));
vi.mock('../../src/services/storage/idbKeyValueStore', async (orig) => ({
  ...(await orig<typeof import('../../src/services/storage/idbKeyValueStore')>()),
  onStorageDegraded: (cb: () => void) => {
    degraded.fire = cb;
    return () => {
      degraded.fire = null;
    };
  },
}));

import { REBUILD_DEBOUNCE_MS, useWorkspaceEffects } from '../../src/state/useWorkspaceEffects';
import { useWorkspaceStore } from '../../src/state/store';
import { asFlown, isStale } from '../testing/flown';
import { useEngineStore } from '../../src/state/engineStore';
import { getDesignLibrary, setDesignLibrary, type DesignLibrary } from '../../src/services/storage/designLibrary';
import { renderWithProviders } from '../testing/renderWithProviders';
import i18n from '../../src/i18n';

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
  // The rebuild effect waits on the kernel, because the app mounts before it is
  // loaded. Every test here but the gating one is about what the rebuild does
  // once there is an engine, so they start with one.
  useEngineStore.setState({ phase: 'ready', backend: 'js', status: null, slow: false, error: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Let the debounced rebuild that an edit after the first build schedules land. */
const settleRebuild = () => act(() => void vi.advanceTimersByTime(REBUILD_DEBOUNCE_MS));

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
    // And it built the restored design, not the default it was mounted with.
    expect((computeStaticInfo.mock.calls[0]![0] as { name: string }).name).toBe('Restored');
  });

  /**
   * A language switch must not touch the workspace.
   *
   * The load effect must not depend on `t`, whose identity changes on
   * `i18n.changeLanguage`: that re-runs `load()` and re-hydrates, and `hydrate` runs
   * `sanitizeSims`, which nulls every sim result. So switching language would throw
   * away every flight the user had run. It can also re-hydrate the persisted design
   * over a freshly imported .ork, because `openOrkFile` clears only the in-memory
   * activeId.
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
   * A rejected load must not leave `hydrated` and `ready` false forever: that means
   * no autosave, no unload flush, no engine rebuild and a null `info`, so the app
   * sits there with no stats and no stability badge, saving nothing, with nothing on
   * screen to say why.
   */
  it('degrades to a working workspace when the load rejects, and says so', async () => {
    load.mockRejectedValue(new Error('idb blocked'));
    await mount();

    // In the warning slot, not `setErr`: opening the gate runs the rebuild
    // effect, and its success path calls `setErr(null)`; a message written
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
    act(() => {
      vi.advanceTimersByTime(400);
    });
    act(() => s().addPartToTree('bodytube'));
    expect(save).not.toHaveBeenCalled(); // the second edit restarted the clock

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  /**
   * The header's save status reads `lastSavedAt`, and it is the only thing
   * that reports a save, since the File menu has no Save item. So it has to
   * be set where a write landed, not where one was asked for: a failed save
   * that still said "Saved" would be worse than saying nothing.
   */
  it('records when the write landed, and not when it failed', async () => {
    await mount();
    // The store is a module singleton shared with the tests above, so start
    // from a known "nothing has been saved yet".
    act(() => useWorkspaceStore.setState({ lastSavedAt: null }));

    act(() => s().addPartToTree('bodytube'));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    const saved = s().lastSavedAt;
    expect(saved).not.toBeNull();

    save.mockRejectedValueOnce(new Error('QuotaExceeded'));
    act(() => s().addPartToTree('bodytube'));
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(s().lastSavedAt).toBe(saved); // still the last one that worked
  });

  it('does not save before hydration has finished', async () => {
    let settle!: (v: unknown) => void;
    load.mockReturnValue(new Promise((r) => (settle = r)));
    renderWithProviders(<Host />);

    act(() => s().addPartToTree('bodytube'));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Saving now would write the default design over the one still being read.
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
   * (idbKeyValueStore.ts), so clearing its message on the next successful
   * write would retire it for the whole session, one keystroke after it
   * appeared. The user would then meet the 5 MB cap with nothing on screen to
   * explain it, which is the exact outcome the warning exists to prevent.
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
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    // Synchronous path: an async IndexedDB write cannot finish during teardown.
    expect(saveSync).toHaveBeenCalledTimes(1);
  });

  it('does not journal a workspace it never hydrated', () => {
    load.mockReturnValue(new Promise(() => {})); // never settles
    renderWithProviders(<Host />);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(saveSync).not.toHaveBeenCalled();
  });

  it('stops listening once unmounted', async () => {
    const { unmount } = await mount();
    unmount();
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(saveSync).not.toHaveBeenCalled();
  });
});

describe('what triggers a rebuild', () => {
  /**
   * The rebuild must not key on `tree`, which every store action replaces: typing a
   * designer name would run a full engine build plus an aero sweep, and the result
   * invalidation, keyed the same way, would throw away every simulation result.
   */
  it('editing the design metadata neither rebuilds nor invalidates', async () => {
    await mount();
    computeStaticInfo.mockClear();
    act(() => {
      useWorkspaceStore.setState((st) => ({
        sims: st.sims.map((x) => asFlown(st, { ...x, result: { summary: { maxAltitude: 271 } } as never })),
      }));
    });

    act(() => s().updateDesignMeta({ designer: 'Ada Lovelace' }));

    expect(computeStaticInfo).not.toHaveBeenCalled();
    expect(s().sims.every((x) => !isStale(x))).toBe(true);
  });

  it('renaming a part rebuilds — the engine labels its rows with the name', async () => {
    await mount();
    computeStaticInfo.mockClear();

    act(() => {
      s().setSelectedId(s().tree.components[0]!.id as string);
      s().patchSelected({ name: 'Ogive' });
    });
    settleRebuild();

    expect(computeStaticInfo).toHaveBeenCalledTimes(1);
  });

  /**
   * A typed or dragged dimension changes the design once per input event, and a
   * build is a full kernel run on the main thread. A burst costs one build, of
   * the design as it stands after the last event.
   */
  it('builds once for a burst of edits, after the last one', async () => {
    await mount();
    computeStaticInfo.mockClear();
    act(() => s().setSelectedId(s().tree.components[0]!.id as string));

    for (const length of [0.21, 0.22, 0.23, 0.24]) {
      act(() => s().patchSelected({ length }));
      act(() => void vi.advanceTimersByTime(REBUILD_DEBOUNCE_MS - 1));
    }
    expect(computeStaticInfo).not.toHaveBeenCalled();

    settleRebuild();
    expect(computeStaticInfo).toHaveBeenCalledTimes(1);
    const built = computeStaticInfo.mock.calls[0]![0] as { components: { length?: number }[] };
    expect(built.components[0]!.length).toBe(0.24);
  });

  it('builds the first time at once, without waiting out the debounce', async () => {
    await mount();
    expect(computeStaticInfo).toHaveBeenCalledTimes(1);
  });

  it('changing a dimension rebuilds and ages the results without destroying them', async () => {
    await mount();
    computeStaticInfo.mockClear();
    // Seed a result, so this asserts the keep as well as the flag. Without one
    // an `every(x => !x.result)` check passes vacuously, because no sim has run.
    act(() => {
      useWorkspaceStore.setState((st) => ({
        sims: st.sims.map((x) => asFlown(st, { ...x, result: { summary: { maxAltitude: 271 } } as never })),
      }));
    });

    act(() => {
      s().setSelectedId(s().tree.components[0]!.id as string);
      s().patchSelected({ length: 0.2 });
    });
    settleRebuild();

    expect(computeStaticInfo).toHaveBeenCalledTimes(1);
    expect(s().sims.every((x) => !!x.result)).toBe(true); // still readable
    expect(s().sims.every((x) => isStale(x))).toBe(true); // …but flagged
  });

  /**
   * Grounding a stage changes the static info (a grounded stage contributes no
   * mass, no aero and no motor), so the rebuild key has to include it. Otherwise
   * the worker flies the sustainer alone while `info` still describes the whole
   * stack, and the stats strip, the stability badge and the RASAero launch mass
   * all come from a handle for a different rocket. `seatedMotorsKey` cannot
   * see it: it is mount-and-spec only, and grounding moves neither.
   */
  it('grounding a stage rebuilds, because a grounded stage is a different rocket', async () => {
    await mount();
    // Two stages, because the store refuses to ground the only one ("something
    // has to fly") -- against a single-stage design the call is a no-op and the
    // test would pass for the wrong reason.
    act(() => s().addStageToTree());
    await act(async () => void (await Promise.resolve()));
    settleRebuild();
    computeStaticInfo.mockClear();
    const cfg = s().configs[0]!;
    const booster = s().tree.components.at(-1)!.id as string;

    act(() => s().setStageFlies(cfg.id, booster, false));
    settleRebuild();
    expect(s().configs[0]!.grounded).toContain(booster); // the write landed
    expect(computeStaticInfo).toHaveBeenCalledTimes(1);

    // And back: un-grounding is just as much a change of rocket.
    act(() => s().setStageFlies(cfg.id, booster, true));
    settleRebuild();
    expect(computeStaticInfo).toHaveBeenCalledTimes(2);
  });

  it('does not rebuild when the grounded set is set to what it already was', async () => {
    await mount();
    act(() => s().addStageToTree());
    await act(async () => void (await Promise.resolve()));
    const cfg = s().configs[0]!;
    const booster = s().tree.components.at(-1)!.id as string;
    act(() => s().setStageFlies(cfg.id, booster, false));
    settleRebuild();
    computeStaticInfo.mockClear();

    // The key is a sorted set, so a no-op write must not cost a kernel build.
    act(() => s().setStageFlies(cfg.id, booster, false));
    settleRebuild();
    expect(computeStaticInfo).not.toHaveBeenCalled();
  });

  it('surfaces a build failure instead of leaving stale stats on screen', async () => {
    await mount();
    computeStaticInfo.mockReturnValue({ error: 'fin tab longer than the root chord' });

    act(() => {
      s().setSelectedId(s().tree.components[0]!.id as string);
      s().patchSelected({ length: 0.3 });
    });
    settleRebuild();

    expect(s().info).toBeNull();
    expect(s().buildErr).toBe('fin tab longer than the root chord');
  });

  it('waits for the kernel, and builds the moment it arrives', async () => {
    // The app mounts before the engine is loaded, so this is the ordinary first
    // second of every visit, not an error path.
    useEngineStore.setState({ phase: 'loading', backend: null });
    await mount();

    // No build, and - the point of the gate - no error banner either: blaming
    // the design for a kernel that has not finished downloading would be a
    // message about nothing the user can act on.
    expect(computeStaticInfo).not.toHaveBeenCalled();
    expect(s().info).toBeNull();
    expect(s().buildErr).toBeNull();
    expect(s().err).toBeNull();

    await act(async () => {
      useEngineStore.setState({ phase: 'ready', backend: 'wasm' });
      await Promise.resolve();
    });

    expect(computeStaticInfo).toHaveBeenCalledTimes(1);
    expect(s().info).not.toBeNull();
  });

  // The engine can arrive after an import has already failed. Building the
  // same design must not wipe that message before it is read.
  it('keeps an action error through a build of the same design', async () => {
    useEngineStore.setState({ phase: 'loading', backend: null });
    await mount();
    act(() => s().setErr('Could not open that file'));
    await act(async () => {
      useEngineStore.setState({ phase: 'ready', backend: 'wasm' });
      await Promise.resolve();
    });
    expect(computeStaticInfo).toHaveBeenCalledTimes(1);
    expect(s().err).toBe('Could not open that file');
  });

  it('clears an action error once the design is edited and builds', async () => {
    await mount();
    act(() => s().setErr('Could not open that file'));
    act(() => {
      s().setSelectedId(s().tree.components[0]!.id as string);
      s().patchSelected({ length: 0.3 });
    });
    settleRebuild();
    expect(s().err).toBeNull();
  });

  it('builds again after a retry that swaps the engine underneath it', async () => {
    // `retry()` throws the old engine away, so whatever was built under it is
    // void. A second 'ready' has to rebuild rather than sit on the stale handle.
    await mount();
    expect(computeStaticInfo).toHaveBeenCalledTimes(1);

    await act(async () => {
      useEngineStore.setState({ phase: 'loading', backend: null });
      await Promise.resolve();
    });
    await act(async () => {
      useEngineStore.setState({ phase: 'ready', backend: 'js' });
      await Promise.resolve();
    });

    expect(computeStaticInfo).toHaveBeenCalledTimes(2);
  });
});

describe('a hydrate does not re-stamp the design', () => {
  /**
   * `hydrate()` replaces tree/sims/extraMotors, which re-runs the autosave
   * effect and schedules a write of the bytes just read, and
   * `DesignLibrary.write` stamps `updatedAt: Date.now()`. Unless that write is
   * skipped, opening the app re-stamps the design, and the library's "most
   * recently updated" order means "most recently opened".
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

  // File > Open is the same hydrate, after boot. Its own flush of the design
  // being left is the one write it makes.
  it('writes nothing after opening a library design', async () => {
    await mount();
    const original = getDesignLibrary();
    setDesignLibrary({
      read: async () => saved(),
      setActive: async () => true,
      list: async () => [],
      activeId: async () => 'lib-1',
    } as unknown as DesignLibrary);
    try {
      await act(async () => {
        await s().openDesign('lib-1');
      });
    } finally {
      setDesignLibrary(original);
    }
    expect(s().tree.name).toBe('Restored');
    save.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(save).not.toHaveBeenCalled();
  });

  // An untouched blank design is not worth a library entry; the first edit is.
  it('writes nothing after New until the first edit', async () => {
    load.mockResolvedValue(saved());
    await mount();
    act(() => s().resetWorkspace());
    save.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(save).not.toHaveBeenCalled();

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

/**
 * Restoring a design is not editing it.
 *
 * The boot design and the restored one differ, so anything comparing against
 * the design on screen before the restore would read every restored result as
 * stale, and with `simulation.autoRunOutdated` on and a result view open,
 * CenterView would re-fly flights that are already current. A result is
 * compared against what it was flown from, which a restore does not change.
 *
 * `flightKey` strips `name`, so a fixture differing only by name would prove
 * nothing. These use a structurally different tree. The saved rows carry the
 * stored `outdated: false` flag and no `resultKey`, which hydrate keys to the
 * inputs they load with.
 */
describe('restoring a saved design does not invalidate its flights', () => {
  /** A saved workspace whose geometry differs from the default, with a flight. */
  const savedWithFlight = () => {
    const tree = structuredClone(s().tree) as typeof s extends never ? never : ReturnType<typeof s>['tree'];
    const bumpLength = (n: { type?: string; length?: number; children?: unknown[] }) => {
      if (n.type === 'bodytube') n.length = (n.length ?? 0.2) + 0.123;
      for (const c of (n.children ?? []) as (typeof n)[]) bumpLength(c);
    };
    for (const c of tree.components as unknown as Parameters<typeof bumpLength>[0][]) bumpLength(c);
    return {
      version: 1 as const,
      tree,
      sims: s().sims.map((x) => ({
        ...x,
        result: { summary: { maxAltitude: 100 }, events: [], series: {} },
        outdated: false,
      })),
      activeId: s().activeId,
      extraMotors: {},
      loadedMeta: null,
    };
  };

  it('keeps a restored result current', async () => {
    load.mockResolvedValue(savedWithFlight());
    await mount();

    // The geometry really did change on hydrate, so this is the case that could
    // trip the effect.
    expect(s().sims[0]!.result).not.toBeNull();
    expect(isStale(s().sims[0]!)).toBe(false);
  });

  it('still invalidates when the user actually edits the geometry', async () => {
    load.mockResolvedValue(savedWithFlight());
    await mount();
    expect(isStale(s().sims[0]!)).toBe(false);

    const tube = s().tree.components[0]!.children?.find((c) => c.type === 'bodytube') ?? s().tree.components[0]!;
    await act(async () => {
      s().setSelectedId(tube.id ?? null);
      s().patchSelected({ length: 0.42 });
      await Promise.resolve();
    });

    expect(isStale(s().sims[0]!)).toBe(true);
  });

  /**
   * File > Open is a second hydrate, after the boot one. The library design
   * carries its own current results, and its geometry differs from the design it
   * replaces; that difference must not age them.
   */
  it('keeps the results current when a library design is opened over the boot design', async () => {
    await mount(); // boot on the default design; the baseline is now its key
    const original = getDesignLibrary();
    const w = savedWithFlight();
    setDesignLibrary({
      read: async () => w,
      setActive: async () => true,
      list: async () => [],
      activeId: async () => 'lib-1',
    } as unknown as DesignLibrary);
    try {
      await act(async () => {
        await s().openDesign('lib-1');
      });
    } finally {
      setDesignLibrary(original);
    }

    // The opened design is structurally different and has a current result.
    expect(s().sims[0]!.result).not.toBeNull();
    expect(isStale(s().sims[0]!)).toBe(false);

    // A real edit after the open still ages it.
    const tube = s().tree.components[0]!.children?.find((c) => c.type === 'bodytube') ?? s().tree.components[0]!;
    await act(async () => {
      s().setSelectedId(tube.id ?? null);
      s().patchSelected({ length: 0.42 });
      await Promise.resolve();
    });
    expect(isStale(s().sims[0]!)).toBe(true);
  });
});
