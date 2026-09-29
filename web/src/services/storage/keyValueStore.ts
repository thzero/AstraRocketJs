// The building block for client-side persistence: a small async key-value
// interface plus a localStorage implementation. The motor store and the
// material store each hold one of these and can be swapped independently for a
// different implementation (see motorStore.ts / materialStore.ts).
//
// Async by design so a non-localStorage implementation can be dropped in
// without reshaping callers — which is what idbKeyValueStore.ts does, and is
// now the default for every store. This localStorage one remains as its
// fallback for browsers where IndexedDB is blocked, and for the synchronous
// unload journal in workspaceStore.ts.
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  /** Persist `value`. Resolves `true` on success, `false` on failure (quota
   *  exceeded, storage blocked) — best-effort callers ignore it; callers holding
   *  the only copy of something (the workspace) check it to surface a warning. */
  set(key: string, value: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  /**
   * Read, transform and write one key ATOMICALLY.
   *
   * A plain `get` then `set` is a read-modify-write with an await in the
   * middle, and this app is an installable PWA whose IndexedDB is shared
   * across tabs. Two tabs saving a design both read index `[X]`, one writes
   * `[A,X]`, the other writes `[B,X]`, and the first entry is gone: since
   * `activeId()` filters against the index, that design becomes unreachable
   * and its bytes are orphaned.
   *
   * `fn` receives the raw stored string (or null) and returns the raw string
   * to store. Returning `null` removes the key. Resolves false if the write
   * was refused, exactly like {@link set}.
   */
  update(key: string, fn: (raw: string | null) => string | null): Promise<boolean>;
}

/** Default implementation: the browser's localStorage (per-browser, per-origin). */
export class LocalStorageKeyValueStore implements KeyValueStore {
  async get(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key);
    } catch {
      return null; // storage unavailable (private mode etc.)
    }
  }

  async set(key: string, value: string): Promise<boolean> {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false; // quota exceeded / storage blocked
    }
  }

  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch {
      // best-effort
    }
  }

  /**
   * localStorage is synchronous, so the read and the write here cannot be
   * interleaved by another task IN THIS TAB. Across tabs it is not atomic, but
   * this implementation is only the degraded fallback for browsers where
   * IndexedDB is blocked; the real store does it in one transaction.
   */
  async update(key: string, fn: (raw: string | null) => string | null): Promise<boolean> {
    let current: string | null;
    try {
      current = localStorage.getItem(key);
    } catch {
      return false; // storage unavailable (private mode etc.)
    }
    const next = fn(current);
    if (next === null) {
      await this.remove(key);
      return true;
    }
    return await this.set(key, next);
  }
}
