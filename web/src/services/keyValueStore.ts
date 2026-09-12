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
}
