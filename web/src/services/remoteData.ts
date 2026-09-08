/**
 * Runtime loader for the bundled reference catalogs (motors, components).
 *
 * The data files live in `public/data/` — copied verbatim into the build like
 * the WASM engine, NOT compiled into the JS bundle — and are fetched at runtime.
 * That decouples the data from the app: refreshing a catalog is a matter of
 * overwriting the JSON on the host, no rebuild/redeploy of the app.
 *
 * `manifest.json` (written by the sync scripts) carries a content hash per file;
 * we read it first (revalidated, tiny) and append it as `?v=<hash>` so a browser
 * or CDN can't serve a stale copy after the file is replaced. Missing manifest
 * just means no cache-buster — the fetch still works (and dev has none).
 */

/** Base-path aware URL for a file under `public/data/` (respects the deploy subpath). */
const dataUrl = (path: string) => `${import.meta.env.BASE_URL}data/${path}`;

let manifestP: Promise<Record<string, string>> | null = null;
function manifest(): Promise<Record<string, string>> {
  // `no-cache` → the browser revalidates the (small) manifest with the server,
  // so a replaced catalog is picked up on the next load even behind a CDN.
  return (manifestP ??= fetch(dataUrl('manifest.json'), { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : {}))
    .catch(() => ({})));
}

// One in-flight/settled promise per catalog, so repeated callers share a single
// network fetch for the whole session (the old build-time `import()` was
// module-cached; this restores that). A refresh of the file is picked up on the
// next page load, when the manifest hash — and this cache — start fresh.
const catalogP = new Map<string, Promise<unknown>>();

/**
 * Fetch and parse one runtime catalog by name (`'motors'` → `motors.generated.json`),
 * cache-busted by its manifest hash and memoized for the session. Rejects on a
 * network / HTTP error so the caller can surface it.
 */
export function fetchCatalog<T>(name: string): Promise<T> {
  let p = catalogP.get(name) as Promise<T> | undefined;
  if (!p) {
    p = (async () => {
      const hash = (await manifest())[name];
      const url = dataUrl(`${name}.generated.json`) + (hash ? `?v=${hash}` : '');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load the ${name} catalog (HTTP ${res.status})`);
      return (await res.json()) as T;
    })();
    // Don't cache a failure — let the next caller retry.
    p.catch(() => catalogP.delete(name));
    catalogP.set(name, p);
  }
  return p;
}
