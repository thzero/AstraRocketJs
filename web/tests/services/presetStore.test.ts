import { describe, it, expect } from 'vitest';
import { KeyValuePresetStore, type CustomPart } from '../../src/services/presetStore';
import type { KeyValueStore } from '../../src/services/keyValueStore';

class FakeKv implements KeyValueStore {
  map = new Map<string, string>();
  async get(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  async set(k: string, v: string) {
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

const KEY = 'astrarrocketjs:parts:custom';
const part = (partNo: string, length = 0.2): CustomPart => ({
  id: `custom:bodytube:Mine:${partNo}`,
  type: 'bodytube',
  mfr: 'Mine',
  partNo,
  desc: '',
  node: { length, outerRadius: 0.013, thickness: 0.0005 },
});

describe('KeyValuePresetStore', () => {
  it('adds, lists (newest first), and removes by id', async () => {
    const store = new KeyValuePresetStore(KEY, new FakeKv());
    await store.add(part('a'));
    await store.add(part('b'));
    expect((await store.list()).map((p) => p.partNo)).toEqual(['b', 'a']);
    await store.remove('custom:bodytube:Mine:a');
    expect((await store.list()).map((p) => p.partNo)).toEqual(['b']);
  });

  it('replaces a part saved again under the same id', async () => {
    const store = new KeyValuePresetStore(KEY, new FakeKv());
    await store.add(part('x', 0.2));
    await store.add(part('x', 0.3));
    const list = await store.list();
    expect(list.length).toBe(1);
    expect(list[0]!.node.length).toBe(0.3);
  });

  it('keeps the whole node, not just the dimensions the picker lists', async () => {
    const store = new KeyValuePresetStore(KEY, new FakeKv());
    const saved: CustomPart = {
      ...part('shouldered'),
      type: 'nosecone',
      node: {
        shape: 'ogive',
        length: 0.1,
        aftRadius: 0.013,
        thickness: 0.001,
        shoulderLength: 0.03,
        shoulderRadius: 0.012,
        color: '#ff0000',
      },
    };
    await store.add(saved);
    expect((await store.list())[0]!.node).toEqual(saved.node);
  });

  it('survives a corrupt store entry', async () => {
    const kv = new FakeKv();
    await kv.set(KEY, '{not json');
    expect(await new KeyValuePresetStore(KEY, kv).list()).toEqual([]);
  });

  it('drops a malformed row without losing the rest', async () => {
    const kv = new FakeKv();
    // `node` missing on the first, not an object on the second.
    await kv.set(KEY, JSON.stringify([{ id: 'a', type: 'bodytube', mfr: 'm', partNo: 'p', desc: '' }, part('good')]));
    const list = await new KeyValuePresetStore(KEY, kv).list();
    expect(list.map((p) => p.partNo)).toEqual(['good']);
  });

  it('returns an empty list when the storage layer itself rejects', async () => {
    const kv = new FakeKv();
    kv.get = async () => {
      throw new Error('IndexedDB blocked');
    };
    // The component picker reads this beside the catalog fetch; a store that
    // throws must not take the whole picker down.
    expect(await new KeyValuePresetStore(KEY, kv).list()).toEqual([]);
  });
});

describe('writes go through kv.update', () => {
  it('adds and removes in one store transaction each, and propagates a refusal', async () => {
    const kv = new FakeKv();
    const store = new KeyValuePresetStore(KEY, kv);
    const updates: string[] = [];
    kv.update = async (k, fn) => {
      updates.push(k);
      const next = fn(kv.map.get(k) ?? null);
      if (next === null) kv.map.delete(k);
      else kv.map.set(k, next);
      return true;
    };
    kv.set = async () => {
      throw new Error('set() must not be used for a read-modify-write');
    };
    await store.add(part('a'));
    await store.remove('custom:bodytube:Mine:a');
    expect(updates).toEqual([KEY, KEY]);
    expect(await store.list()).toEqual([]);

    kv.update = async () => false;
    await expect(store.add(part('b'))).rejects.toThrow('storage-full');
  });

  it('setPresetStore swaps the active store', async () => {
    const { getPresetStore, setPresetStore } = await import('../../src/services/presetStore');
    const before = getPresetStore();
    const mine = { list: async () => [part('mine')] } as unknown as typeof before;
    setPresetStore(mine);
    try {
      expect(getPresetStore()).toBe(mine);
    } finally {
      setPresetStore(before);
    }
  });
});
