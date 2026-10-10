import { nsKey } from '../../../src/services/storage/storageKeys';
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LibraryWorkspaceStore, type Workspace } from '../../../src/services/storage/workspaceStore';
import { DesignLibrary, setDesignLibrary } from '../../../src/services/storage/designLibrary';
import { LocalStorageKeyValueStore, type KeyValueStore } from '../../../src/services/storage/keyValueStore';

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

const UNLOAD_KEY = nsKey('designs:unload');

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
  // written by a different app build parses cleanly and is still not a workspace
  // this build can open, and this is an installed PWA, so an older cached build
  // is a live possibility, not a hypothetical. The journal must be validated
  // before it is written into the library: writing first would overwrite the real
  // stored design with the bad blob and clear the journal, so the design would be
  // gone for good and every later load would re-read the same bad blob.
  it('does not overwrite the stored design with a journal of the wrong shape', async () => {
    await store.save(ws('precious'));
    const loaded = await store.load(); // learn the active id
    expect(nameOf(loaded)).toBe('precious');

    // Valid JSON, wrong shape: a future build's version stamp.
    const activeId = kv.map.get(nsKey('designs:active'));
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
 * A journal written before the first save carries a null id, because that is
 * all `saveSync` has to record at that point.
 *
 * Compared to the active id like any other journal, it would never be replayed
 * and never cleared, because `null !== null` is false. Work done before the
 * first debounced autosave would be lost on reload even though `saveSync` wrote
 * it, and the dead blob (a whole lean workspace) would sit in the ~5 MB
 * localStorage budget forever.
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

    // Left in place it would sit there forever, holding a slice of a 5 MB budget.
    expect(localStorage.getItem(UNLOAD_KEY)).toBeNull();
  });
});

describe('a journal older than the stored design', () => {
  // The unload write is a last resort and can lose the race: the debounced
  // async save in flight at pagehide commits after it, or another tab of the
  // PWA saves the same design later. Replaying such a journal would roll the
  // design back to the older text.
  it('is dropped, not replayed over the newer save', async () => {
    await store.save(ws('newer'));
    const loaded = await store.load();
    expect(nameOf(loaded)).toBe('newer');
    const activeId = kv.map.get(nsKey('designs:active'));

    // A journal stamped a minute before that save landed.
    localStorage.setItem(UNLOAD_KEY, JSON.stringify({ id: activeId, w: ws('stale-unload'), t: Date.now() - 60_000 }));

    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('newer');
    expect(nameOf(await lib.read(activeId!))).toBe('newer');
    expect(localStorage.getItem(UNLOAD_KEY)).toBeNull();
  });

  it('is replayed when it is newer, and when it carries no stamp (older build)', async () => {
    await store.save(ws('saved'));
    await store.load();
    const activeId = kv.map.get(nsKey('designs:active'));

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

/**
 * Two tabs of the PWA open the same design. The one left behind writes its
 * journal at unload whether or not it ever tried to save, and that write is
 * later than the other tab's save. Replaying it on the next load would put the
 * stale design over the newer one with no edit made in the stale tab.
 *
 * Run against both tiers: the index the writer is recorded on lives in
 * IndexedDB normally and in localStorage (beside the journal) when IndexedDB
 * is blocked.
 */
describe.each([
  ['IndexedDB', () => new FakeKv() as KeyValueStore],
  ['localStorage', () => new LocalStorageKeyValueStore() as KeyValueStore],
])('a stale tab’s unload journal (%s tier)', (_tier, makeKv) => {
  let tabA: LibraryWorkspaceStore;
  let tabB: LibraryWorkspaceStore;
  let id: string;
  // A real gap between the steps: two saves inside one millisecond push the
  // stamp past the clock, which would hide a journal stamped by wall time.
  const later = () => vi.setSystemTime(Date.now() + 1000);
  afterEach(() => vi.useRealTimers());
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    localStorage.clear();
    lib = new DesignLibrary(makeKv());
    setDesignLibrary(lib);
    await new LibraryWorkspaceStore().save(ws('original'));
    id = (await lib.activeId())!;
    tabA = new LibraryWorkspaceStore();
    tabB = new LibraryWorkspaceStore();
    expect(nameOf(await tabA.load())).toBe('original');
    expect(nameOf(await tabB.load())).toBe('original');
  });

  it('is not replayed over a newer save from the other tab (pagehide)', async () => {
    later();
    await tabB.save(ws('newer-from-b'));
    later();
    tabA.saveSync(ws('original'));

    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('newer-from-b');
    expect(nameOf(await lib.read(id))).toBe('newer-from-b');
    expect(localStorage.getItem(UNLOAD_KEY)).toBeNull();
  });

  it('is not replayed over it when the tab is hidden (save and journal together)', async () => {
    later();
    await tabB.save(ws('newer-from-b'));
    // `onHidden` starts the async save and writes the journal at once.
    later();
    const saving = tabA.save(ws('original'));
    tabA.saveSync(ws('original'));
    await expect(saving).rejects.toThrow('conflict');

    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('newer-from-b');
  });

  it('is not replayed over a save the other tab makes after it', async () => {
    later();
    tabA.saveSync(ws('stale-a'));
    later();
    await tabB.save(ws('newer-from-b'));

    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('newer-from-b');
  });

  it('is still replayed for a single tab with unsaved edits', async () => {
    later();
    tabA.saveSync(ws('unsaved-in-a'));

    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('unsaved-in-a');
    expect(nameOf(await lib.read(id))).toBe('unsaved-in-a');
  });

  it('is replayed when the tab’s own save commits after it', async () => {
    // The debounced save in flight at pagehide lands after the journal, with
    // the edits made since still only in the journal.
    later();
    const saving = tabA.save(ws('debounced'));
    tabA.saveSync(ws('typed-after-the-debounce'));
    later();
    await saving;

    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('typed-after-the-debounce');
  });

  it('is replayed after the tab’s own earlier saves', async () => {
    later();
    await tabA.save(ws('saved-by-a'));
    later();
    await tabA.save(ws('saved-again'));
    later();
    tabA.saveSync(ws('unsaved-in-a'));

    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('unsaved-in-a');
  });
});
