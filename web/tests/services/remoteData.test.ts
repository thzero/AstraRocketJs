import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// remoteData resolves its bases at MODULE LOAD from import.meta.env, and memoizes
// every fetch for the session — so each case stubs the env, resets the module
// registry, and imports a fresh copy.

type Route = { status?: number; body?: unknown; fail?: boolean; hang?: boolean; bodyMs?: number };

/** Install a fetch stub over a url→response table; returns the URLs it saw. */
function stubFetch(routes: Record<string, Route>) {
  const seen: string[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    seen.push(url);
    // Match ignoring the ?v=<hash> cache-buster.
    const route = routes[url.split('?')[0]!];
    if (!route || route.fail) return Promise.reject(new Error('network down'));
    // A host that accepts the connection and then never answers — the case the
    // short probe timeout exists for. Settles only when fetchJson aborts it.
    if (route.hang)
      return new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      });
    return Promise.resolve({
      ok: (route.status ?? 200) < 400,
      status: route.status ?? 200,
      headers: { get: () => null },
      json: () =>
        route.bodyMs == null
          ? Promise.resolve(route.body)
          : // A response whose headers arrived but whose body is still streaming —
            // a slow link, not a dead host. Abortable, like a real body stream.
            new Promise((res, rej) => {
              const t = setTimeout(() => res(route.body), route.bodyMs);
              init?.signal?.addEventListener('abort', () => {
                clearTimeout(t);
                rej(new Error('aborted'));
              });
            }),
    } as unknown as Response);
  });
  return seen;
}

async function load() {
  vi.resetModules();
  return (await import('../../src/services/remoteData')).fetchCatalog;
}

const REMOTE = 'https://cdn.test/gh/owner/repo@data/';

beforeEach(() => vi.stubEnv('VITE_DATA_BASE', ''));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('fetchCatalog — no separate data host configured', () => {
  it('reads the in-build copy and cache-busts with the manifest hash', async () => {
    const seen = stubFetch({
      '/data/manifest.json': { body: { motors: 'abc123' } },
      '/data/motors.generated.json': { body: [{ designation: 'H128' }] },
    });
    const fetchCatalog = await load();

    await expect(fetchCatalog('motors')).resolves.toEqual([{ designation: 'H128' }]);
    expect(seen).toEqual(['/data/manifest.json', '/data/motors.generated.json?v=abc123']);
  });

  it('still fetches the catalog when the manifest is missing (no buster)', async () => {
    const seen = stubFetch({
      '/data/manifest.json': { status: 404 },
      '/data/components.generated.json': { body: { count: 0, components: [] } },
    });
    const fetchCatalog = await load();

    await expect(fetchCatalog('components')).resolves.toEqual({ count: 0, components: [] });
    expect(seen).toContain('/data/components.generated.json');
  });

  it('memoizes per catalog, so repeat callers share one fetch', async () => {
    const seen = stubFetch({
      '/data/manifest.json': { body: {} },
      '/data/motors.generated.json': { body: [] },
    });
    const fetchCatalog = await load();

    await Promise.all([fetchCatalog('motors'), fetchCatalog('motors'), fetchCatalog('motors')]);
    expect(seen.filter((u) => u.startsWith('/data/motors'))).toHaveLength(1);
  });
});

