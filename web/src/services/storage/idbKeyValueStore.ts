// IndexedDB implementation of KeyValueStore.
//
// Why not localStorage: it is synchronous (every read and write blocks the main
// thread) and capped near 5 MB per origin, shared by designs, custom motors and
// materials, imported templates, and the thrust-curve caches. workspaceStore
// has a "browser storage is full" error path, which is that cap showing
// through. IndexedDB is async and effectively uncapped, and KeyValueStore is
// declared async so this drops in.
//
// Existing data is migrated lazily, per key, on first read: a key present in
// localStorage is copied across and then dropped
// from localStorage (which is the point: it frees that 5 MB budget). The copy
// is only deleted after the IndexedDB write is confirmed, so an interrupted
// migration leaves the original where it was and simply retries next time.
//
// If IndexedDB is unavailable at all (disabled by policy, or some private
// browsing modes), every operation falls back to localStorage so the app still
// works, but that is not good enough to leave unsaid: the 5 MB cap it just
// escaped will be hit again, and the user would meet it later as an unexplained
// "storage is full" mid-edit. The first fallback flips a one-way flag and
// notifies listeners so the UI can warn up front (see onStorageDegraded).
import { type KeyValueStore, LocalStorageKeyValueStore } from './keyValueStore';
import { STORAGE_PREFIX } from './storageKeys';
import { errorMessage } from '../app/errorMessage';

const DB_NAME = STORAGE_PREFIX;
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Whether a connection has opened in this session. Until one has, IndexedDB has
 * held nothing this session could need: a read it refuses is nothing stored,
 * and the fallback is the whole store (see `readIdb`).
 */
let everOpened = false;

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
      everOpened = true;
      // A newer build in another tab is asking to upgrade the schema. Yield:
      // close this connection and forget the cached promise, so this tab
      // reconnects (at the new version) on its next operation. Without this an
      // older tab would hold its connection open forever, the upgrading tab would
      // hit `onblocked` below, and that tab would be pinned to the localStorage
      // fallback for its whole session; the `onblocked` handler only covers the
      // upgrading side of the same handshake.
      db.onversionchange = () => {
        try {
          db.close();
        } catch {
          /* already gone */
        }
        if (dbPromise === p) dbPromise = null;
      };
      // The browser closed the connection on its own (storage cleared in
      // settings, a lost connection after the app went to the background).
      // Forget it so the next operation reopens instead of failing every
      // transaction against a closed handle and falling back for the session.
      db.onclose = () => {
        if (dbPromise === p) dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'));
    // Another tab holds an older version open; don't hang waiting for it.
    //
    // Rejecting alone leaves the `open` request pending: when the blocking tab
    // finally closes, `onsuccess` fires on an already-settled promise and the
    // resulting connection leaks with nobody holding it to `close()`, which
    // then blocks the next version upgrade in turn. Close it late, and
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
 * Whether a failed write hit the storage quota rather than IndexedDB itself
 * being unusable.
 *
 * The two are not alike, so they are not reported alike: a full disk is a
 * different fact from a blocked database. IndexedDB keeps working for reads and
 * for smaller writes after a QuotaExceededError, so a quota failure must not
 * flip the one-way `degraded` flag. Its signal is `set`'s false, which
 * `workspaceStore.save` turns into "storage is full".
 */
function isQuotaError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'QuotaExceededError';
}

function isInvalidState(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'InvalidStateError';
}

/**
 * Start a transaction on the cached connection, reopening once if that
 * connection has been closed.
 *
 * A closed connection throws InvalidStateError from `transaction()`. The close
 * event that clears the cache is not guaranteed to arrive first (a close the
 * page asked for never fires it), so the stale handle is dropped here as well
 * and one fresh open is tried.
 */
async function begin(mode: IDBTransactionMode): Promise<IDBTransaction> {
  const cached = openDb();
  const db = await cached;
  try {
    return db.transaction(STORE, mode);
  } catch (e) {
    if (!isInvalidState(e)) throw e;
    if (dbPromise === cached) dbPromise = null;
    return (await openDb()).transaction(STORE, mode);
  }
}

/** Rejects when the transaction aborts or fails, with its own error when it has one. */
function rejectOnTxFailure(t: IDBTransaction, reject: (e: Error) => void): void {
  t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
  t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed'));
}

