// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup } from '@testing-library/react';

/**
 * The storage warnings over the session: a save's own failure, retired by the
 * next save that lands, and the standing notices (IndexedDB degraded, the
 * stored design unreadable), which no save undoes and no later warning may
 * overwrite. The messages expected are the locale's own.
 *
 * Driven through the real effects hook with the workspace store's edges
 * stubbed, as `useWorkspaceEffects.test.tsx` does.
 */

const load = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());
const saveSync = vi.hoisted(() => vi.fn());
const setActiveId = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/storage/workspaceStore', async (orig) => ({
  ...(await orig<typeof import('../../src/services/storage/workspaceStore')>()),
  getWorkspaceStore: () => ({ load, save, saveSync, setActiveId }),
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

import { useWorkspaceEffects } from '../../src/state/useWorkspaceEffects';
import { useWorkspaceStore } from '../../src/state/store';
import { migrateWorkspace } from '../../src/services/storage/workspaceMigrate';
import { useEngineStore } from '../../src/state/engineStore';
import { renderWithProviders } from '../testing/renderWithProviders';
import en from '../../src/i18n/locales/en.json';

function Host() {
  useWorkspaceEffects();
  return null;
}

const s = () => useWorkspaceStore.getState();

/** A stored workspace, as reopening a design from My Rockets reads it. */
const stored = () =>
  migrateWorkspace({
    version: 1,
    tree: { ...s().tree, name: 'Reopened' },
    sims: s().sims,
    activeId: s().activeId,
    extraMotors: {},
    loadedMeta: null,
  })!;

beforeEach(() => {
  vi.useFakeTimers();
  s().resetWorkspace();
  s().setStorageWarning(null);
  load.mockReset().mockResolvedValue(null);
  save.mockReset().mockResolvedValue(undefined);
  saveSync.mockReset();
  setActiveId.mockReset();
  computeStaticInfo.mockReset().mockReturnValue({ info: { length: 1 }, rocket: {} });
  useEngineStore.setState({ phase: 'ready', backend: 'js', status: null, slow: false, error: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const mount = async () => {
  const r = renderWithProviders(<Host />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return r;
};

/** Edit, and let the debounced autosave run and settle. */
const editAndAutosave = async () => {
  act(() => s().addPartToTree('bodytube'));
  await act(async () => {
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** What the store's save throws when another tab has moved the design on. */
const conflict = () => new Error('conflict');
/** What it throws when the browser refuses the write. */
const quota = () => new Error('QuotaExceeded');

describe('a save conflict', () => {
  it('is retired by the next save that lands', async () => {
    await mount();
    save.mockRejectedValueOnce(conflict());
    await editAndAutosave();
    expect(s().storageWarning).toBe(en.storage.conflict);

    await editAndAutosave();
    expect(save).toHaveBeenCalledTimes(2);
    expect(s().storageWarning).toBeNull();
  });

  it('is retired by reopening the design, and stays gone through the next autosave', async () => {
    await mount();
    save.mockRejectedValueOnce(conflict());
    await editAndAutosave();
    expect(s().storageWarning).toBe(en.storage.conflict);

    act(() => s().hydrate(stored()));
    expect(s().storageWarning).toBeNull();

    await editAndAutosave();
    expect(s().storageWarning).toBeNull();
  });

  it('leaves a "storage full" warning to the next save, not to a reopen', async () => {
    await mount();
    save.mockRejectedValueOnce(quota());
    await editAndAutosave();
    expect(s().storageWarning).toBe(en.storage.full);

    act(() => s().hydrate(stored()));
    expect(s().storageWarning).toBe(en.storage.full);
  });
});

describe('a standing notice', () => {
  it.each([
    ['degraded', en.storage.degraded],
    ['loadFailed', en.storage.loadFailed],
  ] as const)(
    'the %s notice outlasts a full warning raised over it and the save that retires it',
    async (kind, msg) => {
      if (kind === 'loadFailed') load.mockRejectedValue(new Error('idb blocked'));
      await mount();
      if (kind === 'degraded') act(() => degraded.fire!());
      expect(s().storageWarning).toBe(msg);

      save.mockRejectedValueOnce(quota());
      await editAndAutosave();
      expect(s().storageWarning).toContain(msg);
      expect(s().storageWarning).toContain(en.storage.full);

      await editAndAutosave();
      expect(s().storageWarning).toBe(msg);
      expect(s().storageWarningKind).toBe(kind);
    },
  );

  it('outlasts a conflict raised over it and the reopen that retires it', async () => {
    await mount();
    act(() => degraded.fire!());
    save.mockRejectedValueOnce(conflict());
    await editAndAutosave();
    expect(s().storageWarning).toContain(en.storage.degraded);
    expect(s().storageWarning).toContain(en.storage.conflict);

    act(() => s().hydrate(stored()));
    expect(s().storageWarning).toBe(en.storage.degraded);
  });
});

describe('a load that fails', () => {
  /** Hide the tab, as switching to another one does, and let any write settle. */
  const hideTab = async () => {
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
      });
    } finally {
      vis.mockRestore();
    }
  };

  it.each([
    ['the read rejects', () => load.mockRejectedValue(new Error('idb blocked'))],
    ['the stored design does not hydrate', () => load.mockResolvedValue({ ...stored(), tree: null })],
  ])('leaves the untouched default rocket unsaved when the tab is hidden: %s', async (_what, fail) => {
    // The page's own starting state, which no New or load has marked.
    useWorkspaceStore.setState({ tree: { ...s().tree } });
    fail();
    await mount();
    expect(s().storageWarning).toBe(en.storage.loadFailed);
    save.mockClear();
    await hideTab();
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(save).not.toHaveBeenCalled();
    expect(saveSync).not.toHaveBeenCalled();
  });

  it('still saves an edit made after it', async () => {
    useWorkspaceStore.setState({ tree: { ...s().tree } });
    load.mockRejectedValue(new Error('idb blocked'));
    await mount();
    save.mockClear();
    act(() => s().addPartToTree('bodytube'));
    await hideTab();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
