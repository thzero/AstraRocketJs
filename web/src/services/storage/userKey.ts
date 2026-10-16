import { useSyncExternalStore } from 'react';
import { nsKey } from './storageKeys';

/**
 * A key the user enters for a third-party service: their own Esri map key,
 * their own Open-Meteo key. The app ships none.
 *
 * Each is kept in its own entry in this browser, outside the settings object,
 * so no settings copy, saved design, `.ork` or crash file can carry it.
 * Unreadable storage (a private window, blocked site data) reads as no key.
 */
export interface UserKeyStore {
  read: () => string | undefined;
  /** Store `key`, or forget it when blank. Returns false when storage refused. */
  write: (key: string) => boolean;
  /** The current key, re-read whenever it is saved here or in another tab. */
  use: () => string | undefined;
}

export function userKeyStore(suffix: string): UserKeyStore {
  const storageKey = nsKey(suffix);
  const listeners = new Set<() => void>();
  const read = (): string | undefined => {
    try {
      const v = localStorage.getItem(storageKey)?.trim();
      return v ? v : undefined;
    } catch {
      return undefined;
    }
  };
  const subscribe = (onChange: () => void) => {
    listeners.add(onChange);
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey || e.key === null) onChange();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener('storage', onStorage);
    };
  };
  return {
    read,
    write: (key) => {
      try {
        const v = key.trim();
        if (v) localStorage.setItem(storageKey, v);
        else localStorage.removeItem(storageKey);
      } catch {
        return false;
      }
      for (const l of listeners) l();
      return true;
    },
    use: () => useSyncExternalStore(subscribe, read, () => undefined),
  };
}
