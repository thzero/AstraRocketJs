// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import i18n from '../../src/i18n';
import { LoadedBanner } from '../../src/components/canvas/LoadedBanner';
import { useWorkspaceStore } from '../../src/state/store';
import { LibraryWorkspaceStore, type Workspace } from '../../src/services/storage/workspaceStore';
import { DesignLibrary, setDesignLibrary } from '../../src/services/storage/designLibrary';
import type { KeyValueStore } from '../../src/services/storage/keyValueStore';
import { sniffDesignFormat } from '../../src/services/files/designFile';
import { renderWithProviders } from '../testing/renderWithProviders';

/** The library's backing store, held in memory, as a reload finds it. */
class MemoryKv implements KeyValueStore {
  map = new Map<string, string>();
  async get(k: string) {
    return this.map.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.map.set(k, v);
    return true;
  }
  async remove(k: string) {
    this.map.delete(k);
  }
  async update(k: string, fn: (raw: string | null) => string | null) {
    const next = fn(this.map.get(k) ?? null);
    if (next === null) this.map.delete(k);
    else this.map.set(k, next);
    return true;
  }
}

afterEach(cleanup);
beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
  localStorage.clear();
});

/**
 * The loaded-design card names the format of the file the design came from. A
 * stored workspace carries it, so the card says the same after a reload.
 */
describe('a stored imported design', () => {
  it('keeps the format the card names across a reload', async () => {
    // The format as the importer reads it off a RockSim file.
    const format = sniffDesignFormat('<RockSimDocument><FileVersion>4</FileVersion></RockSimDocument>');
    expect(format).toBe('rkt');
    const st = useWorkspaceStore.getState();
    const saved: Workspace = {
      version: 3,
      tree: st.tree,
      sims: st.sims,
      configs: st.configs,
      activeId: st.activeId,
      loadedMeta: { name: 'Imported', notes: [], exportMotors: {}, format: format! },
    };

    const kv = new MemoryKv();
    setDesignLibrary(new DesignLibrary(kv));
    await new LibraryWorkspaceStore().save(saved);
    // A reload: a new store over the same storage.
    const w = (await new LibraryWorkspaceStore().load())!;
    expect(w.loadedMeta?.format).toBe('rkt');
    act(() => useWorkspaceStore.getState().hydrate(w));
    expect(useWorkspaceStore.getState().loadedMeta?.format).toBe('rkt');

    renderWithProviders(<LoadedBanner loaded={useWorkspaceStore.getState().loadedMeta} onClose={() => {}} />);
    expect(screen.getByText(i18n.t('banner.loaded', { ext: '.rkt' }))).toBeTruthy();
  });
});
