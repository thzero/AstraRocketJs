import { STORAGE_PREFIX, nsKey } from '../../../src/services/storage/storageKeys';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  IndexedDbKeyValueStore,
  __resetIdbForTests,
  onStorageDegraded,
} from '../../../src/services/storage/idbKeyValueStore';
import type { KeyValueStore } from '../../../src/services/storage/keyValueStore';

/**
 * Is storage in its degraded, fell-back-to-localStorage state?
 *
 * Asked through `onStorageDegraded`, the seam the app uses: the subscription calls
 * back immediately when the flag is already set, so subscribing and unsubscribing
 * in one breath reads it.
 */
const degraded = (): boolean => {
  let seen = false;
  onStorageDegraded(() => {
    seen = true;
  })();
  return seen;
};

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
    const req = indexedDB.deleteDatabase(STORAGE_PREFIX);
    req.onsuccess = req.onerror = req.onblocked = () => res();
  });
});

// The request succeeding and the transaction committing are different moments.
// The tests using this pin the gap: let the request report success, then abort
// the transaction before it commits, which is what a commit-time I/O error or a quota
// hit looks like. Resolving on `onsuccess` would report those as saved.
//
// `abortAfterSuccess` restores itself via try/finally, or an assertion failure
// here leaves the spy installed and silently corrupts the next test.
const abortAfterSuccess = async (body: () => Promise<void>) => {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- saved to patch the prototype; called back with .call(this, ...)
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
    expect(await kv.set(nsKey('workspace'), '{"a":1}')).toBe(true);
    expect(await kv.get(nsKey('workspace'))).toBe('{"a":1}');
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
    local.map.set(nsKey('workspace'), '{"design":"old"}');
    const kv = new IndexedDbKeyValueStore(local);

    // The pre-upgrade design must survive: losing it would lose the user's work.
    expect(await kv.get(nsKey('workspace'))).toBe('{"design":"old"}');
    // Reclaiming the 5 MB budget is the point of moving.
    expect(local.map.has(nsKey('workspace'))).toBe(false);

    // Still there once localStorage no longer has it.
    await __resetIdbForTests();
    expect(await new IndexedDbKeyValueStore(new FakeLocal()).get(nsKey('workspace'))).toBe('{"design":"old"}');
  });

  it('prefers the IndexedDB value over a stale legacy one', async () => {
    const local = new FakeLocal();
    local.map.set('k', 'stale');
    const kv = new IndexedDbKeyValueStore(local);
    await kv.set('k', 'fresh');
    expect(await kv.get('k')).toBe('fresh');
  });

  it('sends a write that aborts after the request succeeded to the fallback', async () => {
    const local = new FakeLocal();
    const kv = new IndexedDbKeyValueStore(local);
    await kv.set('warm', 'up'); // open the db before we start interfering

    await abortAfterSuccess(async () => {
      // The IndexedDB write never committed, so the value goes to localStorage
      // and the true reports that copy, not the IndexedDB one.
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
    // Not deleted on a failed migration: otherwise an interrupted upgrade
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

  it('recovers on a later call: a transient open error is not memoized', async () => {
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
 * The blocked-open path.
 *
 * `onblocked` fires when another tab still holds an older version of the
 * database open. Rejecting alone leaves the `open` request pending: when the
 * blocking tab finally closes, `onsuccess` fires on an already-settled promise
 * and the connection is leaked with nobody holding it to `close()`, which
 * then blocks the next version upgrade in turn. It cannot be provoked through fake-indexeddb at a fixed DB_VERSION, so the
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
    expect(degraded()).toBe(true); // the UI gets to warn up front
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
    // A memoized block would latch the whole session to the localStorage
    // fallback; the same "never memoize a failure" rule as the open error above.
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
    expect(degraded()).toBe(false);
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

    expect(degraded()).toBe(true);
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
 * `update()` falling back to localStorage the same way `set()` does.
 *
 * On a failed IndexedDB write both delete the now-stale IndexedDB entry, so that in
 * the next session, where `fellBack` is empty again, `get` cannot read IndexedDB
 * first and serve the old value. Recording the key in `fellBack` and stopping there
 * is not enough: the design library index is mutated only through `update`, so a
 * library edit that hit the quota would look saved for the rest of the session and
 * be gone on the next launch.
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
    // Once migrated the value lives only in IndexedDB. A reducer given `null`
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

  /**
   * IndexedDB failing mid-session (WebKit's "Connection to Indexed Database
   * server lost") refuses the read as well as the write. A reducer handed null
   * would write a one-item list to the fallback, the demotion would drop the
   * full copy, and the next session would promote the short list over it.
   */
  it('refuses the write when IndexedDB cannot be read and the fallback holds nothing', async () => {
    const local = new FakeLocal();
    const kv = new IndexedDbKeyValueStore(local);
    await kv.set('lib', '["a","b"]');
    const seen: (string | null)[] = [];
    const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(() => {
      throw new DOMException('Connection to Indexed Database server lost', 'UnknownError');
    });
    try {
      await abortAfterSuccess(async () => {
        const ok = await kv.update('lib', (raw) => {
          seen.push(raw);
          return JSON.stringify([...(JSON.parse(raw ?? '[]') as string[]), 'c']);
        });
        expect(ok).toBe(false);
      });
    } finally {
      getSpy.mockRestore();
    }
    expect(seen).not.toContain(null);
    expect(local.map.has('lib')).toBe(false);
    // The full list is still where it was.
    await __resetIdbForTests();
    expect(await new IndexedDbKeyValueStore(new FakeLocal()).get('lib')).toBe('["a","b"]');
  });

  // `fellBack` is per tab. Another tab reading the key migrates it back to
  // IndexedDB and clears the localStorage copy, so this tab's next update must
  // not hand the reducer the fallback's null.
  it('reads IndexedDB again once another tab has migrated the key back', async () => {
    const local = new FakeLocal();
    const kv = new IndexedDbKeyValueStore(local);
    await kv.set('lib', '["a"]');
    await abortAfterSuccess(async () => {
      await kv.update('lib', () => '["a","b"]');
    });
    expect(local.map.get('lib')).toBe('["a","b"]');

    // Tab B: finds nothing in IndexedDB, copies the fallback across, clears it.
    const tabB = new IndexedDbKeyValueStore(new FakeLocal(local.map));
    expect(await tabB.get('lib')).toBe('["a","b"]');
    expect(local.map.has('lib')).toBe(false);

    const seen: (string | null)[] = [];
    await kv.update('lib', (raw) => {
      seen.push(raw);
      return raw;
    });
    expect(seen).toEqual(['["a","b"]']);
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
    expect(degraded()).toBe(false);
    expect(await kv.get('k')).toBe('v'); // the transaction was aborted, nothing changed
  });
});

describe('a QuotaExceededError is not a degraded IndexedDB', () => {
  it('reports through set()/update() without flipping the session to degraded', async () => {
    const local = new FakeLocal();
    const kv = new IndexedDbKeyValueStore(local);
    await kv.set('warm', 'up');
    expect(degraded()).toBe(false);

    // The database is fine; this one write does not fit.
    const full = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    try {
      // The fallback takes it, so the value has a real place to live.
      expect(await kv.set('k', 'v')).toBe(true);
      expect(local.map.get('k')).toBe('v');
      expect(await kv.update('k2', () => 'v2')).toBe(true);
      // ...but IndexedDB itself is not written off for the session.
      expect(degraded()).toBe(false);
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
    expect(degraded()).toBe(true);
    boom.mockRestore();
  });
});

/**
 * A connection the browser closes on its own (storage cleared in settings, a
 * lost connection after the app goes to the background) must not stay cached:
 * every transaction on it throws, and the session would sit on the fallback.
 */
describe('a connection closed underneath the store', () => {
  /** Hands back each connection the store opens. */
  const captureConnections = () => {
    const opened: IDBDatabase[] = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- saved to wrap; called back with .apply(indexedDB, ...)
    const realOpen = indexedDB.open;
    const spy = vi.spyOn(indexedDB, 'open').mockImplementation((...args: Parameters<typeof realOpen>) => {
      const req = realOpen.apply(indexedDB, args);
      req.addEventListener('success', () => opened.push(req.result));
      return req;
    });
    return { opened, restore: () => spy.mockRestore() };
  };

  it('reopens after a close event instead of falling back', async () => {
    const { opened, restore } = captureConnections();
    try {
      await __resetIdbForTests();
      const local = new FakeLocal();
      const kv = new IndexedDbKeyValueStore(local);
      await kv.set('warm', 'up');
      expect(opened).toHaveLength(1);
      const db = opened[0]!;
      db.close();
      db.onclose?.(new Event('close'));

      expect(await kv.set('k', 'v')).toBe(true);
      expect(local.map.has('k')).toBe(false); // in IndexedDB, not the fallback
      expect(opened).toHaveLength(2);
      expect(degraded()).toBe(false);
    } finally {
      restore();
    }
  });

  it('reopens when the closed handle is still cached with no close event', async () => {
    const { opened, restore } = captureConnections();
    try {
      await __resetIdbForTests();
      const local = new FakeLocal();
      const kv = new IndexedDbKeyValueStore(local);
      await kv.set('lib', '["a"]');
      opened[0]!.close();

      expect(await kv.update('lib', (raw) => raw + '!')).toBe(true);
      expect(await kv.get('lib')).toBe('["a"]!');
      expect(local.map.size).toBe(0);
      expect(degraded()).toBe(false);
    } finally {
      restore();
    }
  });

  it('a later session reads the fallback copy over an IndexedDB entry the demote could not delete', async () => {
    // IndexedDB still holds the old value; the newer write went to the
    // fallback and the delete of the stale entry failed with it.
    const kv = new IndexedDbKeyValueStore(new FakeLocal());
    await kv.set('k', 'old');
    const local = new FakeLocal();
    local.map.set('k', 'new');

    await __resetIdbForTests();
    const next = new IndexedDbKeyValueStore(new FakeLocal(local.map));
    expect(await next.get('k')).toBe('new');
    // Moved into IndexedDB, so the two tiers agree again.
    expect(local.map.has('k')).toBe(false);
    await __resetIdbForTests();
    expect(await new IndexedDbKeyValueStore(new FakeLocal()).get('k')).toBe('new');
  });

  it('an update in a later session hands the reducer the fallback copy', async () => {
    const kv = new IndexedDbKeyValueStore(new FakeLocal());
    await kv.set('lib', '["old"]');
    const local = new FakeLocal();
    local.map.set('lib', '["new"]');

    await __resetIdbForTests();
    const next = new IndexedDbKeyValueStore(local);
    const seen: (string | null)[] = [];
    await next.update('lib', (raw) => {
      seen.push(raw);
      return raw;
    });
    expect(seen).toEqual(['["new"]']);
  });

  it('a successful write clears an older fallback copy', async () => {
    const local = new FakeLocal();
    local.map.set('k', 'older');
    const kv = new IndexedDbKeyValueStore(local);
    expect(await kv.set('k', 'newest')).toBe(true);
    expect(local.map.has('k')).toBe(false);
  });
});

/**
 * IndexedDB that never opens this session (disabled by policy, some private
 * modes, a blocked open, or no IndexedDB at all) holds nothing the session
 * could need, so the fallback is the whole store: the first write of a new list
 * or design goes there, rather than being refused as an unreadable key.
 */
describe('a session where IndexedDB never opens', () => {
  it.each([
    [
      'the open throws',
      () =>
        vi.spyOn(indexedDB, 'open').mockImplementation(() => {
          throw new Error('IndexedDB disabled');
        }),
    ],
    ['there is no IndexedDB', () => vi.stubGlobal('indexedDB', undefined)],
  ])('stores the first entry of a new list when %s', async (_name, breakIdb) => {
    await __resetIdbForTests();
    const local = new FakeLocal();
    const kv = new IndexedDbKeyValueStore(local);
    breakIdb();
    try {
      expect(await kv.update('motors', () => '["m1"]')).toBe(true);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
    expect(local.map.get('motors')).toBe('["m1"]');
  });

  it('creates the first design of an empty library', async () => {
    await __resetIdbForTests();
    const { DesignLibrary } = await import('../../../src/services/storage/designLibrary');
    const local = new FakeLocal();
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('IndexedDB disabled');
    });
    try {
      const lib = new DesignLibrary(new IndexedDbKeyValueStore(local));
      await expect(lib.create('r', { version: 2 } as never)).resolves.toBeTruthy();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
