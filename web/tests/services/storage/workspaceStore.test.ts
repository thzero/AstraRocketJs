import { nsKey } from '../../../src/services/storage/storageKeys';
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { LibraryWorkspaceStore, lean, resultsOf, type Workspace } from '../../../src/services/storage/workspaceStore';
import { DesignLibrary, getDesignLibrary, setDesignLibrary } from '../../../src/services/storage/designLibrary';
import type { KeyValueStore } from '../../../src/services/storage/keyValueStore';
import { defaultDesignName } from '../../../src/services/app/appInfo';

class FakeKv implements KeyValueStore {
  map = new Map<string, string>();
  full = false; // simulate quota exceeded → set() reports failure
  async get(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  async set(k: string, v: string) {
    if (this.full) return false;
    this.map.set(k, v);
    return true;
  }
  async remove(k: string) {
    this.map.delete(k);
  }
  /**
   * Atomic, like the real IndexedDB transaction behind it.
   *
   * A plain `get` then `set` with an await in between is not what the store does,
   * and it lets two overlapping index mutations read the same list so the second
   * clobbers the first. That also hides the duplicate-entry case below: three
   * concurrent creates leave one surviving index row, which reads as "one design".
   */
  private lock: Promise<unknown> = Promise.resolve();
  async update(k: string, fn: (raw: string | null) => string | null) {
    const prev = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((r) => (release = r));
    await prev;
    try {
      const next = fn(this.map.get(k) ?? null);
      if (next === null) {
        this.map.delete(k);
        return true;
      }
      return await this.set(k, next);
    } finally {
      release();
    }
  }
}

/**
 * A plausible flight result.
 *
 * Not the stub `{ series: {} }`: `DesignLibrary.readResults` shape-checks every
 * entry (a stored `NaN` comes back as `null`, which throws in the exporters), so
 * a fixture has to look like a flight the app could have produced.
 */
const flight = (time: number[] = [0, 1]) =>
  ({
    summary: {
      maxAltitude: 120,
      maxVelocity: 60,
      maxAcceleration: 90,
      maxMachNumber: 0.18,
      timeToApogee: 4.5,
      flightTime: 30,
      groundHitVelocity: 5,
      launchRodVelocity: 18,
      deploymentVelocity: null,
      optimumDelay: null,
    },
    events: [],
    series: {
      time,
      altitude: time.map(() => 1),
      velocity: time.map(() => 1),
      acceleration: time.map(() => 1),
      mass: time.map(() => 1),
      thrust: time.map(() => 1),
      drag: time.map(() => 1),
      mach: time.map(() => 1),
    },
  }) as unknown as NonNullable<Workspace['sims'][number]['result']>;

const workspace = (): Workspace =>
  ({
    version: 1,
    tree: { components: [] },
    sims: [{ id: 's1', name: 'Flight', motor: {}, launch: {}, result: flight() }],
    activeId: 's1',
    extraMotors: {},
    loadedMeta: null,
  }) as unknown as Workspace;

/** Raw key of the one design in the library, for seeding corrupt blobs.
 *  `:results` is excluded along with the index and active keys: the flights
 *  live beside the design under the same prefix. */
const designKey = (kv: FakeKv) =>
  [...kv.map.keys()].find(
    (k) =>
      k.startsWith(nsKey('designs:')) && !k.endsWith(':index') && !k.endsWith(':active') && !k.endsWith(':results'),
  )!;

let kv: FakeKv;
let store: LibraryWorkspaceStore;
beforeEach(() => {
  kv = new FakeKv();
  setDesignLibrary(new DesignLibrary(kv));
  store = new LibraryWorkspaceStore();
  localStorage.clear();
});

describe('LibraryWorkspaceStore', () => {
  it('load() is null when nothing is stored', async () => {
    expect(await store.load()).toBeNull();
  });

  it('round-trips a saved workspace', async () => {
    await store.save(workspace());
    const w = await store.load();
    expect(w).not.toBeNull();
    expect(w!.activeId).toBe('s1');
    expect(w!.sims).toHaveLength(1);
  });

  it('creates a library entry on the first save', async () => {
    await store.save(workspace());
    expect(await new DesignLibrary(kv).list()).toHaveLength(1);
  });

  it('keeps saving into the SAME design rather than adding one per save', async () => {
    await store.save(workspace());
    await store.save(workspace());
    await store.save(workspace());
    expect(await new DesignLibrary(kv).list()).toHaveLength(1);
  });

  /**
   * The autosave slot is shared between tabs.
   *
   * Two tabs of an installed PWA open the same design, because both open
   * whatever was active, and each autosaves its own copy on a 500 ms debounce.
   * Writing unconditionally would make the last writer win: one edit in a tab
   * left open yesterday would silently overwrite a day's work in the other, and
   * once that tab closed there would be nothing left to recover from.
   *
   * A second store instance is a second tab here: the claim a tab holds on an
   * entry is per instance, which is exactly the thing two tabs do not share.
   */
  describe('a design changed by another tab', () => {
    /** Both tabs on the same design, each having seen it as it was. */
    const twoTabs = async () => {
      await store.save(workspace());
      const other = new LibraryWorkspaceStore();
      await other.load();
      await store.load();
      return other;
    };

    it('refuses to write over it, rather than overwriting silently', async () => {
      const other = await twoTabs();
      await other.save({ ...workspace(), activeId: 'theirs' });
      await expect(store.save({ ...workspace(), activeId: 'mine' })).rejects.toThrow('conflict');
    });

    it('leaves the other tab’s work in the library', async () => {
      const other = await twoTabs();
      await other.save({ ...workspace(), activeId: 'theirs' });
      await store.save({ ...workspace(), activeId: 'mine' }).catch(() => {});
      expect((await new LibraryWorkspaceStore().load())!.activeId).toBe('theirs');
    });

    it('keeps refusing, because the edits are still unsaved', async () => {
      // Not a warn-once: writing on the next keystroke would destroy exactly
      // what the first refusal was protecting.
      const other = await twoTabs();
      await other.save({ ...workspace(), activeId: 'theirs' });
      await store.save(workspace()).catch(() => {});
      await expect(store.save(workspace())).rejects.toThrow('conflict');
    });

    it('does not refuse a tab saving over its own writes', async () => {
      // The ordinary case, and the one that must not become a false alarm.
      await store.save(workspace());
      await store.save(workspace());
      await expect(store.save(workspace())).resolves.toBeUndefined();
    });

    // The compare is made inside the index write. Made on an earlier read, two
    // tabs saving at once both pass it, and the last writer wins after all.
    it('lets only one of two tabs saving at once write', async () => {
      const other = await twoTabs();
      const outcomes = await Promise.allSettled([
        store.save({ ...workspace(), activeId: 'mine' }),
        other.save({ ...workspace(), activeId: 'theirs' }),
      ]);
      expect(outcomes.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected']);
    });

    // The unload journal is stamped later than the other tab's save, so the next
    // load would replay this tab's stale design over the newer work.
    it('writes no unload journal once a save has been refused', async () => {
      const other = await twoTabs();
      await other.save({ ...workspace(), activeId: 'theirs' });
      await store.save({ ...workspace(), activeId: 'mine' }).catch(() => {});
      store.saveSync({ ...workspace(), activeId: 'mine' });
      const unload = nsKey('designs:unload');
      const journals = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).filter(
        (k) => k === unload || k.startsWith(`${unload}:`),
      );
      expect(journals).toEqual([]);
      expect((await new LibraryWorkspaceStore().load())!.activeId).toBe('theirs');
    });

    // The autosave and the hidden-tab flush overlap. Run together, the second
    // would read the first one's new stamp as another tab's.
    it('does not refuse two overlapping saves from the same tab', async () => {
      await store.save(workspace());
      await expect(Promise.all([store.save(workspace()), store.save(workspace())])).resolves.toBeDefined();
    });

    // A save made before a switch, still waiting its turn when the switch
    // lands, runs under the claim it was made with. Read after the switch, the
    // claim is gone and the save writes over the other tab's work.
    it('keeps the claim of a save queued before a switch', async () => {
      const other = await twoTabs();
      await other.save({ ...workspace(), activeId: 'theirs' });
      const queued = [
        store.save({ ...workspace(), activeId: 'mine' }),
        store.save({ ...workspace(), activeId: 'mine2' }),
      ];
      store.setActiveId(null);
      await Promise.allSettled(queued);
      expect((await new LibraryWorkspaceStore().load())!.activeId).toBe('theirs');
    });

    it('still writes a queued save to its own design after a switch', async () => {
      await store.save(workspace());
      await store.load();
      const queued = [store.save({ ...workspace(), activeId: 'one' }), store.save({ ...workspace(), activeId: 'two' })];
      store.setActiveId(null);
      await Promise.all(queued);
      expect((await new LibraryWorkspaceStore().load())!.activeId).toBe('two');
    });

    // The save claims the entry's stamp before it writes the blob. A tab that
    // opens the design in between reads the old blob; the stamp moves again
    // after the blob, so that tab's next save is refused instead of writing the
    // old design back.
    it('refuses a tab that read the old blob while a save was writing', async () => {
      const other = await twoTabs();
      const lib = new DesignLibrary(kv);
      const id = (await lib.activeId())!;
      const realSet = kv.set.bind(kv);
      let reader: LibraryWorkspaceStore | null = null;
      kv.set = async (k: string, v: string) => {
        if (k.endsWith(id) && !reader) {
          // Between the claim and the blob: another tab opens the design.
          reader = new LibraryWorkspaceStore();
          await reader.load();
        }
        return await realSet(k, v);
      };
      await other.save({ ...workspace(), activeId: 'theirs' });
      kv.set = realSet;
      await expect(reader!.save({ ...workspace(), activeId: 'stale' })).rejects.toThrow('conflict');
      expect((await new LibraryWorkspaceStore().load())!.activeId).toBe('theirs');
    });

    it('does not refuse after switching to a different design', async () => {
      // A switch drops the claim with everything else about the old entry.
      const other = await twoTabs();
      await other.save({ ...workspace(), activeId: 'theirs' });
      store.setActiveId(null);
      await expect(store.save(workspace())).resolves.toBeUndefined();
    });
  });

  /**
   * Overlapping first saves are one design, not one each.
   *
   * A save that finds no active id must not call `lib.create()` unconditionally:
   * the first create is the slowest write the app makes, the 500 ms autosave
   * debounce can fire again inside it, and the `visibilitychange` flush saves
   * outside the debounce entirely. So tabbing away just after an import leaves the
   * library holding several identical rockets, all but one orphaned.
   */
  it('creates ONE design when first saves overlap', async () => {
    await Promise.all([store.save(workspace()), store.save(workspace()), store.save(workspace())]);
    expect(await new DesignLibrary(kv).list()).toHaveLength(1);
  });

  it('writes the later of two overlapping first saves into the created design', async () => {
    const second = { ...workspace(), activeId: 'later' } as unknown as Workspace;
    await Promise.all([store.save(workspace()), store.save(second)]);
    const lib = new DesignLibrary(kv);
    const [meta] = await lib.list();
    expect((await lib.read(meta!.id))!.activeId).toBe('later');
  });

  /**
   * A create that lands after the workspace has been replaced must not adopt
   * its id: the entry it made belongs to the design that just went away, and
   * claiming it would send the new design's autosaves over the old one.
   */
  it('does not adopt a create that finished after a detach', async () => {
    const saving = store.save(workspace());
    store.setActiveId(null); // New / a second import, mid-create
    await saving;
    await store.save(workspace());
    expect(await new DesignLibrary(kv).list()).toHaveLength(2);
  });

  it('creates under the pending name when one was set', async () => {
    store.setActiveId(null);
    store.setPendingName('Big Bertha (2)');
    await store.save(workspace());
    expect((await new DesignLibrary(kv).list())[0]!.name).toBe('Big Bertha (2)');
  });

  it('forgets the pending name once it has been used', async () => {
    store.setPendingName('Once');
    await store.save(workspace());
    store.setActiveId(null);
    await store.save(workspace());
    expect((await new DesignLibrary(kv).list()).map((m) => m.name)).toEqual([defaultDesignName(), 'Once']);
  });

  /**
   * Flights persist, but not inside the design blob.
   *
   * Stored under their own key, because the design blob is rewritten on every
   * keystroke's debounced autosave and a result is tens of thousands of samples.
   * Dropped, a reload loses every run.
   */
  it('stores flight results, and keeps them out of the design blob', async () => {
    await store.save(workspace());

    const blob = kv.map.get(designKey(kv))!;
    expect(blob).not.toContain('series'); // the inputs, and only the inputs
    expect([...kv.map.keys()].some((k) => k.endsWith(':results'))).toBe(true);

    const w = await store.load();
    expect(w!.sims[0]!.result).not.toBeNull(); // …and a reload has them back
  });

  it('rewrites the flights only when a run has changed them', async () => {
    const w = workspace();
    await store.save(w);
    const key = [...kv.map.keys()].find((k) => k.endsWith(':results'))!;
    const first = kv.map.get(key);

    // Same result objects, an edit elsewhere: the flights must not be rewritten,
    // which is what keeps typing cheap.
    kv.map.set(key, 'SENTINEL');
    await store.save({ ...w, tree: { components: [{ id: 'x' }] } } as unknown as Workspace);
    expect(kv.map.get(key)).toBe('SENTINEL');

    // A new result object is a change.
    const ran = { ...w, sims: [{ ...w.sims[0]!, result: flight([1, 2]) }] } as unknown as Workspace;
    await store.save(ran);
    expect(kv.map.get(key)).not.toBe('SENTINEL');
    expect(kv.map.get(key)).not.toBe(first);
  });

  it('drops the flights when the last result goes away', async () => {
    await store.save(workspace());
    expect([...kv.map.keys()].some((k) => k.endsWith(':results'))).toBe(true);

    const cleared = { ...workspace(), sims: [{ ...workspace().sims[0]!, result: null }] } as unknown as Workspace;
    await store.save(cleared);
    // An empty map removes the key rather than storing "{}".
    expect([...kv.map.keys()].some((k) => k.endsWith(':results'))).toBe(false);
  });

  /**
   * A design that is there but unreadable is not the same as no design.
   *
   * `load()` returning null for both opens the hydration gate with the default
   * rocket, and the autosave writes it over the unreadable design at the same id
   * 500 ms after the first edit. It throws instead, which the effects hook turns
   * into the load-failed warning, and detaches, so the next save creates a new
   * entry rather than finishing the overwrite.
   */
  it.each([
    ['unparseable', '{bad json'],
    [
      'a version-2 blob with no configurations',
      JSON.stringify({ version: 2, tree: { components: [] }, sims: [{ id: 's1' }] }),
    ],
    ['no tree', JSON.stringify({ version: 1, sims: [{ id: 'x' }] })],
    ['a non-array tree.components', JSON.stringify({ version: 1, tree: {}, sims: [{ id: 's1' }] })],
    ['no sims', JSON.stringify({ version: 1, tree: { components: [] }, sims: [] })],
    ['a null simulation', JSON.stringify({ version: 1, tree: { components: [] }, sims: [{ id: 's1' }, null] })],
    [
      'a null configuration',
      JSON.stringify({ version: 2, tree: { components: [] }, sims: [{ id: 's1' }], configs: [null] }),
    ],
    ['a null component', JSON.stringify({ version: 1, tree: { components: [null] }, sims: [{ id: 's1' }] })],
  ])('throws rather than silently starting fresh over a design that is %s', async (_what, blob) => {
    await store.save(workspace());
    kv.map.set(designKey(kv), blob);
    await expect(store.load()).rejects.toThrow(/unreadable/);
  });

  it('detaches from an unreadable design so the next save does not overwrite it', async () => {
    await store.save(workspace());
    const originalKey = designKey(kv);
    const corrupt = '{bad json';
    kv.map.set(originalKey, corrupt);

    await expect(store.load()).rejects.toThrow(/unreadable/);

    // The next save must land somewhere new. The unreadable bytes stay put, so
    // whatever can be recovered by hand still can be.
    await store.save(workspace());
    expect(kv.map.get(originalKey)).toBe(corrupt);
    // Design blobs, so `:results` is excluded along with the index and active
    // keys: the flights live beside each design under the same prefix.
    const keys = [...kv.map.keys()].filter(
      (k) =>
        k.startsWith(nsKey('designs:')) && !k.endsWith(':index') && !k.endsWith(':active') && !k.endsWith(':results'),
    );
    expect(keys).toHaveLength(2);
  });

  // The claim on the entry is taken only once the read has fully succeeded. A
  // read that fails after the blob parsed (the flights, here) must leave the
  // store detached too, or the next save writes over the design with a stamp
  // that matches.
  it('detaches when the read fails after the blob has parsed', async () => {
    await store.save(workspace());
    const originalKey = designKey(kv);
    const original = kv.map.get(originalKey);
    const lib = getDesignLibrary();
    lib.readResults = () => Promise.reject(new Error('results unreadable'));

    const fresh = new LibraryWorkspaceStore();
    await expect(fresh.load()).rejects.toThrow(/results unreadable/);
    await fresh.save({ ...workspace(), tree: { components: [{ type: 'nosecone', id: 'other' }] } } as Workspace);
    expect(kv.map.get(originalKey)).toBe(original);
  });

  it('returns null, without throwing, when there is genuinely nothing saved', async () => {
    expect(await store.load()).toBeNull();
  });

  it('save() throws when storage is full instead of silently dropping work', async () => {
    await store.save(workspace()); // establish the design first
    kv.full = true;
    await expect(store.save(workspace())).rejects.toThrow(/storage-full/);
  });
});

/**
 * Opening a design from the library reads it the way boot does. A design is
 * stored lean, with its flights beside it; opened without them, every row reads
 * not run and the first save writes an empty results map over the stored one.
 * The claim is what the next save is checked against, so another tab's save in
 * between is caught rather than overwritten.
 */
describe('openActive', () => {
  const seed = async () => {
    const lib = getDesignLibrary();
    const flown = workspace();
    const meta = await lib.create('B', lean(flown));
    await lib.writeResults(meta.id, resultsOf(flown));
    return meta.id;
  };

  it('puts the stored flights back on their simulations', async () => {
    const id = await seed();
    const w = await store.openActive(id);
    expect(w?.sims[0]?.result).toEqual(flight());
  });

  it('keeps the stored flights through the first save after opening', async () => {
    const id = await seed();
    const w = (await store.openActive(id))!;
    await store.save({ ...w, tree: { components: [] } as unknown as Workspace['tree'] });
    expect((await getDesignLibrary().readResults(id))['s1']).toEqual(flight());
  });

  it("holds the claim, so another tab's save in between is not overwritten", async () => {
    const id = await seed();
    const w = (await store.openActive(id))!;
    const other = { ...w, sims: [{ ...w.sims[0]!, name: 'From the other tab' }] } as Workspace;
    await new Promise((r) => setTimeout(r, 5));
    await getDesignLibrary().write(id, 'B', lean(other), 'other-tab');
    await expect(store.save({ ...w, sims: [{ ...w.sims[0]!, name: 'From this tab' }] } as Workspace)).rejects.toThrow(
      'conflict',
    );
    expect((await getDesignLibrary().read(id))?.sims[0]?.name).toBe('From the other tab');
  });
});
