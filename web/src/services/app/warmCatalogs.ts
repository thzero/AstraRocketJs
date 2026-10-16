import { hasDataHost } from './remoteData';

/**
 * Download the motor and parts catalogs in the background once the app is up,
 * when they come from the data host.
 *
 * Such a build carries no copy of its own, so offline they exist only as the
 * service worker's cached download. Fetched only when a picker first opens, an
 * app installed online and opened at a field with no signal would have no
 * motors and no parts. Fetching them while idle fills that cache on the first
 * visit, and the memoized result makes the first picker open instant.
 *
 * Through the catalogs' own loaders, not `fetchCatalog` directly: the first
 * caller's shape check is the one the memoized promise carries.
 */
export function warmCatalogs(): void {
  if (!hasDataHost()) return;
  const warm = () => {
    // A failure is not reported here: it is not memoized, and the picker that
    // needs the catalog tries again and says what went wrong.
    // Imported here, so the loaders stay out of the startup bundle.
    void import('../motors/motorDb').then((m) => m.loadCatalog()).catch(() => {});
    void import('../parts/componentDb').then((m) => m.loadCatalog()).catch(() => {});
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 10_000 });
  else setTimeout(warm, 2_000);
}
