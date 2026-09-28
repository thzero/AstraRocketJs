// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { LibraryWorkspaceStore, type Workspace } from '../../src/services/workspaceStore';
import { DesignLibrary, setDesignLibrary } from '../../src/services/designLibrary';
import type { KeyValueStore } from '../../src/services/keyValueStore';

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
  async update(k: string, fn: (raw: string | null) => string | null) {
    const next = fn(await this.get(k));
    if (next === null) {
      await this.remove(k);
      return true;
    }
    return await this.set(k, next);
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
  // `readJournal` only checks that the blob parses and has a `w`. A journal
  // written by a DIFFERENT app build parses cleanly and is still not a workspace
  // this build can open — and this is an installed PWA, so an older cached build
  // is a live possibility, not a hypothetical. The journal must be validated
  // BEFORE it is written into the library: writing first overwrote the real
  // stored design with the bad blob and cleared the journal, so the design was
  // gone for good and every later load re-read the same bad blob.
  it('does not overwrite the stored design with a journal of the wrong shape', async () => {
    await store.save(ws('precious'));
    const loaded = await store.load(); // learn the active id
    expect(nameOf(loaded)).toBe('precious');

    // Valid JSON, wrong shape: a future build's version stamp.
    const activeId = kv.map.get('astrarrocketjs:designs:active');
    localStorage.setItem(UNLOAD_KEY, JSON.stringify({ id: activeId, w: { ...ws('from-a-newer-build'), version: 2 } }));

    const again = await new LibraryWorkspaceStore().load();
    // The stored design is untouched and still opens.
    expect(nameOf(again)).toBe('precious');
    // And the unusable journal is dropped rather than retried forever.
    expect(localStorage.getItem(UNLOAD_KEY)).toBeNull();
  });

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
});

/**
 * A journal written BEFORE the first save carries a null id, because that is
 * all `saveSync` has to record at that point.
 *
 * Both the replay check and the staleness check compared it to the active id,
 * and `null !== null` is false, so such a journal was never replayed AND never
 * cleared. Work done before the first debounced autosave was lost on reload
 * even though `saveSync` had written it, and the dead blob (a whole lean
 * workspace) squatted in the ~5 MB localStorage budget forever.
 */
describe('unload journal written before the first save', () => {
  it('replays it into a NEW design instead of discarding the work', async () => {
    const kv = new FakeKv();
    setDesignLibrary(new DesignLibrary(kv));
    const store = new LibraryWorkspaceStore();

    // Nothing saved yet: the page is torn down mid-edit.
    store.saveSync(ws('typed-before-first-autosave'));
    expect(localStorage.getItem(UNLOAD_KEY)).not.toBeNull();

    const loaded = await new LibraryWorkspaceStore().load();
    expect(loaded).not.toBeNull();
    expect(loaded!.tree.components[0]!.name).toBe('typed-before-first-autosave');

    // It is now a real design, and the journal is spent.
    expect(await new DesignLibrary(kv).list()).toHaveLength(1);
    expect(localStorage.getItem(UNLOAD_KEY)).toBeNull();
  });

  it('clears the journal even when it cannot be replayed', async () => {
    const kv = new FakeKv();
    setDesignLibrary(new DesignLibrary(kv));
    // A blob that parses but is not a workspace this build can open.
    localStorage.setItem(UNLOAD_KEY, JSON.stringify({ id: null, w: { version: 99 } }));

    await new LibraryWorkspaceStore().load();

    // Previously it sat there forever, holding a slice of a 5 MB budget.
    expect(localStorage.getItem(UNLOAD_KEY)).toBeNull();
  });
});

describe('a journal older than the stored design', () => {
  // The unload write is a last resort and can lose the race: the debounced
  // async save in flight at pagehide commits after it, or another tab of the
  // PWA saves the same design later. Replaying such a journal rolled the
  // design back to the older text.
  it('is dropped, not replayed over the newer save', async () => {
    await store.save(ws('newer'));
    const loaded = await store.load();
    expect(nameOf(loaded)).toBe('newer');
    const activeId = kv.map.get('astrarrocketjs:designs:active');

    // A journal stamped a minute BEFORE that save landed.
    localStorage.setItem(UNLOAD_KEY, JSON.stringify({ id: activeId, w: ws('stale-unload'), t: Date.now() - 60_000 }));

    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('newer');
    expect(nameOf(await lib.read(activeId!))).toBe('newer');
    expect(localStorage.getItem(UNLOAD_KEY)).toBeNull();
  });

  it('is replayed when it is newer, and when it carries no stamp (older build)', async () => {
    await store.save(ws('saved'));
    await store.load();
    const activeId = kv.map.get('astrarrocketjs:designs:active');

    localStorage.setItem(UNLOAD_KEY, JSON.stringify({ id: activeId, w: ws('newer-unload'), t: Date.now() + 1000 }));
    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('newer-unload');

    localStorage.setItem(UNLOAD_KEY, JSON.stringify({ id: activeId, w: ws('unstamped') }));
    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('unstamped');
  });

  it('saveSync stamps the journal', () => {
    const before = Date.now();
    store.saveSync(ws('x'));
    const j = JSON.parse(localStorage.getItem(UNLOAD_KEY)!) as { t?: number };
    expect(j.t).toBeGreaterThanOrEqual(before);
  });
});
