import { useCallback, useEffect, useRef } from 'react';

/**
 * The generation guard for a callback that resolves after an await.
 *
 * Five surfaces did the same thing without one: `LaunchPanel`'s geolocation
 * callbacks, `WindProfileDialog.importCsv`, `MotorDialog`'s import and delete,
 * and `FlightPathExport.onImport`. Each awaits a file read, a browser permission
 * prompt or an IndexedDB round trip and then calls an `onChange` that writes to
 * whatever rows are the current edit targets, which may not be the ones that were
 * on screen when the work started. A geolocation prompt can sit unanswered for
 * minutes.
 *
 * `MotorDialog.pick` already implemented exactly this with a local ref and a
 * cleanup effect (`pickGen`). This is that, named, so the fifth copy is a call
 * rather than four lines someone has to remember to write.
 *
 * Unmounting bumps the generation, so a token taken before unmount is stale
 * afterwards: a result landing on a closed dialog is discarded along with one
 * superseded by a newer start.
 *
 * ```ts
 * const latest = useLatest();
 * const onImport = async (file: File) => {
 *   const mine = latest.claim();
 *   const rows = await parse(file);
 *   if (!mine()) return; // unmounted, or another import started
 *   onChange(rows);
 * };
 * ```
 */
export interface Latest {
  /**
   * Start a new attempt and get the predicate that says it is still the current
   * one. Claiming SUPERSEDES any attempt already in flight, which is the
   * behavior a second click on the same control wants.
   */
  claim: () => () => boolean;
  /**
   * Observe without claiming: true while this component is still mounted and
   * nothing has claimed since. For the caller that must not cancel a sibling
   * attempt, only notice that it is gone.
   */
  observe: () => () => boolean;
}

export function useLatest(): Latest {
  const gen = useRef(0);
  // The unmount bump is why this needs a ref and an effect rather than a plain
  // boolean: the cleanup runs after the last render, so nothing a later
  // continuation reads can be a state value.
  useEffect(
    () => () => {
      gen.current++;
    },
    [],
  );
  const claim = useCallback(() => {
    const mine = ++gen.current;
    return () => mine === gen.current;
  }, []);
  const observe = useCallback(() => {
    const mine = gen.current;
    return () => mine === gen.current;
  }, []);
  return { claim, observe };
}
