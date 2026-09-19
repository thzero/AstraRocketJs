// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { LibraryWorkspaceStore, type Workspace } from './workspaceStore';
import { DesignLibrary, setDesignLibrary } from './designLibrary';
import type { KeyValueStore } from './keyValueStore';

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
}

const workspace = (): Workspace =>
  ({
    version: 1,
    tree: { components: [] },
    sims: [{ id: 's1', name: 'Flight', motor: {}, launch: {}, result: { series: {} } }],
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
    const ran = { ...w, sims: [{ ...w.sims[0]!, result: { series: { time: [1] } } }] } as unknown as Workspace;
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
