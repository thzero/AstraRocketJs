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

const FETCH_TIMEOUT_MS = 15_000;
const MAX_CATALOG_BYTES = 32 * 1024 * 1024; // 32 MiB — the biggest bundled catalog is ~2 MiB

/** fetch + JSON with an abort timeout and a declared-size cap, so a hung or
 *  oversized host response can't stall the picker or exhaust memory on parse. */
async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > MAX_CATALOG_BYTES) throw new Error('response too large');
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

let manifestP: Promise<Record<string, string>> | null = null;
function manifest(): Promise<Record<string, string>> {
  // `no-cache` → the browser revalidates the (small) manifest with the server,
  // so a replaced catalog is picked up on the next load even behind a CDN.
  return (manifestP ??= fetchJson<Record<string, string>>(dataUrl('manifest.json'), { cache: 'no-cache' }).catch(
    () => ({}),
  ));
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
      try {
        return await fetchJson<T>(url);
      } catch (e) {
        throw new Error(`Could not load the ${name} catalog (${e instanceof Error ? e.message : String(e)})`);
      }
    })();
    // Don't cache a failure — let the next caller retry.
    p.catch(() => catalogP.delete(name));
    catalogP.set(name, p);
  }
  return p;
}
