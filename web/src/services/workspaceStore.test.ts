import { describe, it, expect, beforeEach } from 'vitest';
import { KeyValueWorkspaceStore, type Workspace } from './workspaceStore';
import type { KeyValueStore } from './keyValueStore';

class FakeKv implements KeyValueStore {
  map = new Map<string, string>();
  async get(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  async set(k: string, v: string) {
    this.map.set(k, v);
  }
  async remove(k: string) {
    this.map.delete(k);
  }
}

// The store's private key (workspaceStore.ts). Hardcoded so we can seed raw blobs.
const KEY = 'astrarrocketjs:workspace';

const workspace = (): Workspace =>
  ({
    version: 1,
    tree: { components: [] },
    sims: [{ id: 's1', name: 'Flight', motor: {}, launch: {}, result: { series: {} } }],
    activeId: 's1',
    extraMotors: {},
    loadedMeta: null,
  }) as unknown as Workspace;

let kv: FakeKv;
let store: KeyValueWorkspaceStore;
beforeEach(() => {
  kv = new FakeKv();
  store = new KeyValueWorkspaceStore(kv);
});

describe('KeyValueWorkspaceStore', () => {
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

  it('strips cached flight results on save', async () => {
    await store.save(workspace());
    const w = await store.load();
    expect(w!.sims[0]!.result).toBeNull(); // recomputable → not persisted
  });

  it('clear() removes the saved workspace', async () => {
    await store.save(workspace());
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('rejects corrupt or invalid stored data', async () => {
    await kv.set(KEY, '{bad json');
    expect(await store.load()).toBeNull();

    await kv.set(KEY, JSON.stringify({ ...workspace(), version: 2 })); // wrong version
    expect(await store.load()).toBeNull();

    await kv.set(KEY, JSON.stringify({ version: 1, sims: [{ id: 'x' }] })); // no tree
    expect(await store.load()).toBeNull();

    await kv.set(KEY, JSON.stringify({ version: 1, tree: { components: [] }, sims: [] })); // empty sims
    expect(await store.load()).toBeNull();
  });
});
