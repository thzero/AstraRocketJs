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

/** Every journal key in storage: one per design, and the single slot an older build wrote. */
const journalKeys = (): string[] => {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k === UNLOAD_KEY || k.startsWith(`${UNLOAD_KEY}:`)) out.push(k);
  }
  return out;
};
/** The one journal in storage, raw, or null when there is none. */
const anyJournal = (): string | null => {
  const keys = journalKeys();
  expect(keys.length).toBeLessThanOrEqual(1);
  return keys.length ? localStorage.getItem(keys[0]!) : null;
};

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
  // `readJournalAt` only checks that the blob parses and has a `w`. A journal
  // written by a different app build (an installed PWA can run an older cached
  // build) parses cleanly and is still not a workspace this build can open.
  // The journal must be validated
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
    expect(anyJournal()).toBeNull();
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
    expect(anyJournal()).toBeNull();
    // The library now holds it, so the next load needs no journal.
    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('pending');
  });

  it('keeps the journal when folding it in fails, rather than losing the edit', async () => {
    await store.save(ws('saved'));
    await store.load();
    store.saveSync(ws('precious'));

    kv.full = true;
    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('precious');
    expect(anyJournal()).not.toBeNull();
  });

  it('does NOT replay a journal belonging to a different design', async () => {
    const a = await lib.create('A', ws('a'));
    const b = await lib.create('B', ws('b')); // create() makes B active

    // A journal left over from editing A, while B is what is now open.
    localStorage.setItem(UNLOAD_KEY, JSON.stringify({ id: a.id, w: ws('a-unsaved') }));

    // Replaying it would overwrite an unrelated rocket.
    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('b');
    expect(nameOf(await lib.read(b.id))).toBe('b');
    // Kept for A, which opens with it.
    expect(anyJournal()).not.toBeNull();
    expect(nameOf(await new LibraryWorkspaceStore().openActive(a.id))).toBe('a-unsaved');
    expect(anyJournal()).toBeNull();
  });

  it('drops a journal whose design is gone', async () => {
    const a = await lib.create('A', ws('a'));
    await lib.create('B', ws('b'));
    localStorage.setItem(UNLOAD_KEY, JSON.stringify({ id: a.id, w: ws('a-unsaved') }));
    await lib.remove(a.id);

    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('b');
    expect(anyJournal()).toBeNull();
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
    const journal = JSON.parse(anyJournal()!) as { w: Workspace };
    expect(journal.w.sims[0]!.result).toBeNull();
  });
});

/**
 * A journal written before the first save carries a null id, because that is
 * all `saveSync` has to record at that point.
 *
 * It matches no design, so `load` replays it by creating one. Left unmatched,
 * work done before the first debounced autosave would be lost on reload even
 * though `saveSync` wrote it, and the dead blob (a whole lean workspace) would
 * sit in the ~5 MB localStorage budget forever.
 */
