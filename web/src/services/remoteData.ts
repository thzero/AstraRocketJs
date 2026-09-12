/**
 * Runtime loader for the reference catalogs (motors, components).
 *
 * The data files live in `public/data/` — copied verbatim into the build like
 * the WASM engine, NOT compiled into the JS bundle — and are fetched at runtime.
 * That decouples the data from the app: refreshing a catalog is a matter of
 * overwriting the JSON on the host, no rebuild/redeploy of the app.
 *
 * `VITE_DATA_BASE` takes that a step further. Point it at a separately deployed
 * catalog host — the orphan `data` branch served over jsDelivr, published by
 * .github/workflows/sync-catalogs.yml — and refreshing a catalog needs no app
 * build and no Pages deploy at all, just a push to that branch. Left unset it
 * resolves to the in-build copy, so dev, preview and an unconfigured build
 * behave exactly as they did before.
 *
 * The in-build copy is always kept as a fallback and tried second, so an
 * unreachable or not-yet-created data host degrades to a catalog frozen at the
 * last app deploy rather than an empty picker.
 *
 * `manifest.json` (written by the sync scripts) carries a content hash per file;
 * we read it first (revalidated, tiny) and append it as `?v=<hash>` so a browser
 * or CDN can't serve a stale copy after the file is replaced. Missing manifest
 * just means no cache-buster — the fetch still works (and dev has none). The
 * manifest and the catalog are always read from the SAME base, so a hash never
 * gets paired with a different host's copy of the file.
 */

import { declaredLength, readStreamWithProgress, type TransferProgress } from './fetchProgress';

/** The copy that ships inside the build, under the deploy subpath. */
const LOCAL_BASE = `${import.meta.env.BASE_URL}data/`;

/** Optional separately-deployed catalog host, normalized to a trailing slash.
 *  Blank/whitespace is treated as unset (an empty string would otherwise
 *  normalize to '/' and point the fetch at the server root). */
const configured = import.meta.env.VITE_DATA_BASE?.trim();
const REMOTE_BASE = configured ? configured.replace(/\/*$/, '/') : undefined;

/** Bases to try, in order. Collapses to a single entry when no separate host is
 *  configured (or it resolves to the local one), so we never fetch twice. */
const BASES = REMOTE_BASE && REMOTE_BASE !== LOCAL_BASE ? [REMOTE_BASE, LOCAL_BASE] : [LOCAL_BASE];

/**
 * Budgets are split into "is the host alive?" and "is the transfer moving?",
 * because one combined timeout cannot serve both. motors.generated.json is
 * ~1.6 MB — roughly 3 s on typical 4G but ~18 s on 3G and ~34 s throttled — so
 * any single budget generous enough to let a slow link finish is also a long
 * wait before a dead host gives up, and any budget short enough to fail fast
 * also severs downloads that were progressing perfectly well.
 *
 * Time-to-first-byte answers the first question and does NOT scale with file
 * size, so it can be short for everyone. Once headers arrive the host is alive
 * and the body gets a generous ceiling, which only exists to stop a host that
 * responds and then stalls forever from hanging the picker.
 */
const TTFB_TIMEOUT_MS = 8_000;
/** Shorter first-byte budget for a base that still has a fallback behind it: a
 *  host that REFUSES fails in milliseconds, but one that HANGS would otherwise
 *  burn the budget on the manifest and again on the catalog before we drop to
 *  the copy already sitting in the build. Only reachable when a separate data
 *  host is configured. */
const PROBE_TTFB_MS = 4_000;
/** Ceiling on the body once it has started arriving — comfortably past the
 *  ~34 s a throttled link needs for the largest catalog. */
const BODY_TIMEOUT_MS = 60_000;
const MAX_CATALOG_BYTES = 32 * 1024 * 1024; // 32 MiB — the biggest bundled catalog is ~2 MiB

/** First-byte budget for `base`: shorter while a fallback is still available. */
const ttfbFor = (base: string) => (base === BASES[BASES.length - 1] ? TTFB_TIMEOUT_MS : PROBE_TTFB_MS);

/** Bytes transferred so far, and the total when the host declared one. */
export type CatalogProgress = TransferProgress;

/** Parse the body, streaming it when the caller wants progress. Falls back to
 *  `res.json()` when progress is not wanted or the response exposes no stream. */
async function readJson<T>(res: Response, onProgress?: (p: CatalogProgress) => void): Promise<T> {
  if (!onProgress || !res.body) return (await res.json()) as T;
  const bytes = await readStreamWithProgress(res.body, declaredLength(res), onProgress, MAX_CATALOG_BYTES);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** fetch + JSON with staged abort timeouts and a declared-size cap, so a hung or
 *  oversized host response can't stall the picker or exhaust memory on parse. */
async function fetchJson<T>(
  url: string,
  ttfbMs: number,
  opts?: RequestInit,
  onProgress?: (p: CatalogProgress) => void,
): Promise<T> {
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), ttfbMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    // Headers are in, so the host is alive: swap the first-byte budget for the
    // body one. Without this the first-byte budget would also have to cover the
    // whole download, and a slow link would be cut off mid-transfer.
    clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort(), BODY_TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > MAX_CATALOG_BYTES) throw new Error('response too large');
    return await readJson<T>(res, onProgress);
  } finally {
    clearTimeout(timer);
  }
}

