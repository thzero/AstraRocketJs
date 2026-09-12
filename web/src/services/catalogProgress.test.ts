import { describe, it, expect, vi, afterEach } from 'vitest';

// Progress needs a response with a REAL ReadableStream body; the stub in
// remoteData.test.ts deliberately has none (it exercises the res.json() path).

type Chunk = string;

/** A Response-alike whose body streams `chunks`, with an optional declared length. */
function streamingResponse(chunks: Chunk[], declareLength = true) {
  const enc = new TextEncoder();
  const parts = chunks.map((c) => enc.encode(c));
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h === 'content-length' && declareLength ? String(total) : null) },
    body: {
      getReader: () => ({
        read: () =>
          Promise.resolve(i < parts.length ? { done: false, value: parts[i++] } : { done: true, value: undefined }),
      }),
    },
    json: () => Promise.resolve(JSON.parse(chunks.join(''))),
  } as unknown as Response;
}

async function load() {
  vi.resetModules();
  return await import('./remoteData');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('catalog download progress', () => {
  it('reports rising byte counts and the declared total', async () => {
    const payload = JSON.stringify([{ designation: 'H128' }, { designation: 'J350' }]);
    const half = Math.ceil(payload.length / 2);
    vi.stubGlobal('fetch', (url: string) =>
      Promise.resolve(
        url.includes('manifest')
          ? ({ ok: true, headers: { get: () => null }, json: () => Promise.resolve({}) } as unknown as Response)
          : streamingResponse([payload.slice(0, half), payload.slice(half)]),
      ),
    );
    const { fetchCatalog, subscribeCatalogProgress } = await load();

    const seen: { loaded: number; total: number | null }[] = [];
    const off = subscribeCatalogProgress('motors', (p) => seen.push(p));
    await expect(fetchCatalog('motors')).resolves.toEqual([{ designation: 'H128' }, { designation: 'J350' }]);
    off();

    expect(seen.length).toBeGreaterThan(1);
    expect(seen[0]!.loaded).toBe(0);
    expect(seen[seen.length - 1]!.loaded).toBe(payload.length);
    expect(seen.every((p) => p.total === payload.length)).toBe(true);
    // Monotonic: a bar that goes backwards is worse than no bar.
    expect(seen.map((p) => p.loaded)).toEqual([...seen.map((p) => p.loaded)].sort((a, b) => a - b));
  });

  it('reports a null total when the host declares no content-length', async () => {
    const payload = JSON.stringify({ count: 0, components: [] });
    vi.stubGlobal('fetch', (url: string) =>
      Promise.resolve(
        url.includes('manifest')
          ? ({ ok: true, headers: { get: () => null }, json: () => Promise.resolve({}) } as unknown as Response)
          : streamingResponse([payload], false),
      ),
    );
    const { fetchCatalog, subscribeCatalogProgress } = await load();

    const seen: (number | null)[] = [];
    subscribeCatalogProgress('components', (p) => seen.push(p.total));
    await fetchCatalog('components');

    // The UI uses this to choose an indeterminate bar over a wrong percentage.
    expect(seen.every((t) => t === null)).toBe(true);
  });

  it('replays the latest figure to a late subscriber sharing the same download', async () => {
    const payload = JSON.stringify([1, 2, 3]);
    vi.stubGlobal('fetch', (url: string) =>
      Promise.resolve(
        url.includes('manifest')
          ? ({ ok: true, headers: { get: () => null }, json: () => Promise.resolve({}) } as unknown as Response)
          : streamingResponse([payload]),
      ),
    );
    const { fetchCatalog, subscribeCatalogProgress } = await load();

    await fetchCatalog('motors');
    // The dashboard and the picker both wait on ONE memoized download; whichever
    // mounts second must still see a figure rather than a blank bar.
    const late: number[] = [];
    subscribeCatalogProgress('motors', (p) => late.push(p.loaded));
    expect(late).toEqual([payload.length]);
  });

  it('unsubscribes cleanly', async () => {
    const payload = JSON.stringify([1]);
    vi.stubGlobal('fetch', (url: string) =>
      Promise.resolve(
        url.includes('manifest')
          ? ({ ok: true, headers: { get: () => null }, json: () => Promise.resolve({}) } as unknown as Response)
          : streamingResponse([payload]),
      ),
    );
    const { fetchCatalog, subscribeCatalogProgress } = await load();

    const seen: number[] = [];
    const off = subscribeCatalogProgress('motors', (p) => seen.push(p.loaded));
    off();
    await fetchCatalog('motors');
    expect(seen).toEqual([]);
  });
});
