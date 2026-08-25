// The building block for client-side persistence: a small async key-value
// interface plus a localStorage implementation. The motor store and the
// material store each hold one of these and can be swapped independently for a
// different implementation (see motorStore.ts / materialStore.ts).
//
// Async by design so a non-localStorage implementation (IndexedDB, a backend,
// a shared store) can be dropped in without reshaping callers.
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
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

  async set(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value);
    } catch {
      // best-effort
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
