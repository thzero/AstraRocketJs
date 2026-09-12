// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { LibraryWorkspaceStore, type Workspace } from './workspaceStore';
import { DesignLibrary, setDesignLibrary } from './designLibrary';
import type { KeyValueStore } from './keyValueStore';

// The unload journal exists because the store is IndexedDB-backed: an async
// write cannot complete while the page tears down, so `saveSync` puts the
// workspace in localStorage synchronously and `load` folds it back in.

class FakeKv implements KeyValueStore {
  readonly map = new Map<string, string>();
  full = false;
  async get(k: string) {
    return this.map.get(k) ?? null;
  }
  async set(k: string, v: string) {
    if (this.full) return false;
    this.map.set(k, v);
    return true;
  }
  async remove(k: string) {
    this.map.delete(k);
  }
}

const UNLOAD_KEY = 'astrarrocketjs:designs:unload';

const ws = (name: string): Workspace =>
  ({
    version: 1,
    tree: { components: [{ id: 'n1', name }] },
    sims: [{ id: 's1', name: 'Sim 1', result: null }],
    activeId: 's1',
    extraMotors: {},
    loadedMeta: null,
  }) as unknown as Workspace;

const nameOf = (w: Workspace | null) =>
  (w?.tree as unknown as { components: { name: string }[] } | undefined)?.components[0]?.name;

let kv: FakeKv;
let lib: DesignLibrary;
let store: LibraryWorkspaceStore;
beforeEach(() => {
  localStorage.clear();
  kv = new FakeKv();
  lib = new DesignLibrary(kv);
  setDesignLibrary(lib);
  store = new LibraryWorkspaceStore();
});

describe('unload journal', () => {
  it('survives an unload the debounced save never reached', async () => {
    await store.save(ws('saved'));
    await store.load(); // learn the active id

    // Edit, then the page goes away before the 500ms debounce fires.
    store.saveSync(ws('edited-at-the-last-moment'));

    const fresh = new LibraryWorkspaceStore();
    expect(nameOf(await fresh.load())).toBe('edited-at-the-last-moment');
  });

  it('folds the journal into the design and clears it', async () => {
    await store.save(ws('saved'));
    await store.load();
    store.saveSync(ws('pending'));

    await new LibraryWorkspaceStore().load();
    expect(localStorage.getItem(UNLOAD_KEY)).toBeNull();
    // The library now holds it, so the next load needs no journal.
    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('pending');
  });

  it('keeps the journal when folding it in fails, rather than losing the edit', async () => {
    await store.save(ws('saved'));
    await store.load();
    store.saveSync(ws('precious'));

    kv.full = true;
    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('precious');
    expect(localStorage.getItem(UNLOAD_KEY)).not.toBeNull();
  });

  it('does NOT replay a journal belonging to a different design', async () => {
    const a = await lib.create('A', ws('a'));
    const b = await lib.create('B', ws('b')); // create() makes B active

    // A journal left over from editing A, while B is what is now open.
    localStorage.setItem(UNLOAD_KEY, JSON.stringify({ id: a.id, w: ws('a-unsaved') }));

    // Replaying it would overwrite an unrelated rocket.
    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('b');
    expect(nameOf(await lib.read(b.id))).toBe('b');
    expect(localStorage.getItem(UNLOAD_KEY)).toBeNull(); // stale → dropped
  });

  it('uses the stored design when there is no journal', async () => {
    await store.save(ws('durable'));
    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('durable');
  });

  it('drops cached flight results from the journal, as the async save does', async () => {
    await store.save(ws('heavy'));
    await store.load();
    const heavy = ws('heavy');
    (heavy.sims[0] as unknown as { result: unknown }).result = { series: new Array(1000).fill(0) };

    store.saveSync(heavy);
    const journal = JSON.parse(localStorage.getItem(UNLOAD_KEY)!) as { w: Workspace };
    expect(journal.w.sims[0]!.result).toBeNull();
  });

  it('clear() removes both the journal and the stored design', async () => {
    await store.save(ws('gone'));
    await store.load();
    store.saveSync(ws('gone'));

    await store.clear();
    expect(localStorage.getItem(UNLOAD_KEY)).toBeNull();
    expect(await lib.list()).toEqual([]);
  });
});