// Progress is published per catalog rather than returned, because fetchCatalog
// memoizes: the dashboard and the picker can both be waiting on ONE in-flight
// download, and a component that subscribes late still needs the current figure.
const progressListeners = new Map<string, Set<(p: CatalogProgress) => void>>();
const lastProgress = new Map<string, CatalogProgress>();

/** Watch a catalog's download. Fires immediately with the latest known figure if
 *  one is already in flight. Returns an unsubscribe. */
export function subscribeCatalogProgress(name: string, cb: (p: CatalogProgress) => void): () => void {
  let set = progressListeners.get(name);
  if (!set) progressListeners.set(name, (set = new Set()));
  set.add(cb);
  const last = lastProgress.get(name);
  if (last) cb(last);
  return () => {
    set.delete(cb);
  };
}

function reportProgress(name: string, p: CatalogProgress): void {
  lastProgress.set(name, p);
  for (const cb of progressListeners.get(name) ?? []) cb(p);
}

// One in-flight/settled manifest promise per base — the fallback base is only
// ever fetched if the primary one actually fails.
const manifestP = new Map<string, Promise<Record<string, string>>>();
function manifest(base: string): Promise<Record<string, string>> {
  let p = manifestP.get(base);
  if (!p) {
    // `no-cache` → the browser revalidates the (small) manifest with the server,
    // so a replaced catalog is picked up on the next load even behind a CDN.
    // A missing manifest is not an error: `{}` just means no cache-buster.
    p = fetchJson<Record<string, string>>(`${base}manifest.json`, ttfbFor(base), { cache: 'no-cache' }).catch(
      () => ({}),
    );
    manifestP.set(base, p);
  }
  return p;
}

// One in-flight/settled promise per catalog, so repeated callers share a single
// network fetch for the whole session (the old build-time `import()` was
// module-cached; this restores that). A refresh of the file is picked up on the
// next page load, when the manifest hash — and this cache — start fresh.
const catalogP = new Map<string, Promise<unknown>>();

/**
 * Fetch and parse one runtime catalog by name (`'motors'` → `motors.generated.json`),
 * cache-busted by its manifest hash and memoized for the session. Tries each
 * configured base in order and rejects with the LAST failure only when every
 * base is unreachable, so the caller can surface it.
 */
export function fetchCatalog<T>(name: string): Promise<T> {
  let p = catalogP.get(name) as Promise<T> | undefined;
  if (!p) {
    p = (async () => {
      let lastErr: unknown;
      for (const base of BASES) {
        try {
          const hash = (await manifest(base))[name];
          return await fetchJson<T>(
            `${base}${name}.generated.json` + (hash ? `?v=${hash}` : ''),
            ttfbFor(base),
            undefined,
            (p) => reportProgress(name, p),
          );
        } catch (e) {
          lastErr = e; // try the next base (the in-build fallback copy)
        }
      }
      // Every base failed: drop the stale byte count so a retry starts clean.
      lastProgress.delete(name);
      throw new Error(
        `Could not load the ${name} catalog (${lastErr instanceof Error ? lastErr.message : String(lastErr)})`,
      );
    })();
    // Don't cache a failure — let the next caller retry.
    p.catch(() => catalogP.delete(name));
    catalogP.set(name, p);
  }
  return p;
}