describe('unload journal written before the first save', () => {
  it('replays it into a NEW design instead of discarding the work', async () => {
    const kv = new FakeKv();
    setDesignLibrary(new DesignLibrary(kv));
    const store = new LibraryWorkspaceStore();

    // Nothing saved yet: the page is torn down mid-edit.
    store.saveSync(ws('typed-before-first-autosave'));
    expect(anyJournal()).not.toBeNull();

    const loaded = await new LibraryWorkspaceStore().load();
    expect(loaded).not.toBeNull();
    expect(loaded!.tree.components[0]!.name).toBe('typed-before-first-autosave');

    // It is now a real design, and the journal is spent.
    expect(await new DesignLibrary(kv).list()).toHaveLength(1);
    expect(anyJournal()).toBeNull();
  });

  /**
   * A tab with no design yet is hidden (the journal, with the id its first
   * create will use), then comes back and its first save creates the design
   * with newer work. That journal is dropped, so a session that ends with no
   * pagehide reopens the saved work rather than the hide's.
   */
  it('drops the journal once the first create lands with newer work', async () => {
    const kv = new FakeKv();
    setDesignLibrary(new DesignLibrary(kv));
    const store = new LibraryWorkspaceStore();

    store.saveSync(ws('at-the-hide'));
    await store.save(ws('typed-after-coming-back'));
    // No pagehide: the session ends here.

    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('typed-after-coming-back');
    expect(await new DesignLibrary(kv).list()).toHaveLength(1);
  });

  // The create fails on a full store, which is the failure the journal exists
  // for. Cleared first, the only copy of the work would be gone and the app
  // would open the default rocket.
  it('keeps the journal and opens its work when the create is refused', async () => {
    const kv = new FakeKv();
    setDesignLibrary(new DesignLibrary(kv));
    new LibraryWorkspaceStore().saveSync(ws('typed-before-first-autosave'));

    kv.full = true;
    const loaded = await new LibraryWorkspaceStore().load();
    expect(nameOf(loaded)).toBe('typed-before-first-autosave');
    expect(anyJournal()).not.toBeNull();

    // Once storage has room, the next load stores it.
    kv.full = false;
    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('typed-before-first-autosave');
    expect(await new DesignLibrary(kv).list()).toHaveLength(1);
    expect(anyJournal()).toBeNull();
  });

  it('clears the journal even when it cannot be replayed', async () => {
    const kv = new FakeKv();
    setDesignLibrary(new DesignLibrary(kv));
    // A blob that parses but is not a workspace this build can open.
    localStorage.setItem(UNLOAD_KEY, JSON.stringify({ id: null, w: { version: 99 } }));

    await new LibraryWorkspaceStore().load();

    // Left in place it would sit there forever, holding a slice of a 5 MB budget.
    expect(anyJournal()).toBeNull();
  });
});

/**
 * New and import detach the store while the library still points at the design
 * that was open. A reload inside the autosave debounce finds that design active,
 * and the journal is the only copy of the new one.
 */
