// IndexedDB implementation of KeyValueStore.
//
// Why not localStorage: it is synchronous (every read and write blocks the main
// thread) and capped near 5 MB per origin — shared by designs, custom motors and
// materials, imported templates, and the thrust-curve caches. workspaceStore
// already has a "browser storage is full" error path, which is that cap showing
// through. IndexedDB is async and effectively uncapped, and KeyValueStore was
// declared async from the start so this could drop in.
//
// Existing users' data is migrated LAZILY, per key, on first read: a key absent
// from IndexedDB but present in localStorage is copied across and then dropped
// from localStorage (which is the point — it frees that 5 MB budget). The copy
// is only deleted after the IndexedDB write is confirmed, so an interrupted
// migration leaves the original where it was and simply retries next time.
//
// If IndexedDB is unavailable at all — disabled by policy, or some private
// browsing modes — every operation falls back to localStorage so the app still
// works, but that is NOT good enough to leave unsaid: the 5 MB cap it just
// escaped will be hit again, and the user would meet it later as an unexplained
// "storage is full" mid-edit. The first fallback flips a one-way flag and
// notifies listeners so the UI can warn up front (see onStorageDegraded).
import { type KeyValueStore, LocalStorageKeyValueStore } from './keyValueStore';

const DB_NAME = 'astrarrocketjs';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer build in another tab is asking to upgrade the schema. Yield:
      // close this connection and forget the cached promise, so this tab
      // reconnects (at the new version) on its next operation. Without this an
      // older tab held its connection open forever, the upgrading tab hit
      // `onblocked` below, and THAT tab was pinned to the localStorage fallback
      // for its whole session; the `onblocked` handler only covers the
      // upgrading side of the same handshake.
      db.onversionchange = () => {
        try {
          db.close();
        } catch {
          /* already gone */
        }
        if (dbPromise === p) dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'));
    // Another tab holds an older version open; don't hang waiting for it.
    //
    // Rejecting alone left the `open` request PENDING: when the blocking tab
    // finally closed, `onsuccess` fired on an already-settled promise and the
    // resulting connection was leaked with nobody holding it to `close()` -
    // which then blocks the NEXT version upgrade in turn. Close it late, and
    // drop the cached promise so a retry can succeed rather than leaving the
    // session latched to the localStorage fallback (the "never memoize a
    // failure" intent just below).
    req.onblocked = () => {
      req.onsuccess = () => {
        try {
          req.result.close();
        } catch {
          /* already gone */
        }
      };
      reject(new Error('IndexedDB blocked by another tab'));
    };
  });
  // Never memoize a failure: a transient open error would otherwise pin the app
  // to the fallback for the rest of the session.
  p.catch(() => {
    if (dbPromise === p) dbPromise = null;
  });
  dbPromise = p;
  return p;
}

// Set the first time an operation has to fall back to localStorage, and never
// cleared: once storage is known-degraded for this session, the warning stands.
let degraded = false;
const degradedListeners = new Set<() => void>();

/** True once IndexedDB has failed and storage fell back to localStorage. */
export function isStorageDegraded(): boolean {
  return degraded;
}

/** Notified the first time storage degrades. Fires immediately if it already
 *  has, so a late subscriber still sees it. Returns an unsubscribe. */
export function onStorageDegraded(cb: () => void): () => void {
  degradedListeners.add(cb);
  if (degraded) cb();
  return () => {
    degradedListeners.delete(cb);
  };
}

function markDegraded(): void {
  if (degraded) return;
  degraded = true;
  for (const cb of degradedListeners) cb();
}

/**
 * Whether a failed write hit the storage QUOTA rather than IndexedDB itself
 * being unusable.
 *
 * The two used to be treated alike: any failed `set`/`update` flipped the
 * one-way `degraded` flag and warned that storage had fallen back to
 * localStorage for the session. A full disk is a different fact from a
 * blocked database. IndexedDB keeps working for reads and for smaller writes
 * after a QuotaExceededError, and the honest signal for it is `set`'s false,
 * which `workspaceStore.save` already turns into "storage is full".
 */