/**
 * Run one transaction against the kv store, resolving with the request result.
 *
 * A write resolves on the transaction's `complete` event, not on the request's
 * `success`. Those are different moments: `success` fires once the request has
 * been carried out inside the transaction, but the transaction can still abort
 * before it commits (a commit-time I/O error, the quota being hit, the tab
 * closing). Resolving on `success` would report writes that never landed,
 * and `set()`'s boolean is what `workspaceStore.save()` keys its
 * "storage is full" warning off, and what `migrate()` takes as permission to
 * delete the user's only other copy from localStorage.
 *
 * Reads keep resolving on `success`: there is nothing to commit, and the value
 * is in hand at that point.
 */
async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const t = await begin(mode);
  return await new Promise<T>((resolve, reject) => {
    const req = run(t.objectStore(STORE));
    let result: T;
    req.onsuccess = () => {
      result = req.result as T;
      if (mode === 'readonly') resolve(result);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    // Durability for writes: only a committed transaction counts.
    t.oncomplete = () => resolve(result);
    rejectOnTxFailure(t, reject);
  });
}

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

/**
 * Read, transform and write one key inside a single readwrite transaction.
 *
 * IndexedDB transactions are atomic across connections, so this is what makes
 * a cross-tab read-modify-write safe. The get and the put are issued on the
 * same transaction with no `await` between them: awaiting anything that is not
 * an IndexedDB request lets the transaction auto-commit first.
 */
async function txUpdate(key: string, fn: (raw: string | null) => string | null): Promise<void> {
  const t = await begin('readwrite');
  return await new Promise<void>((resolve, reject) => {
    const store = t.objectStore(STORE);
    const read = store.get(key);
    read.onsuccess = () => {
      let next: string | null;
      try {
        next = fn((read.result as string | undefined) ?? null);
      } catch (e) {
        // Settled before the abort event fires, so the storage-flavored
        // `onabort` rejection below cannot win the race.
        reject(new ReducerError(e));
        t.abort();
        return;
      }
      // A write that throws synchronously (a DataCloneError, or a quota
      // refusal raised at the call) keeps its error: settled before the abort
      // event, so the generic "transaction aborted" below cannot replace it
      // and the caller can still tell a quota hit from a broken database.
      try {
        if (next === null) store.delete(key);
        else store.put(next, key);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(errorMessage(e)));
        t.abort();
      }
    };
    read.onerror = () => reject(read.error ?? new Error('IndexedDB read failed'));
    t.oncomplete = () => resolve();
    rejectOnTxFailure(t, reject);
  });
}

/** Close and forget the cached connection; tests only. An open connection
 *  blocks deleteDatabase(), so this must be awaited before wiping between tests. */
export async function __resetIdbForTests(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  degraded = false;
  everOpened = false;
  try {
    (await pending)?.close();
  } catch {
    /* never opened */
  }
}

/** A read of IndexedDB that failed, which is not the same as nothing stored. */
const UNREADABLE = Symbol('unreadable');

export class IndexedDbKeyValueStore implements KeyValueStore {
  constructor(private readonly fallback: KeyValueStore = new LocalStorageKeyValueStore()) {}

  /**
   * Keys whose newest value had to go to the fallback because IndexedDB
   * refused the write.
   *
   * Without this the two tiers would silently disagree. A QuotaExceededError
   * aborts a write transaction but leaves reads working, so `set` falls back to
   * localStorage and returns true, every layer above reports success, and the
   * next `get` would read IndexedDB first and serve the stale copy: the user's
   * save lost with no "storage full" signal anywhere, which is the exact
   * signal `set`'s boolean exists to carry.
   */
  private readonly fellBack = new Set<string>();

  /**
   * A copy in the fallback is always the newer one.
   *
   * The fallback holds a key only when it is a pre-IndexedDB value not yet
   * migrated, or when IndexedDB refused a write. A successful IndexedDB write
   * clears the fallback copy, so the rule holds in both directions. It is what
   * lets a later session, where `fellBack` is empty, read the right tier even
   * when `demote` could not delete the stale IndexedDB entry (a closed
   * connection fails the delete as surely as the write).
   *
   * Newer is not the same as complete. An `update` in a session where
   * IndexedDB never opened seeds its reducer with null (see `readIdb`), so the
   * fallback copy it writes is built without whatever an earlier session left
   * in IndexedDB, and still wins here.
   */
  async get(key: string): Promise<string | null> {
    try {
      return await this.getChecked(key);
    } catch {
      return null;
    }
  }

  /**
   * As `get`, but a failed IndexedDB read rejects instead of reading as
   * "nothing stored". A browser with no IndexedDB at all reads as empty, as
   * `get` does: the fallback is the whole store there, not a read that failed.
   */
  async getChecked(key: string): Promise<string | null> {
    const newer = await this.fallback.get(key);
    if (newer != null) {
      // A key that fell back this session has just been refused by IndexedDB;
      // retrying the same write on every read gains nothing.
      if (!this.fellBack.has(key)) await this.promote(key, newer);
      return newer;
    }
    this.fellBack.delete(key);
    if (typeof indexedDB === 'undefined') {
      markDegraded();
      return null;
    }
    try {
      return (await tx<string | undefined>('readonly', (s) => s.get(key))) ?? null;
    } catch (e) {
      markDegraded();
      throw e instanceof Error ? e : new Error(errorMessage(e));
    }
  }

