import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  IndexedDbKeyValueStore,
  __resetIdbForTests,
  isStorageDegraded,
  onStorageDegraded,
} from '../../src/services/idbKeyValueStore';
import type { KeyValueStore } from '../../src/services/keyValueStore';

/** Stand-in for the pre-IndexedDB localStorage store. */
class FakeLocal implements KeyValueStore {
  full = false;
  /** Pass another instance's map to model localStorage outliving a reload. */
  constructor(readonly map = new Map<string, string>()) {}
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

beforeEach(async () => {
  await __resetIdbForTests();
  await new Promise<void>((res) => {
    const req = indexedDB.deleteDatabase('astrarrocketjs');
    req.onsuccess = req.onerror = req.onblocked = () => res();
  });
});

// The request succeeding and the transaction committing are DIFFERENT moments.
// The tests using this pin the gap: let the request report success, then abort
// the transaction before it commits, which is what a commit-time I/O error or a quota
// hit looks like. Resolving on `onsuccess` reported those as saved.
//
// `abortAfterSuccess` restores itself via try/finally: an assertion failure
// here used to leave the spy installed and silently corrupt the next test.
const abortAfterSuccess = async (body: () => Promise<void>) => {
  const realPut = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<typeof realPut>
  ) {
    const req = realPut.apply(this, args);
    req.addEventListener('success', () => req.transaction?.abort());
    return req;
  });
  try {
    await body();
  } finally {
    spy.mockRestore();
  }
};

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

  it('reports a write that aborts after the request succeeded as failed', async () => {
    const local = new FakeLocal();
    const kv = new IndexedDbKeyValueStore(local);
    await kv.set('warm', 'up'); // open the db before we start interfering

    await abortAfterSuccess(async () => {
      // It must not claim success for a write that is not in IndexedDB. It
      // falls back to localStorage, which is a real place the value now lives.
      expect(await kv.set('k', 'v')).toBe(true);
      expect(local.map.get('k')).toBe('v');
    });

    // The fallback holds it; IndexedDB genuinely does not.
    await __resetIdbForTests();
    const fresh = new IndexedDbKeyValueStore(new FakeLocal());
    expect(await fresh.get('k')).toBeNull();
  });

  it('keeps the legacy copy when the migrating transaction aborts post-success', async () => {
    const local = new FakeLocal();
    local.map.set('k', 'precious');
    const kv = new IndexedDbKeyValueStore(local);
    await kv.set('warm', 'up');

    await abortAfterSuccess(async () => {
      expect(await kv.get('k')).toBe('precious');
      // The migration never committed, so the only other copy must survive.
      expect(local.map.get('k')).toBe('precious');
    });
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

/**
 * The blocked-open path, which nothing had ever taken.
 *
 * `onblocked` fires when another tab still holds an older version of the
 * database open. Rejecting alone left the `open` request PENDING: when the
 * blocking tab finally closed, `onsuccess` fired on an already-settled promise
 * and the connection was leaked with nobody holding it to `close()` - which
 * then blocks the NEXT version upgrade in turn, in a tab that has no idea why.
 * It cannot be provoked through fake-indexeddb at a fixed DB_VERSION, so the
 * request object is stood in for directly.
 */
describe('an open blocked by another tab', () => {
  /** A stand-in IDBOpenDBRequest whose events this test fires by hand. */
  const blockingRequest = () => {
    const close = vi.fn();
    const req = {
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
      result: { close },
    } as unknown as IDBOpenDBRequest & { result: { close: typeof close } };
    return { req, close };
  };

  it('falls back to localStorage rather than hanging on the other tab', async () => {
    const { req } = blockingRequest();
    const local = new FakeLocal();
    const kv = new IndexedDbKeyValueStore(local);
    const spy = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      queueMicrotask(() => req.onblocked?.(new Event('blocked') as IDBVersionChangeEvent));
      return req;
    });
    await __resetIdbForTests();

    expect(await kv.set('k', 'v')).toBe(true);
    expect(local.map.get('k')).toBe('v');
    expect(isStorageDegraded()).toBe(true); // the UI gets to warn up front
    spy.mockRestore();
  });

  it('closes the connection that arrives after the block is settled', async () => {
    const { req, close } = blockingRequest();
    const kv = new IndexedDbKeyValueStore(new FakeLocal());
    const spy = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      queueMicrotask(() => req.onblocked?.(new Event('blocked') as IDBVersionChangeEvent));
      return req;
    });
    await __resetIdbForTests();
    await kv.get('k'); // takes the fallback

    expect(close).not.toHaveBeenCalled();
    // The blocking tab now goes away and the original open finally succeeds.
    req.onsuccess?.(new Event('success'));
    expect(close).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('does not memoize the block, so a later call reaches IndexedDB', async () => {
    // Otherwise one unlucky moment latches the whole session to the 5 MB cap
    // it just escaped - the same "never memoize a failure" rule as above.
    const { req } = blockingRequest();
    const kv = new IndexedDbKeyValueStore(new FakeLocal());
    const spy = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      queueMicrotask(() => req.onblocked?.(new Event('blocked') as IDBVersionChangeEvent));
      return req;
    });
    await __resetIdbForTests();

    await kv.get('k');
    spy.mockRestore();
    expect(await kv.set('k', 'v')).toBe(true);
    expect(await kv.get('k')).toBe('v'); // really in IndexedDB now
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

/**
 * `update()` falling back to localStorage, which `set()` had already been
 * taught about and `update()` had not.
 *
 * On a failed IndexedDB write `set` deletes the now-stale IndexedDB entry so
 * that in the NEXT session, where `fellBack` is empty again, `get` cannot read
 * IndexedDB first and serve the old value. `update` recorded the key in
 * `fellBack` and stopped there. The design library index is mutated only
 * through `update`, so a library edit that hit the quota looked saved for the
 * rest of the session and was gone on the next launch.
 */
describe('update() falling back to localStorage', () => {
  it('is served by a fresh session instead of the stale IndexedDB entry', async () => {
    const local = new FakeLocal();
    const kv = new IndexedDbKeyValueStore(local);
    expect(await kv.set('lib', 'old')).toBe(true); // lands in IndexedDB

    await abortAfterSuccess(async () => {
      expect(await kv.update('lib', () => 'new')).toBe(true);
    });
    expect(local.map.get('lib')).toBe('new');
    expect(await kv.get('lib')).toBe('new'); // this session: `fellBack`

    // Next session: a new store, `fellBack` gone, localStorage still there.
    await __resetIdbForTests();
    const next = new IndexedDbKeyValueStore(new FakeLocal(local.map));
    expect(await next.get('lib')).toBe('new');
  });

  it('hands the reducer the IndexedDB value when the fallback holds none', async () => {
    // Once migrated the value lives ONLY in IndexedDB. A reducer given `null`
    // would rebuild the library index from nothing and drop every other entry.
    const local = new FakeLocal();
    const kv = new IndexedDbKeyValueStore(local);
    await kv.set('lib', '["a","b"]');
    const seen: (string | null)[] = [];
    await abortAfterSuccess(async () => {
      await kv.update('lib', (raw) => {
        seen.push(raw);
        return raw;
      });
    });
    expect(seen).toContain('["a","b"]');
    expect(seen).not.toContain(null);
  });

  it('rethrows a reducer that throws and does not report storage as degraded', async () => {
    const kv = new IndexedDbKeyValueStore(new FakeLocal());
    await kv.set('k', 'v');
    const boom = new Error('bad reducer');
    await expect(
      kv.update('k', () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(isStorageDegraded()).toBe(false);
    expect(await kv.get('k')).toBe('v'); // the transaction was aborted, nothing changed
  });
});

describe('a QuotaExceededError is not a degraded IndexedDB', () => {
  it('reports through set()/update() without flipping the session to degraded', async () => {
    const local = new FakeLocal();
    const kv = new IndexedDbKeyValueStore(local);
    await kv.set('warm', 'up');
    expect(isStorageDegraded()).toBe(false);

    // The database is fine; this one write does not fit.
    const full = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    try {
      // The fallback takes it (a real place the value now lives), as before.
      expect(await kv.set('k', 'v')).toBe(true);
      expect(local.map.get('k')).toBe('v');
      expect(await kv.update('k2', () => 'v2')).toBe(true);
      // ...but IndexedDB itself is not written off for the session.
      expect(isStorageDegraded()).toBe(false);
    } finally {
      full.mockRestore();
    }
    // And a write that fits still lands in IndexedDB, with reads working.
    expect(await kv.set('after', 'fits')).toBe(true);
    expect(await kv.get('after')).toBe('fits');
  });

  it('an OPEN failure still degrades (the warning the flag exists for)', async () => {
    const kv = new IndexedDbKeyValueStore(new FakeLocal());
    const boom = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('IndexedDB disabled');
    });
    await __resetIdbForTests();
    await kv.set('a', '1');
    expect(isStorageDegraded()).toBe(true);
    boom.mockRestore();
  });
});
