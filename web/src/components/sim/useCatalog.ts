import { useState } from 'react';
import { loadCatalog, type CatalogMotor } from '../../services/motors/motorDb';
import { useAsyncLoad } from '../common/useAsyncLoad';

/**
 * The motor catalog, loaded once on mount, with the loading / error / retry
 * state both motor dialogs render around it.
 *
 * On mount, with no `open` guard: the dialogs that use this are mounted only
 * while open (`{open && <Dialog />}`), so mounting is the deferral. Kept mounted
 * and returning null when closed, the dialogs would fetch the multi-megabyte catalog
 * (see services/app/remoteData.ts) on app start, since `return null` does not stop an
 * effect.
 *
 * `onLoaded` fires once per successful load with the catalog it produced. The
 * picker seeds its selection from the seated motor there, which is the one
 * moment the list exists and nothing has been clicked yet.
 */
export function useCatalog({ onLoaded }: { onLoaded?: (catalog: CatalogMotor[]) => void } = {}) {
  const [catalog, setCatalog] = useState<CatalogMotor[]>([]);
  // A failed load is reported, not swallowed: an empty list with nothing on
  // screen to explain it reads as a catalog with no motors. fetchCatalog
  // rejects once every base is unreachable.
  const { loading, error, retry } = useAsyncLoad(loadCatalog, 'motors', {
    onLoaded: (c) => {
      setCatalog(c);
      onLoaded?.(c);
    },
  });
  return { catalog, setCatalog, loading, error, retry };
}
