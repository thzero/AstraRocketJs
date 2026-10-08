import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { errorMessage } from '../../services/app/errorMessage';

type Landed<T> = { key: string; attempt: number } & ({ ok: true; data: T } | { ok: false; error: string });

/**
 * Data loaded asynchronously, with its loading, error and retry state.
 *
 * - A new `key` (or a `retry`) reads as loading until its own load lands; a result
 *   that lands for a key or attempt no longer current is ignored.
 * - A change of `refresh` reloads in the background: what is on screen stays
 *   until the new result replaces it, so a list does not flash back to
 *   "Loading" for a change the user just made.
 * - `onLoaded` fires with each successful result.
 *
 * `loading` is derived from what landed rather than set at the top of the
 * effect, which would be a synchronous setState in an effect: a cascading
 * render the compiler lint rejects.
 */
export function useAsyncLoad<T>(
  load: () => Promise<T>,
  key: string,
  { refresh, onLoaded }: { refresh?: unknown; onLoaded?: (data: T) => void } = {},
): { data: T | undefined; error: string | null; loading: boolean; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [landed, setLanded] = useState<Landed<T> | null>(null);
  // The latest callbacks, read when a load lands: callers pass inline closures,
  // and listing them in the effect's deps would reload on every render.
  const latest = useRef({ load, onLoaded });
  useLayoutEffect(() => {
    latest.current = { load, onLoaded };
  });
  useEffect(() => {
    let live = true;
    latest.current
      .load()
      .then((data) => {
        if (!live) return;
        setLanded({ key, attempt, ok: true, data });
        latest.current.onLoaded?.(data);
      })
      .catch((e: unknown) => {
        if (live) setLanded({ key, attempt, ok: false, error: errorMessage(e) });
      });
    return () => {
      live = false;
    };
  }, [key, attempt, refresh]);
  const current = landed !== null && landed.key === key && landed.attempt === attempt ? landed : null;
  return {
    data: current?.ok ? current.data : undefined,
    error: current && !current.ok ? current.error : null,
    loading: current === null,
    retry: () => setAttempt((n) => n + 1),
  };
}
