/**
 * Runtime loader for the reference data (motors, components, materials,
 * contributors).
 *
 * The data files live in `public/data/` (copied verbatim into the build like
 * the WASM engine, not compiled into the JS bundle) and are fetched at runtime.
 * That decouples the data from the app: refreshing a catalog is a matter of
 * overwriting the JSON on the host, no rebuild/redeploy of the app.
 *
 * Every dataset the app ships goes through here, whatever its size, not only the
 * 1.4 MB motor file: a table of materials under `src/` reads as source rather
 * than as a copy of the database it comes from, and drifts from it.
 *
 * `VITE_DATA_BASE` takes that a step further. Point it at a separately deployed
 * catalog host (the orphan `data` branch served over jsDelivr, published by
 * .github/workflows/sync-catalogs.yml) and refreshing a catalog needs no app
 * build and no Pages deploy at all, just a push to that branch. Left unset it
 * resolves to the in-build copy, which is what dev, preview and an unconfigured
 * build use. It serves the motors and components only: that branch is
 * refreshed by the catalog sync, which does not regenerate the materials or the
 * contributors, so those two are always read from the build.
 *
 * With a data host configured, the motors and components come from it and
 * nowhere else: such a build does not carry its own copy of them (vite.config.ts
 * leaves them out), so a catalog is never older than the published one. Offline,
 * the service worker answers from its cached copy of the download
 * (`astra-catalogs`). A worker-controlled page fills it through the worker's
 * own rule; the first visit is never controlled, so warmCatalogs.ts writes it
 * there itself, under the URLs from {@link dataHostUrls}.
 *
 * `manifest.json` (written by the sync scripts) carries a content hash per file;
 * we read it first (revalidated, tiny) and append it as `?v=<hash>` so a browser
 * or CDN can't serve a stale copy after the file is replaced. Missing manifest
 * just means no cache-buster: the fetch still works (and dev has none). The
 * manifest and the catalog are always read from the same base, so a hash never
 * gets paired with a different host's copy of the file.
 */

import { declaredLength, readStreamWithProgress, type TransferProgress } from './fetchProgress';
import { errorReason, KeyedError } from '../../i18n/keyedError';

/** The copy that ships inside the build, under the deploy subpath. */
const LOCAL_BASE = `${import.meta.env.BASE_URL}data/`;

/** Optional separately-deployed catalog host, normalized to a trailing slash.
 *  Blank/whitespace is treated as unset (an empty string would otherwise
 *  normalize to '/' and point the fetch at the server root). */