function isQuotaError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'QuotaExceededError';
}

/**
 * Run one transaction against the kv store, resolving with the request result.
 *
 * A WRITE resolves on the transaction's `complete` event, NOT on the request's
 * `success`. Those are different moments: `success` fires once the request has
 * been carried out inside the transaction, but the transaction can still abort
 * before it commits (a commit-time I/O error, the quota being hit, the tab
 * closing). Resolving on `success` therefore reported writes that never landed
 * — and `set()`'s boolean is what `workspaceStore.save()` keys its
 * "storage is full" warning off, and what `migrate()` takes as permission to
 * delete the user's only other copy from localStorage.
 *
 * Reads keep resolving on `success`: there is nothing to commit, and the value
 * is in hand at that point.
 */
async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return await new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    let result: T;
    req.onsuccess = () => {
      result = req.result as T;
      if (mode === 'readonly') resolve(result);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    // Durability for writes: only a committed transaction counts.
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
    t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed'));
  });
}

/**
 * Read, transform and write one key inside a SINGLE readwrite transaction.
 *
 * IndexedDB transactions are atomic across connections, so this is what makes
 * a cross-tab read-modify-write safe. The get and the put are issued on the
 * same transaction with no `await` between them: awaiting anything that is not
 * an IndexedDB request lets the transaction auto-commit first.
 */
/**
 * The caller's reducer threw inside the transaction. That is the caller's
 * bug, not a storage failure: `update()` must rethrow it as-is rather than
 * flip the storage-degraded flag and retry the same reducer on localStorage.
 */
class ReducerError extends Error {
  constructor(readonly inner: unknown) {
    super('update reducer threw');
  }
}

async function txUpdate(key: string, fn: (raw: string | null) => string | null): Promise<void> {
  const db = await openDb();
  return await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    const read = store.get(key);
    read.onsuccess = () => {
      let next: string | null;
      try {
        next = fn((read.result as string | undefined) ?? null);
      } catch (e) {
        // Settled BEFORE the abort event fires, so the storage-flavored
        // `onabort` rejection below cannot win the race.
        reject(new ReducerError(e));
        t.abort();
        return;
      }
      // A write that throws synchronously (a DataCloneError, or a quota
      // refusal raised at the call) keeps ITS error: settled before the abort
      // event, so the generic "transaction aborted" below cannot replace it
      // and the caller can still tell a quota hit from a broken database.
      try {
        if (next === null) store.delete(key);
        else store.put(next, key);
      } catch (e) {
        reject(e);
        t.abort();
      }
    };
    read.onerror = () => reject(read.error ?? new Error('IndexedDB read failed'));
    t.oncomplete = () => resolve();
    t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
    t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed'));
  });
}

/** Close and forget the cached connection — tests only. An open connection
 *  blocks deleteDatabase(), so this must be awaited before wiping between tests. */
export async function __resetIdbForTests(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  degraded = false;
  try {
    (await pending)?.close();
  } catch {
    /* never opened */
  }
}

export class IndexedDbKeyValueStore implements KeyValueStore {
  constructor(private readonly fallback: KeyValueStore = new LocalStorageKeyValueStore()) {}

  /**
   * Keys whose newest value had to go to the fallback because IndexedDB
   * refused the write.
   *
   * Without this the two tiers silently disagreed. A QuotaExceededError aborts
   * a write transaction but leaves READS working, so `set` fell back to
   * localStorage and returned true, every layer above reported success, and
   * the next `get` read IndexedDB first and served the STALE copy. The user's
   * save was lost with no "storage full" signal anywhere — which is the exact
   * signal `set`'s boolean exists to carry.
   */
  private readonly fellBack = new Set<string>();

