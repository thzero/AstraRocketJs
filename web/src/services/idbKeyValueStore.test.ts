import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IndexedDbKeyValueStore, __resetIdbForTests, isStorageDegraded, onStorageDegraded } from './idbKeyValueStore';
import type { KeyValueStore } from './keyValueStore';

/** Stand-in for the pre-IndexedDB localStorage store. */
class FakeLocal implements KeyValueStore {
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
}

beforeEach(async () => {
  await __resetIdbForTests();
  await new Promise<void>((res) => {
    const req = indexedDB.deleteDatabase('astrarrocketjs');
    req.onsuccess = req.onerror = req.onblocked = () => res();
  });
});

describe('IndexedDbKeyValueStore', () => {
  it('round-trips a value', async () => {
    const kv = new IndexedDbKeyValueStore(new FakeLocal());
    expect(await kv.set('astrarrocketjs:workspace', '{"a":1}')).toBe(true);
    expect(await kv.get('astrarrocketjs:workspace')).toBe('{"a":1}');
  });

  it('returns null for a key it has never held', async () => {
    expect(await new IndexedDbKeyValueStore(new FakeLocal()).get('nope')).toBeNull();
  });

  it('removes', async () => {
    const kv = new IndexedDbKeyValueStore(new FakeLocal());
    await kv.set('k', 'v');
    await kv.remove('k');
    expect(await kv.get('k')).toBeNull();
  });

  it('stores values far larger than the ~5 MB localStorage cap', async () => {
    const kv = new IndexedDbKeyValueStore(new FakeLocal());
    const big = 'x'.repeat(8 * 1024 * 1024);
    expect(await kv.set('big', big)).toBe(true);
    expect((await kv.get('big'))?.length).toBe(big.length);
  });
});

describe('migration from localStorage', () => {
  it('copies an existing value across on first read and frees the old entry', async () => {
    const local = new FakeLocal();
    local.map.set('astrarrocketjs:workspace', '{"design":"old"}');
    const kv = new IndexedDbKeyValueStore(local);

    // The pre-upgrade design must survive — losing it would lose the user's work.
    expect(await kv.get('astrarrocketjs:workspace')).toBe('{"design":"old"}');
    // Reclaiming the 5 MB budget is the point of moving.
    expect(local.map.has('astrarrocketjs:workspace')).toBe(false);

    // Still there once localStorage no longer has it.
    await __resetIdbForTests();
    expect(await new IndexedDbKeyValueStore(new FakeLocal()).get('astrarrocketjs:workspace')).toBe('{"design":"old"}');
  });

  it('prefers the IndexedDB value over a stale legacy one', async () => {
    const local = new FakeLocal();
    local.map.set('k', 'stale');
    const kv = new IndexedDbKeyValueStore(local);
    await kv.set('k', 'fresh');
    expect(await kv.get('k')).toBe('fresh');
  });

  it('keeps the original when the migrating write fails', async () => {
    const local = new FakeLocal();
    local.map.set('k', 'precious');
    const kv = new IndexedDbKeyValueStore(local);
    const boom = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('IndexedDB disabled');
    });
    await __resetIdbForTests();

    expect(await kv.get('k')).toBe('precious');
    // Not deleted on a failed migration — otherwise an interrupted upgrade
    // would destroy the only copy.
    expect(local.map.get('k')).toBe('precious');
    boom.mockRestore();
  });

  it('clears the legacy copy on remove even if it was never read', async () => {
    const local = new FakeLocal();
    local.map.set('k', 'v');
    await new IndexedDbKeyValueStore(local).remove('k');
    expect(local.map.has('k')).toBe(false);
  });
});

describe('when IndexedDB is unavailable', () => {
  it('falls back to localStorage for get/set', async () => {
    const local = new FakeLocal();
    const kv = new IndexedDbKeyValueStore(local);
    const boom = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('IndexedDB disabled');
    });
    await __resetIdbForTests();

    expect(await kv.set('k', 'v')).toBe(true);
    expect(local.map.get('k')).toBe('v');
    expect(await kv.get('k')).toBe('v');
    boom.mockRestore();
  });

  it('reports failure when the fallback is also full', async () => {
    const local = new FakeLocal();
    local.full = true;
    const kv = new IndexedDbKeyValueStore(local);
    const boom = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('IndexedDB disabled');
    });
    await __resetIdbForTests();

    // workspaceStore surfaces "storage is full" off this false.
    expect(await kv.set('k', 'v')).toBe(false);
    boom.mockRestore();
  });

  it('recovers on a later call — a transient open error is not memoized', async () => {
    const kv = new IndexedDbKeyValueStore(new FakeLocal());
    const boom = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      throw new Error('transient');
    });
    await __resetIdbForTests();

    await kv.get('k');
    boom.mockRestore();
    expect(await kv.set('k', 'v')).toBe(true);
    expect(await kv.get('k')).toBe('v');
  });
});

describe('storage-degraded signal', () => {
  it('is not raised while IndexedDB is working', async () => {
    const kv = new IndexedDbKeyValueStore(new FakeLocal());
    await kv.set('k', 'v');
    await kv.get('k');
    expect(isStorageDegraded()).toBe(false);
  });

  it('fires once when storage falls back, so the UI can warn up front', async () => {
    const kv = new IndexedDbKeyValueStore(new FakeLocal());
    const seen = vi.fn();
    onStorageDegraded(seen);
    const boom = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('IndexedDB disabled');
    });
    await __resetIdbForTests();

    await kv.set('a', '1');
    await kv.set('b', '2');
    await kv.get('a');

    expect(isStorageDegraded()).toBe(true);
    // One warning, not one per operation.
    expect(seen).toHaveBeenCalledOnce();
    boom.mockRestore();
  });

  it('tells a late subscriber that storage is already degraded', async () => {
    const kv = new IndexedDbKeyValueStore(new FakeLocal());
    const boom = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('IndexedDB disabled');
    });
    await __resetIdbForTests();
    await kv.set('a', '1');

    const late = vi.fn();
    onStorageDegraded(late);
    expect(late).toHaveBeenCalledOnce();
    boom.mockRestore();
  });
});