const configured = import.meta.env.VITE_DATA_BASE?.trim();
const REMOTE_BASE = configured ? configured.replace(/\/*$/, '/') : undefined;

/** Whether this build reads its motors and components from a data host. */
export const hasDataHost = (): boolean => REMOTE_BASE !== undefined && REMOTE_BASE !== LOCAL_BASE;

/**
 * Budgets are split into "is the host alive?" and "is the transfer moving?",
 * because one combined timeout cannot serve both. motors.generated.json is
 * ~1.4 MB (roughly 3 s on typical 4G but ~15 s on 3G and ~30 s throttled), so
 * any single budget generous enough to let a slow link finish is also a long
 * wait before a dead host gives up, and any budget short enough to fail fast
 * also severs downloads that were progressing perfectly well.
 *
 * Time-to-first-byte answers the first question and does not scale with file
 * size, so it can be short for everyone. Once headers arrive the host is alive
 * and the body gets a generous ceiling, which only exists to stop a host that
 * responds and then stalls forever from hanging the picker.
 */
const TTFB_TIMEOUT_MS = 8_000;
/** Ceiling on the body once it has started arriving, comfortably past the
 *  ~34 s a throttled link needs for the largest catalog. */
const BODY_TIMEOUT_MS = 60_000;
const MAX_CATALOG_BYTES = 32 * 1024 * 1024; // 32 MiB; the biggest bundled catalog is ~2 MiB

/** Bytes transferred so far, and the total when the host declared one. */
export type CatalogProgress = TransferProgress;

/**
 * Parse the body, metering it against {@link MAX_CATALOG_BYTES}.
 *
 * Always streams when a stream is available, progress wanted or not. The
 * `content-length` check in fetchJson only fires when the host declared a
 * length, and a chunked response declares none, so `res.json()` would read it
 * unmetered, which is the case the cap exists for. `manifest()` takes the
 * no-progress path. Falls back to `res.json()` only where there is no stream
 * to read (a stubbed Response in tests).
 */
async function readJson<T>(res: Response, onProgress?: (p: CatalogProgress) => void): Promise<T> {
  if (!res.body) return (await res.json()) as T;
  const report = onProgress ?? (() => {});
  const bytes = await readStreamWithProgress(res.body, declaredLength(res), report, MAX_CATALOG_BYTES);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** A download's progress as a whole percent, or null while its size is unknown. */
export function progressPercent(p: CatalogProgress | null | undefined): number | null {
  return p?.total ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : null;
}

/** A non-2xx reply, with its status, so a caller can tell "not there" (404,
 *  a fact about the host) from a transient failure worth retrying. */
export class HttpError extends KeyedError {
  constructor(readonly status: number) {
    super('errors.remote.http', { status });
    this.name = 'HttpError';
  }
}

/**
 * A failed `fetch` as a keyed reason. The browser's own text for a timeout
 * ("signal is aborted without reason") or a refused connection ("Failed to
 * fetch") is English whatever language the app shows, and it would land inside
 * a translated sentence.
 */
export function fetchFailure(e: unknown, timedOut: boolean): KeyedError {
  if (e instanceof KeyedError) return e;
  if (timedOut) return new KeyedError('errors.remote.timeout');
  if (e instanceof SyntaxError) return new KeyedError('errors.remote.badShape');
  return new KeyedError('errors.remote.network');
}

/** fetch + JSON with staged abort timeouts and a size cap, so a hung or
 *  oversized host response can't stall the picker or exhaust memory on parse. */
async function fetchJson<T>(
  url: string,
  ttfbMs: number,
  opts?: RequestInit,
  onProgress?: (p: CatalogProgress) => void,
): Promise<T> {
  const ctrl = new AbortController();
  let timedOut = false;
  const expire = () => {
    timedOut = true;
    ctrl.abort();
  };
  let timer = setTimeout(expire, ttfbMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    // Headers are in, so the host is alive: swap the first-byte budget for the
    // body one. Without this the first-byte budget would also have to cover the
    // whole download, and a slow link would be cut off mid-transfer.
    clearTimeout(timer);
    timer = setTimeout(expire, BODY_TIMEOUT_MS);
    if (!res.ok) throw new HttpError(res.status);
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > MAX_CATALOG_BYTES) throw new KeyedError('errors.remote.tooLarge');
    return await readJson<T>(res, onProgress);
  } catch (e) {
    // Any refusal aborts the body: a 5xx error page, a CDN's HTML or a reply
    // over the size cap would otherwise keep downloading after the failure is
    // reported.
    ctrl.abort();
    throw fetchFailure(e, timedOut);
  } finally {
    clearTimeout(timer);
  }
}

// Progress is published per catalog rather than returned, because fetchCatalog
// memoizes: the dashboard and the picker can both be waiting on one in-flight
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

/**
 * A manifest body as the map it must be: an object whose values are hashes.
 *
 * Anything else is read as no manifest at all, so the catalog is still fetched
 * from this host without a cache-buster, rather than a `null` body making
 * `manifest(base)[name]` throw and every catalog on the host fail without a
 * word. A non-string value is dropped, so it never reaches `?v=`.
 */
export function manifestEntries(body: unknown): Record<string, string> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return {};
  const out: Record<string, string> = {};
  for (const [name, hash] of Object.entries(body)) if (typeof hash === 'string' && hash) out[name] = hash;
  return out;
}

