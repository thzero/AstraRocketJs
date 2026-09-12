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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'));
    // Another tab holds an older version open; don't hang waiting for it.
    req.onblocked = () => reject(new Error('IndexedDB blocked by another tab'));
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

/** Run one transaction against the kv store, resolving with the request result. */
async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return await new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
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

  async get(key: string): Promise<string | null> {
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
      return true;
    } catch {
      markDegraded();
      return await this.fallback.set(key, value); // quota, or IndexedDB unavailable
    }
  }

  async remove(key: string): Promise<void> {
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
