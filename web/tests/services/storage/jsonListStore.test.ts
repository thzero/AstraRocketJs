import { describe, it, expect } from 'vitest';
import { JsonListStore, parseJsonList } from '../../../src/services/storage/jsonListStore';
import type { KeyValueStore } from '../../../src/services/storage/keyValueStore';
import { KeyValueTemplateStore } from '../../../src/services/exports/templateStore';
import { KeyValuePresetStore } from '../../../src/services/parts/presetStore';
import { KeyValueMaterialStore } from '../../../src/services/materials/materialStore';
import { KeyValueLaunchLocationStore } from '../../../src/services/storage/launchLocationStore';
import { KeyValueMotorStore } from '../../../src/services/motors/motorStore';

class FakeKv implements KeyValueStore {
  map = new Map<string, string>();
  refuse = false;
  async get(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  async set(k: string, v: string) {
    if (this.refuse) return false;
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

/** A store whose reads reject, the way blocked IndexedDB does. */
class RejectingKv extends FakeKv {
  override async get(): Promise<string | null> {
    throw new Error('IndexedDB blocked');
  }
}

interface Item {
  id: string;
  n: number;
}
const isItem = (v: unknown): v is Item =>
  !!v && typeof (v as Item).id === 'string' && typeof (v as Item).n === 'number';
const KEY = 'test:list';
const make = (kv: KeyValueStore, normalize?: (i: Item) => Item) =>
  new JsonListStore<Item>(KEY, isItem, (i) => i.id, kv, normalize);

describe('parseJsonList', () => {
  it('reads absent, corrupt and non-array blobs as empty', () => {
    expect(parseJsonList(null, isItem)).toEqual([]);
    expect(parseJsonList('', isItem)).toEqual([]);
    expect(parseJsonList('{not json', isItem)).toEqual([]);
    expect(parseJsonList('{"id":"a","n":1}', isItem)).toEqual([]);
  });

  it('drops the rows that fail the check and keeps the rest', () => {
    expect(parseJsonList(JSON.stringify([{ id: 'a', n: 1 }, { id: 'b' }, null, { id: 'c', n: 3 }]), isItem)).toEqual([
      { id: 'a', n: 1 },
      { id: 'c', n: 3 },
    ]);
  });
});

describe('JsonListStore', () => {
  it('adds at the head, replacing by id, and removes by id', async () => {
    const kv = new FakeKv();
    const store = make(kv);
    await store.upsert([{ id: 'a', n: 1 }]);
    await store.upsert([{ id: 'b', n: 2 }]);
    await store.upsert([{ id: 'a', n: 3 }]);
    expect(await store.list()).toEqual([
      { id: 'a', n: 3 },
      { id: 'b', n: 2 },
    ]);
    await store.upsert([
      { id: 'c', n: 4 },
      { id: 'b', n: 5 },
    ]);
    expect(await store.list()).toEqual([
      { id: 'c', n: 4 },
      { id: 'b', n: 5 },
      { id: 'a', n: 3 },
    ]);
    await store.remove('b');
    expect(await store.list()).toEqual([
      { id: 'c', n: 4 },
      { id: 'a', n: 3 },
    ]);
  });

  it('stores a plain JSON array under its key', async () => {
    const kv = new FakeKv();
    await make(kv).upsert([{ id: 'a', n: 1 }]);
    expect(JSON.parse(kv.map.get(KEY)!)).toEqual([{ id: 'a', n: 1 }]);
  });

  it('normalizes every row read back', async () => {
    const kv = new FakeKv();
    kv.map.set(KEY, JSON.stringify([{ id: 'a', n: 1 }]));
    const store = make(kv, (i) => ({ ...i, n: i.n * 10 }));
    expect(await store.list()).toEqual([{ id: 'a', n: 10 }]);
  });

  it('rejects a refused write with storage-full', async () => {
    const kv = new FakeKv();
    kv.refuse = true;
    const store = make(kv);
    await expect(store.upsert([{ id: 'a', n: 1 }])).rejects.toThrow('storage-full');
    await expect(store.remove('a')).rejects.toThrow('storage-full');
  });

  it('lists as empty when the storage layer rejects the read', async () => {
    expect(await make(new RejectingKv()).list()).toEqual([]);
  });
});

describe('every list store survives a storage layer that rejects reads', () => {
  // The dialogs and pickers that list these read them on open; a rejecting
  // read must cost the user's own entries, not the dialog.
  it.each([
    ['templates', () => new KeyValueTemplateStore('k', new RejectingKv()).list()],
    ['saved parts', () => new KeyValuePresetStore('k', new RejectingKv()).list()],
    ['materials', () => new KeyValueMaterialStore('k', new RejectingKv()).list()],
    ['launch locations', () => new KeyValueLaunchLocationStore('k', new RejectingKv()).list()],
    ['custom motors', () => new KeyValueMotorStore(new RejectingKv()).listCustomMotors()],
  ])('%s', async (_name, list) => {
    expect(await list()).toEqual([]);
  });
});
