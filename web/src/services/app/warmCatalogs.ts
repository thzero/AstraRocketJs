import { dataHostUrls, hasDataHost, type CatalogName } from './remoteData';

/** The service worker's runtime cache for the data host (vite.config.ts). */
const CATALOG_CACHE = 'astra-catalogs';

/**
 * Download the motor and parts catalogs in the background once the app is up,
 * when they come from the data host.
 *
 * Such a build carries no copy of its own, so offline they exist only in the
 * service worker's `astra-catalogs` cache. Fetched only when a picker first
 * opens, an app installed online and opened at a field with no signal would
 * have no motors and no parts. Fetching them while idle fills that cache, and
 * the memoized result makes the first picker open instant.
 *
 * The worker's rule stores only what a page it controls fetches, and the first
 * visit is never controlled: the worker installs during it but takes the page
 * only on the next load. On an uncontrolled page each catalog that loaded is
 * written to the cache here instead (see {@link keepForOffline}).
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
    const loads: [CatalogName, Promise<unknown>][] = [
      ['motors', import('../motors/motorDb').then((m) => m.loadCatalog())],
      ['components', import('../parts/componentDb').then((m) => m.loadCatalog())],
    ];
    for (const [name, load] of loads) {
      void load.then(() => keepForOffline(name)).catch(() => {});
    }
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 10_000 });
  else setTimeout(warm, 2_000);
}

/**
 * Store one loaded catalog, and the host manifest that names its hash, in the
 * worker's catalog cache when this page is not under the worker's control.
 *
 * Written once the worker is active, under exactly the URLs the app requests
 * (so the `astra-catalogs` rules, which match on the whole URL, find them
 * offline: the manifest's network-first rule and the catalogs'
 * stale-while-revalidate one), and only as the 200 response their
 * `cacheableResponse` rule admits. The catalog rule's expiration plugin starts
 * tracking an entry the first time the worker serves it.
 * `force-cache` takes the bodies from the HTTP cache the loader just filled
 * rather than downloading them again.
 */
async function keepForOffline(name: CatalogName): Promise<void> {
  const sw = navigator.serviceWorker as ServiceWorkerContainer | undefined;
  if (!sw || sw.controller || typeof caches === 'undefined') return;
  await sw.ready;
  if (sw.controller) return;
  const cache = await caches.open(CATALOG_CACHE);
  for (const url of await dataHostUrls([name])) {
    const res = await fetch(url, { cache: 'force-cache' });
    if (res.status === 200) await cache.put(url, res);
  }
}
