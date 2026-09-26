// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { LibraryWorkspaceStore, type Workspace } from '../../src/services/workspaceStore';
import { DesignLibrary, setDesignLibrary } from '../../src/services/designLibrary';
import type { KeyValueStore } from '../../src/services/keyValueStore';

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
   * ATOMIC, like the real IndexedDB transaction behind it.
   *
   * It used to be a plain `get` then `set` with an await in between, so two
   * overlapping index mutations each read the same list and the second
   * clobbered the first. That is not what the store does - and it hid the
   * duplicate-entry bug below, because three concurrent creates left one
   * surviving index row and the test read that as "one design".
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
 * It used to be the stub `{ series: {} }`, which was enough while nothing
 * validated stored results. `DesignLibrary.readResults` now shape-checks every
 * entry (a stored `NaN` comes back as `null` and threw in the exporters), so a
 * fixture has to look like a flight the app could actually have produced.
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
 *  `:results` is excluded along with the index and active keys — the flights
 *  live beside the design under the same prefix. */
const designKey = (kv: FakeKv) =>
  [...kv.map.keys()].find(
    (k) =>
      k.startsWith('astrarrocketjs:designs:') &&
      !k.endsWith(':index') &&
      !k.endsWith(':active') &&
      !k.endsWith(':results'),
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
   * Overlapping FIRST saves are one design, not one each.
   *
   * Every save that finds no active id used to call `lib.create()`, and the
   * first create is the slowest write the app makes. The 500 ms autosave
   * debounce can fire again inside it, and the `visibilitychange` flush saves
   * outside the debounce entirely - so tabbing away just after an import left
   * the library holding several identical rockets, all but one of them
   * orphaned, which is what File > Open was full of.
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
   * claiming it would send the NEW design's autosaves over the old one.
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
    expect((await new DesignLibrary(kv).list()).map((m) => m.name)).toEqual(['My Rocket', 'Once']);
  });

  /**
   * Flights persist, but NOT inside the design blob.
   *
   * They used to be dropped entirely, so a reload lost every run. They are stored
   * now — under their own key, because the design blob is rewritten on every
   * keystroke's debounced autosave and a result is tens of thousands of samples.
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

    // A new result object IS a change.
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
   * A design that is THERE but unreadable is not the same as no design.
   *
   * `load()` used to return null for both, so the hydration gate opened with
   * the default rocket and the autosave wrote it over the unreadable design AT
   * THE SAME ID 500 ms after the first edit. It now throws — which the effects
   * hook already handles by raising the load-failed warning — and detaches, so
   * the next save creates a new entry instead of finishing the overwrite.
   */
  it.each([
    ['unparseable', '{bad json'],
    ['a newer schema version', JSON.stringify({ version: 2, tree: { components: [] }, sims: [{ id: 's1' }] })],
    ['no tree', JSON.stringify({ version: 1, sims: [{ id: 'x' }] })],
    ['a non-array tree.components', JSON.stringify({ version: 1, tree: {}, sims: [{ id: 's1' }] })],
    ['no sims', JSON.stringify({ version: 1, tree: { components: [] }, sims: [] })],
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

    // The next save must land somewhere NEW. The unreadable bytes stay put, so
    // whatever can be recovered by hand still can be.
    await store.save(workspace());
    expect(kv.map.get(originalKey)).toBe(corrupt);
    // DESIGN blobs, so `:results` is excluded along with the index and active
    // keys: the flights live beside each design under the same prefix.
    const keys = [...kv.map.keys()].filter(
      (k) =>
        k.startsWith('astrarrocketjs:designs:') &&
        !k.endsWith(':index') &&
        !k.endsWith(':active') &&
        !k.endsWith(':results'),
    );
    expect(keys).toHaveLength(2);
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