// One in-flight/settled manifest promise per base.
const manifestP = new Map<string, Promise<Record<string, string>>>();
function manifest(base: string): Promise<Record<string, string>> {
  let p = manifestP.get(base);
  if (!p) {
    // `no-cache` → the browser revalidates the (small) manifest with the server,
    // so a replaced catalog is picked up on the next load even behind a CDN.
    // A missing manifest (404) is not an error: `{}` just means no cache-buster,
    // and that answer is a fact about the host worth keeping. A transient
    // failure (network down, timeout, 5xx) is not: caching `{}` from one of
    // those would pin every later catalog fetch this session to "no buster", so a
    // catalog replaced on the host would keep being served from the browser cache.
    p = fetchJson<unknown>(`${base}manifest.json`, TTFB_TIMEOUT_MS, { cache: 'no-cache' }).then(
      manifestEntries,
      (e: unknown) => {
        if (!(e instanceof HttpError && e.status === 404)) manifestP.delete(base);
        return {};
      },
    );
    manifestP.set(base, p);
  }
  return p;
}

// One in-flight/settled promise per catalog, so repeated callers share a single
// network fetch for the whole session. A refresh of the file is picked up on the
// next page load, when the manifest hash and this cache both start fresh.
const catalogP = new Map<string, Promise<unknown>>();

/** Each runtime catalog, and the message that says it could not be loaded. */
const CATALOG_FAILED_KEY = {
  motors: 'errors.remote.motors',
  components: 'errors.remote.components',
  materials: 'errors.remote.materials',
  contributors: 'errors.remote.contributors',
} as const;

export type CatalogName = keyof typeof CATALOG_FAILED_KEY;

/**
 * Catalogs read from the build's own copy only, never from the data host. The
 * scheduled sync regenerates motors and components and nothing else: the
 * materials change with the code, and the contributors are refreshed by each
 * deploy. A copy on the data host is only as new as the last sync run, so
 * reading it first would serve an older file than the build carries.
 */
const BUILD_ONLY: ReadonlySet<CatalogName> = new Set(['materials', 'contributors']);

/** Where one catalog is read from. */
const baseFor = (name: CatalogName): string => (BUILD_ONLY.has(name) || !REMOTE_BASE ? LOCAL_BASE : REMOTE_BASE);

/** The URL one catalog is read from, cache-buster included. */
async function catalogUrl(name: CatalogName): Promise<string> {
  const base = baseFor(name);
  const hash = (await manifest(base))[name];
  return `${base}${name}.generated.json` + (hash ? `?v=${encodeURIComponent(hash)}` : '');
}

/**
 * The data-host URLs a page reads the named catalogs from: the host's manifest,
 * then each catalog with its cache-buster. The service worker's
 * `astra-catalogs` rule answers these offline and matches on the whole URL, so
 * these are its cache keys. Empty with no data host.
 */
export async function dataHostUrls(names: readonly CatalogName[]): Promise<string[]> {
  if (!hasDataHost() || !REMOTE_BASE) return [];
  return [`${REMOTE_BASE}manifest.json`, ...(await Promise.all(names.map(catalogUrl)))];
}

/**
 * Fetch and parse one runtime catalog by name (`'motors'` → `motors.generated.json`),
 * cache-busted by its manifest hash and memoized for the session. Rejects when
 * the catalog cannot be read, so the caller can surface it.
 */
export function fetchCatalog<T>(name: CatalogName, valid?: (v: unknown) => boolean): Promise<T> {
  let p = catalogP.get(name) as Promise<T> | undefined;
  if (!p) {
    p = (async () => {
      try {
        const body = await fetchJson<T>(await catalogUrl(name), TTFB_TIMEOUT_MS, undefined, (p) =>
          reportProgress(name, p),
        );
        // A host that is up but wrong: `{"error":"rebuilding"}` served with
        // HTTP 200 parses fine, and would leave the caller spreading a non-array.
        if (valid && !valid(body)) throw new KeyedError('errors.remote.badShape');
        return body;
      } catch (e) {
        // Drop the stale byte count so a retry starts clean.
        lastProgress.delete(name);
        throw new KeyedError(CATALOG_FAILED_KEY[name], { reason: errorReason(e) });
      }
    })();
    // Don't cache a failure; let the next caller retry.
    p.catch(() => catalogP.delete(name));
    catalogP.set(name, p);
  }
  return p;
}