describe('unload journal of a design started while another was open', () => {
  const start = async () => {
    await store.save(ws('previous'));
    await store.load();
    const previous = kv.map.get(nsKey('designs:active'))!;
    store.setActiveId(null);
    store.setPendingName('Imported Name');
    return previous;
  };

  it('replays it into a new design rather than reopening the previous one', async () => {
    const previous = await start();
    store.saveSync(ws('new-design'));

    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('new-design');
    const list = await lib.list();
    expect(list).toHaveLength(2);
    expect(list.find((m) => m.id !== previous)!.name).toBe('Imported Name');
    expect(kv.map.get(nsKey('designs:active'))).not.toBe(previous);
    expect(nameOf(await lib.read(previous))).toBe('previous');
    expect(anyJournal()).toBeNull();
  });

  it('does not create it twice when the tab’s own create landed after the journal', async () => {
    await start();
    // `onHidden` writes the journal and starts the save that creates the entry.
    const saving = store.save(ws('new-design'));
    store.saveSync(ws('new-design-edited'));
    await saving;

    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('new-design-edited');
    expect(await lib.list()).toHaveLength(2);
    expect(anyJournal()).toBeNull();
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
    expect(anyJournal()).toBeNull();
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
    const j = JSON.parse(anyJournal()!) as { t?: number };
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
    expect(anyJournal()).toBeNull();
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

  /**
   * Each hide writes the journal. A save that began after it holds newer work,
   * so once that save lands the journal is dropped; left behind, a session that
   * ends with no final pagehide (a crash, a killed process) would reopen the
   * design as it was at that hide.
   */
  it('is dropped once a later save of the tab lands, so a crash does not roll it back', async () => {
    later();
    tabA.saveSync(ws('at-the-hide'));
    later();
    await tabA.save(ws('typed-after-coming-back'));
    // No pagehide: the session ends here.

    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('typed-after-coming-back');
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

/**
 * A read that fails at boot is not an empty library. Read as one, the journal
 * looks like it belongs to a design that no longer exists and is dropped: the
 * user's last unsaved work, gone on a transient IndexedDB error.
 */
describe('a library that cannot be read at boot', () => {
  /** `get` answers null on a failed read, as the IndexedDB store does; `getChecked` rejects. */
  class FlakyKv extends FakeKv {
    broken = false;
    override async get(k: string) {
      return this.broken ? null : await super.get(k);
    }
    async getChecked(k: string) {
      if (this.broken) throw new Error('IndexedDB read failed');
      return await super.get(k);
    }
  }

  it('keeps the journal, opens its work, and does not let this session overwrite it', async () => {
    const flaky = new FlakyKv();
    const flakyLib = new DesignLibrary(flaky);
    setDesignLibrary(flakyLib);
    const a = await flakyLib.create('A', ws('saved'));
    localStorage.setItem(UNLOAD_KEY, JSON.stringify({ id: a.id, w: ws('unsaved') }));

    flaky.broken = true;
    setDesignLibrary(new DesignLibrary(flaky));
    const session = new LibraryWorkspaceStore();
    expect(nameOf(await session.load())).toBe('unsaved');
    expect(JSON.parse(anyJournal()!).id).toBe(a.id);
    session.saveSync(ws('default-rocket'));
    expect(nameOf(JSON.parse(anyJournal()!).w)).toBe('unsaved');

    // Read again once storage answers: the journal replays into its design.
    flaky.broken = false;
    setDesignLibrary(new DesignLibrary(flaky));
    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('unsaved');
  });

  it('opens empty when there is no journal to keep', async () => {
    const flaky = new FlakyKv();
    setDesignLibrary(new DesignLibrary(flaky));
    flaky.broken = true;
    await expect(new LibraryWorkspaceStore().load()).resolves.toBeNull();
  });
});

/**
 * Two tabs on different designs each write their journal at unload. Each is
 * the only copy of its tab's last edits, so neither may overwrite the other,
 * and a boot that opens one design keeps the other's until it is opened.
 */
describe('unload journals of two tabs on different designs', () => {
  it('keeps both, replaying each into its own design', async () => {
    const tabA = new LibraryWorkspaceStore();
    await tabA.save(ws('a'));
    await tabA.load();
    const a = kv.map.get(nsKey('designs:active'))!;
    const tabB = new LibraryWorkspaceStore();
    tabB.setActiveId(null);
    await tabB.save(ws('b'));
    const b = (await lib.list()).find((m) => m.id !== a)!.id;

    // Both tabs close inside their autosave debounce.
    tabA.saveSync(ws('a-unsaved'));
    tabB.saveSync(ws('b-unsaved'));

    await lib.setActive(a);
    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('a-unsaved');
    expect(nameOf(await new LibraryWorkspaceStore().openActive(b))).toBe('b-unsaved');
    expect(nameOf(await lib.read(a))).toBe('a-unsaved');
    expect(nameOf(await lib.read(b))).toBe('b-unsaved');
    expect(journalKeys()).toEqual([]);
  });
});

/**
 * A hidden tab saves and journals the same workspace. When the save lands the
 * journal holds nothing the entry does not, so opening the design must not
 * write it again: a write stamps `updatedAt`, and the library lists the most
 * recently updated first.
 */
describe('a journal of what the design already holds', () => {
  it('is dropped without re-stamping the design', async () => {
    const tab = new LibraryWorkspaceStore();
    await tab.save(ws('x'));
    await tab.load();
    const id = kv.map.get(nsKey('designs:active'))!;
    // The hide: the save starts, then the journal, then the save lands.
    const saving = tab.save(ws('edited'));
    tab.saveSync(ws('edited'));
    await saving;
    const stamped = (await lib.list()).find((m) => m.id === id)!.updatedAt;

    await new Promise((r) => setTimeout(r, 5));
    expect(nameOf(await new LibraryWorkspaceStore().load())).toBe('edited');
    expect((await lib.list()).find((m) => m.id === id)!.updatedAt).toBe(stamped);
    expect(journalKeys()).toEqual([]);
  });
});