  async set(key: string, value: string): Promise<boolean> {
    try {
      await tx('readwrite', (s) => s.put(value, key));
      this.fellBack.delete(key);
      // Any fallback copy is now the older one; left behind it would win
      // every later read (see `get`).
      await this.fallback.remove(key);
      return true;
    } catch (e) {
      // Only an unusable IndexedDB degrades the session; a full one reports
      // through the boolean below.
      if (!isQuotaError(e)) markDegraded();
      const ok = await this.fallback.set(key, value); // quota, or IndexedDB unavailable
      if (ok) await this.demote(key);
      return ok;
    }
  }

  async update(key: string, fn: (raw: string | null) => string | null): Promise<boolean> {
    // As in `get`, a fallback copy is the newer value and the reducer must see
    // it. Moved into IndexedDB first when possible; otherwise the update runs
    // on the fallback. A fallback with no copy means the key lives in
    // IndexedDB (another tab's read may have migrated it back and cleared
    // localStorage), and a reducer handed the fallback's null would rebuild
    // the value from nothing.
    const newer = await this.fallback.get(key);
    if (newer != null && (this.fellBack.has(key) || !(await this.promote(key, newer)))) {
      this.fellBack.add(key);
      return await this.fallback.update(key, fn);
    }
    this.fellBack.delete(key);
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
      // The fallback usually does not hold this key: once migrated, the value
      // lives only in IndexedDB, and a quota failure leaves reads working. A
      // reducer handed `null` would rebuild the design-library index from
      // nothing and drop every other entry, so seed it with the IndexedDB copy
      // whenever the fallback has none of its own (a fallback copy, if present,
      // is the newer one: see `get`), and refuse below when that copy cannot be
      // read.
      const current = await this.readIdb(key);
      // IndexedDB failing mid-session (WebKit's "Connection to Indexed Database
      // server lost") can refuse the read as well as the write. Then nothing
      // says what is stored, and a reducer handed null would write a one-item
      // list to the fallback, the demotion below would drop the full copy, and
      // the next session would promote the short list over it: every other
      // saved design unlisted. Unless the fallback has its own copy to seed
      // from, the write is refused, as a full store refuses it.
      if (current === UNREADABLE && (await this.fallback.get(key)) == null) return false;
      const seed = current === UNREADABLE ? null : current;
      const ok = await this.fallback.update(key, (raw) => fn(raw ?? seed));
      // The design library index is mutated only through `update`, so it is
      // the key the demotion matters most for.
      if (ok) await this.demote(key);
      return ok;
    }
  }

  /**
   * `key` now lives in the fallback. Mark it so for this session, and drop the
   * stale IndexedDB entry so it cannot shadow the fallback in a later session,
   * where `fellBack` no longer exists. A delete frees space, so it can succeed
   * where the write that just failed did not; if it also fails, `fellBack`
   * still covers this session.
   */
  private async demote(key: string): Promise<void> {
    this.fellBack.add(key);
    try {
      await tx('readwrite', (s) => s.delete(key));
    } catch {
      /* best-effort */
    }
  }

  /**
   * The IndexedDB copy of `key`: null if there is none, {@link UNREADABLE} if it
   * cannot be read. A read refused before any connection has opened this
   * session is null: IndexedDB that never opened (disabled, blocked, absent)
   * holds nothing the session wrote, and refusing on it would refuse the first
   * write of every list and design for good.
   */
  private async readIdb(key: string): Promise<string | null | typeof UNREADABLE> {
    try {
      return (await tx<string | undefined>('readonly', (s) => s.get(key))) ?? null;
    } catch {
      return everOpened ? UNREADABLE : null;
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

  /**
   * Move the fallback's copy of `key` into IndexedDB. Resolves whether it
   * moved. On failure the original stays where it is and the next read tries
   * again; an unusable IndexedDB degrades the session as any other failure.
   */
  private async promote(key: string, value: string): Promise<boolean> {
    try {
      await tx('readwrite', (s) => s.put(value, key));
    } catch (e) {
      if (!isQuotaError(e)) markDegraded();
      return false;
    }
    // Only now is it safe to reclaim the localStorage entry.
    await this.fallback.remove(key);
    return true;
  }
}
