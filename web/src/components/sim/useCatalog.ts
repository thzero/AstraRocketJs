import { useEffect, useRef, useState } from 'react';
import { loadCatalog, type CatalogMotor } from '../../services/motorDb';

/**
 * The motor catalog, loaded once on mount, with the loading / error / retry
 * state both motor dialogs render around it.
 *
 * On MOUNT, with no `open` guard: the dialogs that use this are mounted only
 * while open (`{open && <Dialog />}`), so mounting IS the deferral. The ~1.6 MB
 * catalog (see services/remoteData.ts) used to be fetched on app start because
 * both dialogs were mounted permanently and merely `return null` when closed,
 * which does not stop an effect.
 *
 * `onLoaded` fires once per successful load with the catalog it produced. The
 * picker seeds its selection from the seated motor there, which is the one
 * moment the list exists and nothing has been clicked yet.
 */
export function useCatalog({ onLoaded }: { onLoaded?: (catalog: CatalogMotor[]) => void } = {}) {
  const [catalog, setCatalog] = useState<CatalogMotor[]>([]);
  // Bumped by the retry button to re-run the load effect.
  const [attempt, setAttempt] = useState(0);
  // The outcome of the latest load that LANDED, filed under the attempt it
  // answers. `loading` is derived from that (the landed attempt is not the
  // current one) rather than a flag the effect sets on entry: the flag version
  // was a synchronous setState at the top of the effect, which is a cascading
  // render the compiler lint rejects. -1 is "nothing has landed yet", so the
  // first attempt reads as loading from the first render.
  const [landed, setLanded] = useState<{ attempt: number; error: string | null }>({ attempt: -1, error: null });
  const loading = landed.attempt !== attempt;
  // A retry clears the previous failure the moment it starts, as before.
  const error = loading ? null : landed.error;
  // The latest callback, read when the load lands. Callers pass an inline
  // closure; listing it in the load effect's deps would refetch per render.
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });

  useEffect(() => {
    let live = true;
    loadCatalog()
      .then((c) => {
        if (!live) return;
        setCatalog(c);
        setLanded({ attempt, error: null });
        onLoadedRef.current?.(c);
      })
      .catch((e: unknown) => {
        // Was uncaught: a failed load became an unhandled rejection and left
        // the list permanently empty with nothing on screen to explain why.
        // fetchCatalog rejects once every base is unreachable.
        if (!live) return;
        setLanded({ attempt, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  return { catalog, setCatalog, loading, error, retry: () => setAttempt((n) => n + 1) };
}
