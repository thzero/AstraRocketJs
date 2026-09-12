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
  return (await import('./remoteData')).fetchCatalog;
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
