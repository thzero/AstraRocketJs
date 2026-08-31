import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KeyValueMotorStore, type CustomMotor } from './motorStore';
import type { KeyValueStore } from './keyValueStore';
import type { CatalogMotor } from './motorDb';

class FakeKv implements KeyValueStore {
  map = new Map<string, string>();
  async get(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  async set(k: string, v: string) { this.map.set(k, v); }
  async remove(k: string) { this.map.delete(k); }
}

// Private keys from motorStore.ts, hardcoded so we can seed raw entries.
const CATALOG_KEY = 'tc:catalog';
const CATALOG_SIG_KEY = 'tc:catalog:sig';

const cat: CatalogMotor[] = [
  { designation: 'C6', manufacturer: 'Estes', class: 'C', diameter: 18, impulse: 8.8, burn: 1.7, mass: 24 },
];
const custom = (id: string): CustomMotor => ({
  id, designation: 'X', manufacturer: 'Me', class: 'C', diameter: 18, length: 70,
  totalWeightG: 20, propWeightG: 10, samples: [{ time: 0, thrust: 1 }, { time: 1, thrust: 0 }], source: 'eng',
});

let kv: FakeKv;
let store: KeyValueMotorStore;
beforeEach(() => { kv = new FakeKv(); store = new KeyValueMotorStore(kv, 1000); });
afterEach(() => vi.useRealTimers());

describe('catalog mirror + signature guard', () => {
  it('reads back only when the signature matches', async () => {
    await store.writeCatalog(cat, 'sig1');
    expect(await store.readCatalog('sig1')).toHaveLength(1);
    expect(await store.readCatalog('sig2')).toBeNull(); // newer bundle supersedes
  });

  it('returns null when empty or corrupt', async () => {
    expect(await store.readCatalog('sig1')).toBeNull();
    await kv.set(CATALOG_SIG_KEY, 'sig1');
    await kv.set(CATALOG_KEY, 'not json');
    expect(await store.readCatalog('sig1')).toBeNull();
    await kv.set(CATALOG_KEY, '[]'); // empty array → treated as no mirror
    expect(await store.readCatalog('sig1')).toBeNull();
  });
});

describe('per-entry TTL freshness', () => {
  it('marks entries fresh within the TTL and stale past it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    await store.writeEntry('m:1', { spec: 1 });

    vi.setSystemTime(500);
    const fresh = await store.readEntry<{ spec: number }>('m:1', () => true);
    expect(fresh).toEqual({ value: { spec: 1 }, stale: false });

    vi.setSystemTime(2000); // now − t = 2000 > ttl 1000
    const stale = await store.readEntry<{ spec: number }>('m:1', () => true);
    expect(stale!.stale).toBe(true);
  });

  it('drops and returns null for a malformed envelope or invalid value', async () => {
    await kv.set('m:2', JSON.stringify({ v: { spec: 1 } })); // no timestamp
    expect(await store.readEntry('m:2', () => true)).toBeNull();
    expect(kv.map.has('m:2')).toBe(false); // evicted

    await kv.set('m:3', JSON.stringify({ t: 0, v: { spec: 1 } }));
    expect(await store.readEntry('m:3', () => false)).toBeNull(); // fails validator
    expect(kv.map.has('m:3')).toBe(false);
  });

  it('returns null for a missing key', async () => {
    expect(await store.readEntry('absent', () => true)).toBeNull();
  });
});

describe('custom motors', () => {
  it('adds newest-first and de-dupes by id', async () => {
    await store.addCustomMotor(custom('a'));
    await store.addCustomMotor(custom('b'));
    await store.addCustomMotor(custom('a')); // replace, not duplicate
    const list = await store.listCustomMotors();
    expect(list.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('removes by id', async () => {
    await store.addCustomMotor(custom('a'));
    await store.removeCustomMotor('a');
    expect(await store.listCustomMotors()).toEqual([]);
  });

  it('filters out invalid custom-motor rows', async () => {
    await kv.set('motors:custom', JSON.stringify([custom('ok'), { id: 'bad' }, { designation: 'no-id' }]));
    const list = await store.listCustomMotors();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('ok');
  });
});