  async get(key: string): Promise<string | null> {
    // A key we had to write to the fallback is NEWER there; the IndexedDB
    // entry, if any, is the stale one that used to shadow it.
    if (this.fellBack.has(key)) {
      const v = await this.fallback.get(key);
      if (v != null) return v;
      this.fellBack.delete(key);
    }
    try {
      const found = await tx<string | undefined>('readonly', (s) => s.get(key));
      if (found != null) return found;
      return await this.migrate(key);
    } catch {
      markDegraded();
      return await this.fallback.get(key);
    }
  }

  async set(key: string, value: string): Promise<boolean> {
    try {
      await tx('readwrite', (s) => s.put(value, key));
      this.fellBack.delete(key);
      return true;
    } catch (e) {
      // Only an UNUSABLE IndexedDB degrades the session; a full one reports
      // through the boolean below.
      if (!isQuotaError(e)) markDegraded();
      const ok = await this.fallback.set(key, value); // quota, or IndexedDB unavailable
      if (ok) {
        this.fellBack.add(key);
        // Drop the now-stale IndexedDB entry so it cannot shadow the fallback
        // in a LATER session, where `fellBack` no longer exists. A delete
        // frees space, so it can succeed where the write that just failed did
        // not; if it also fails, `fellBack` still covers this session.
        try {
          await tx('readwrite', (s) => s.delete(key));
        } catch {
          /* best-effort */
        }
      }
      return ok;
    }
  }

  async update(key: string, fn: (raw: string | null) => string | null): Promise<boolean> {
    if (this.fellBack.has(key)) return await this.fallback.update(key, fn);
    try {
      await txUpdate(key, fn);
      this.fellBack.delete(key);
      return true;
    } catch (e) {
      // A reducer that throws is not a storage failure: rethrow it untouched
      // and leave the degraded flag alone (retrying it on localStorage would
      // only throw again, after warning the user about the wrong thing).
      if (e instanceof ReducerError) throw e.inner;
      if (!isQuotaError(e)) markDegraded();
      // The fallback usually does NOT hold this key: once migrated, the value
      // lives only in IndexedDB, and a quota failure leaves reads working. A
      // reducer handed `null` would rebuild the design-library index from
      // nothing and drop every other entry, so seed it with the IndexedDB copy
      // whenever the fallback has none of its own (a fallback copy, if present,
      // is the newer one: see `get`).
      const current = await this.readIdb(key);
      const ok = await this.fallback.update(key, (raw) => fn(raw ?? current));
      if (ok) {
        this.fellBack.add(key);
        // Same as `set`: without this the stale IndexedDB entry shadowed the
        // fallback in the NEXT session, where `fellBack` no longer exists. The
        // design library index is mutated only through `update`, so this was
        // the key that mattered most.
        try {
          await tx('readwrite', (s) => s.delete(key));
        } catch {
          /* best-effort */
        }
      }
      return ok;
    }
  }

  /** The IndexedDB copy of `key`, or null if there is none or it cannot be read. */
  private async readIdb(key: string): Promise<string | null> {
    try {
      return (await tx<string | undefined>('readonly', (s) => s.get(key))) ?? null;
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    this.fellBack.delete(key);
    try {
      await tx('readwrite', (s) => s.delete(key));
    } catch {
      /* best-effort */
    }
    // Always clear the legacy copy too, so removing something that was never
    // read (and so never migrated) cannot leave it behind in localStorage.
    await this.fallback.remove(key);
  }

  /** Copy a pre-IndexedDB value across on first read. Returns it either way. */
  private async migrate(key: string): Promise<string | null> {
    const legacy = await this.fallback.get(key);
    if (legacy == null) return null;
    try {
      await tx('readwrite', (s) => s.put(legacy, key));
      // Only now is it safe to reclaim the localStorage entry.
      await this.fallback.remove(key);
    } catch {
      // Leave the original in place; the next read tries again.
    }
    return legacy;
  }
}