describe('fetchCatalog — separate data host configured', () => {
  it('prefers the remote host and uses ITS manifest hash', async () => {
    vi.stubEnv('VITE_DATA_BASE', REMOTE);
    const seen = stubFetch({
      [`${REMOTE}manifest.json`]: { body: { motors: 'fresh99' } },
      [`${REMOTE}motors.generated.json`]: { body: ['remote'] },
      '/data/manifest.json': { body: { motors: 'stale11' } },
      '/data/motors.generated.json': { body: ['local'] },
    });
    const fetchCatalog = await load();

    await expect(fetchCatalog('motors')).resolves.toEqual(['remote']);
    expect(seen).toEqual([`${REMOTE}manifest.json`, `${REMOTE}motors.generated.json?v=fresh99`]);
    // The in-build copy is never touched while the host is healthy.
    expect(seen.some((u) => u.startsWith('/data/'))).toBe(false);
  });

  it('falls back to the in-build copy when the host is unreachable', async () => {
    vi.stubEnv('VITE_DATA_BASE', REMOTE);
    const seen = stubFetch({
      [`${REMOTE}manifest.json`]: { fail: true },
      [`${REMOTE}motors.generated.json`]: { fail: true },
      '/data/manifest.json': { body: { motors: 'stale11' } },
      '/data/motors.generated.json': { body: ['local'] },
    });
    const fetchCatalog = await load();

    await expect(fetchCatalog('motors')).resolves.toEqual(['local']);
    // Pairs the LOCAL hash with the LOCAL file — never the remote manifest's.
    expect(seen).toContain('/data/motors.generated.json?v=stale11');
  });

  it('falls back when the host 404s (data branch not created yet)', async () => {
    vi.stubEnv('VITE_DATA_BASE', REMOTE);
    stubFetch({
      [`${REMOTE}manifest.json`]: { status: 404 },
      [`${REMOTE}motors.generated.json`]: { status: 404 },
      '/data/manifest.json': { body: {} },
      '/data/motors.generated.json': { body: ['local'] },
    });
    const fetchCatalog = await load();

    await expect(fetchCatalog('motors')).resolves.toEqual(['local']);
  });

  it('falls back when the host is UP but serving the wrong shape', async () => {
    // The nastiest case for a fallback chain: `{"error":"rebuilding"}` with
    // HTTP 200 parses fine, so the loop used to return it and never try the
    // in-build copy. The caller then spread a non-array and threw
    // "bundled is not iterable" into the motor picker.
    vi.stubEnv('VITE_DATA_BASE', REMOTE);
    stubFetch({
      [`${REMOTE}manifest.json`]: { body: { motors: 'h1' } },
      [`${REMOTE}motors.generated.json`]: { body: { error: 'rebuilding' } },
      '/data/manifest.json': { body: { motors: 'local1' } },
      '/data/motors.generated.json': { body: ['local'] },
    });
    const fetchCatalog = await load();

    await expect(fetchCatalog('motors', Array.isArray)).resolves.toEqual(['local']);
  });

  it('still rejects when EVERY base serves the wrong shape', async () => {
    vi.stubEnv('VITE_DATA_BASE', REMOTE);
    stubFetch({
      [`${REMOTE}manifest.json`]: { body: {} },
      [`${REMOTE}motors.generated.json`]: { body: { error: 'rebuilding' } },
      '/data/manifest.json': { body: {} },
      '/data/motors.generated.json': { body: { error: 'rebuilding' } },
    });
    const fetchCatalog = await load();

    await expect(fetchCatalog('motors', Array.isArray)).rejects.toThrow(/Could not load the motors catalog/);
  });

  it('rejects with the last error only when every base fails', async () => {
    vi.stubEnv('VITE_DATA_BASE', REMOTE);
    stubFetch({});
    const fetchCatalog = await load();

    await expect(fetchCatalog('motors')).rejects.toThrow(/Could not load the motors catalog/);
  });

  it('does not cache a total failure — a later call retries', async () => {
    vi.stubEnv('VITE_DATA_BASE', REMOTE);
    const routes: Record<string, Route> = {
      [`${REMOTE}manifest.json`]: { fail: true },
      [`${REMOTE}motors.generated.json`]: { fail: true },
      '/data/manifest.json': { fail: true },
      '/data/motors.generated.json': { fail: true },
    };
    stubFetch(routes);
    const fetchCatalog = await load();

    await expect(fetchCatalog('motors')).rejects.toThrow();
    routes['/data/motors.generated.json'] = { body: ['recovered'] };
    await expect(fetchCatalog('motors')).resolves.toEqual(['recovered']);
  });

  it('gives up on a HUNG host after the short probe timeout, not the full one', async () => {
    vi.stubEnv('VITE_DATA_BASE', REMOTE);
    vi.useFakeTimers();
    try {
      stubFetch({
        [`${REMOTE}manifest.json`]: { hang: true },
        [`${REMOTE}motors.generated.json`]: { hang: true },
        '/data/manifest.json': { body: { motors: 'stale11' } },
        '/data/motors.generated.json': { body: ['local'] },
      });
      const fetchCatalog = await load();

      const p = fetchCatalog('motors');
      // Still pending just under the probe window...
      await vi.advanceTimersByTimeAsync(3_900);
      let settled = false;
      void p.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);

      // ...and the manifest attempt aborts at 4s, then the catalog attempt at 8s,
      // after which it drops to the in-build copy. Well inside one 15s timeout.
      await vi.advanceTimersByTimeAsync(4_200);
      await expect(p).resolves.toEqual(['local']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the in-build copy a longer first-byte budget than the probe base', async () => {
    vi.stubEnv('VITE_DATA_BASE', REMOTE);
    vi.useFakeTimers();
    try {
      stubFetch({
        [`${REMOTE}manifest.json`]: { fail: true },
        [`${REMOTE}motors.generated.json`]: { fail: true },
        '/data/manifest.json': { body: {} },
        '/data/motors.generated.json': { hang: true },
      });
      const fetchCatalog = await load();

      const caught = fetchCatalog('motors').catch((e: Error) => e.message);
      // The 4s probe budget would already have killed it here.
      await vi.advanceTimersByTimeAsync(5_000);
      let settled = false;
      void caught.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);

      // ...but it does give up at 8s, not the old 15s.
      await vi.advanceTimersByTimeAsync(3_500);
      await expect(caught).resolves.toMatch(/Could not load the motors catalog/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a SLOW body finish — a 1.6 MB catalog on 3G outlasts any first-byte budget', async () => {
    vi.useFakeTimers();
    try {
      // Headers land immediately; the body takes 30s, as ~1.6 MB does on a
      // throttled link. A single combined budget would have aborted this.
      stubFetch({
        '/data/manifest.json': { body: { motors: 'abc123' } },
        '/data/motors.generated.json': { body: ['slow-but-complete'], bodyMs: 30_000 },
      });
      const fetchCatalog = await load();

      const p = fetchCatalog('motors');
      await vi.advanceTimersByTimeAsync(31_000);
      await expect(p).resolves.toEqual(['slow-but-complete']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still aborts a body that arrives and then stalls forever', async () => {
    vi.useFakeTimers();
    try {
      stubFetch({
        '/data/manifest.json': { body: {} },
        '/data/motors.generated.json': { body: ['never'], bodyMs: 10 * 60_000 },
      });
      const fetchCatalog = await load();

      const caught = fetchCatalog('motors').catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(61_000);
      await expect(caught).resolves.toMatch(/Could not load the motors catalog/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a blank VITE_DATA_BASE as unset rather than pointing at the server root', async () => {
    vi.stubEnv('VITE_DATA_BASE', '   ');
    const seen = stubFetch({
      '/data/manifest.json': { body: {} },
      '/data/motors.generated.json': { body: ['local'] },
    });
    const fetchCatalog = await load();

    await expect(fetchCatalog('motors')).resolves.toEqual(['local']);
    expect(seen).not.toContain('/manifest.json');
  });
});

/**
 * The size cap has to apply to bytes RECEIVED, not to a header the host may not
 * send — and `manifest()` is the call that proves it.
 *
 * `fetchCatalog` always passes an onProgress (it publishes progress per
 * catalog), so the catalog body was streamed and capped all along. `manifest()`
 * passes none, and the old `readJson` sent exactly that case to `res.json()`
 * with no meter at all. A chunked manifest — no content-length, so the declared
 * -size check cannot fire either — buffered without bound.
 */
describe('the manifest body is metered, not just the catalog', () => {
  it('stops pulling an endless chunked manifest instead of buffering it whole', async () => {
    const CHUNK = 4 * 1024 * 1024; // 4 MiB
    let manifestChunksPulled = 0;

    const endlessManifest = () => {
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          manifestChunksPulled++;
          // Far more than the 32 MiB cap if anything reads to the end.
          if (manifestChunksPulled > 200) return c.close();
          c.enqueue(new Uint8Array(CHUNK));
        },
      });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null }, // no content-length: the declared check is blind here
        // A real Response.json() DRAINS the body. Modeling that is the whole
        // point — a stub that ignores the body cannot tell a metered read from
        // an unmetered one, and reports success either way.
        json: async () => {
          const r = body.getReader();
          for (;;) if ((await r.read()).done) break;
          return {};
        },
        body,
      } as unknown as Response;
    };

    vi.stubGlobal('fetch', (url: string) =>
      Promise.resolve(
        url.includes('manifest')
          ? endlessManifest()
          : ({
              ok: true,
              status: 200,
              headers: { get: () => null },
              json: () => Promise.resolve([{ designation: 'H128' }]),
              body: new ReadableStream<Uint8Array>({
                start(c) {
                  c.enqueue(new TextEncoder().encode('[{"designation":"H128"}]'));
                  c.close();
                },
              }),
            } as unknown as Response),
      ),
    );

    const fetchCatalog = await load();
    // A failed manifest is not an error — it just means no cache-buster — so the
    // catalog still loads. The point is what it cost to get there.
    await expect(fetchCatalog('motors')).resolves.toEqual([{ designation: 'H128' }]);

    // 32 MiB / 4 MiB = 8 chunks, plus the one that trips the limit. Unmetered,
    // res.json() drained all 200.
    expect(manifestChunksPulled).toBeLessThanOrEqual(10);
  });
});

describe('manifest failures', () => {
  it('does not cache a {} manifest from a TRANSIENT failure: the next catalog re-reads it', async () => {
    let manifestUp = false;
    const seen: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      seen.push(url);
      const path = url.split('?')[0]!;
      if (path === '/data/manifest.json') {
        if (!manifestUp) return Promise.reject(new Error('network down'));
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () => Promise.resolve({ components: 'h2' }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve([1]),
      } as unknown as Response);
    });
    const fetchCatalog = await load();

    await fetchCatalog('motors'); // manifest down: no buster, but not remembered as "none"
    expect(seen).toEqual(['/data/manifest.json', '/data/motors.generated.json']);

    manifestUp = true;
    await fetchCatalog('components');
    // Re-read, and this time the hash is applied.
    expect(seen.slice(2)).toEqual(['/data/manifest.json', '/data/components.generated.json?v=h2']);
  });

  it('DOES remember a 404 manifest (a fact about the host), fetching it once', async () => {
    const seen = stubFetch({
      '/data/manifest.json': { status: 404 },
      '/data/motors.generated.json': { body: [] },
      '/data/components.generated.json': { body: { count: 0, components: [] } },
    });
    const fetchCatalog = await load();
    await fetchCatalog('motors');
    await fetchCatalog('components');
    expect(seen.filter((u) => u === '/data/manifest.json')).toHaveLength(1);
  });

  it('aborts the body of a non-2xx reply rather than leaving it streaming', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      signals.push(init!.signal!);
      const path = url.split('?')[0]!;
      if (path === '/data/manifest.json')
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () => Promise.resolve({}),
        } as unknown as Response);
      return Promise.resolve({
        ok: false,
        status: 503,
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      } as unknown as Response);
    });
    const fetchCatalog = await load();
    await expect(fetchCatalog('motors')).rejects.toThrow(/HTTP 503/);
    // The catalog request's controller was aborted on the 503.
    expect(signals[1]!.aborted).toBe(true);
    expect(signals[0]!.aborted).toBe(false);
  });
});
