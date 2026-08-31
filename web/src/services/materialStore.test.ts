import { describe, it, expect, beforeEach } from 'vitest';
import { KeyValueMaterialStore } from './materialStore';
import type { KeyValueStore } from './keyValueStore';
import type { Material } from '../data/materials';

class FakeKv implements KeyValueStore {
  map = new Map<string, string>();
  async get(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  async set(k: string, v: string) { this.map.set(k, v); }
  async remove(k: string) { this.map.delete(k); }
}

const KEY = 'materials:custom';
const mat = (name: string, density = 1000): Material => ({ name, type: 'bulk', density } as Material);

let kv: FakeKv;
let store: KeyValueMaterialStore;
beforeEach(() => { kv = new FakeKv(); store = new KeyValueMaterialStore(KEY, kv); });

describe('KeyValueMaterialStore', () => {
  it('starts empty', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('adds materials newest-first and stamps custom:true', async () => {
    await store.add(mat('Balsa', 160));
    await store.add(mat('Birch', 680));
    const list = await store.list();
    expect(list.map((m) => m.name)).toEqual(['Birch', 'Balsa']);
    expect(list.every((m) => m.custom === true)).toBe(true);
  });

  it('replaces an existing material by name+type', async () => {
    await store.add(mat('Balsa', 160));
    await store.add(mat('Balsa', 170)); // same name+type → replace, not duplicate
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.density).toBe(170);
  });

  it('removes by name+type', async () => {
    await store.add(mat('Balsa', 160));
    await store.remove('Balsa', 'bulk');
    expect(await store.list()).toEqual([]);
  });

  it('returns [] on corrupt or non-array JSON', async () => {
    await kv.set(KEY, '{not json');
    expect(await store.list()).toEqual([]);
    await kv.set(KEY, '{"a":1}');
    expect(await store.list()).toEqual([]);
  });

  it('filters out invalid rows from stored data', async () => {
    await kv.set(KEY, JSON.stringify([
      { name: 'Balsa', type: 'bulk', density: 160 },
      { name: 'no-density' },
      { type: 'bulk', density: Number.NaN },
    ]));
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('Balsa');
  });
});
