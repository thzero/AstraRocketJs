// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const loadMotors = vi.fn(() => Promise.resolve([]));
const loadComponents = vi.fn(() => Promise.resolve({ components: [] }));
vi.mock('../../../src/services/motors/motorDb', () => ({ loadCatalog: loadMotors }));
vi.mock('../../../src/services/parts/componentDb', () => ({ loadCatalog: loadComponents }));

async function warm(): Promise<void> {
  vi.resetModules();
  const { warmCatalogs } = await import('../../../src/services/app/warmCatalogs');
  warmCatalogs();
  await vi.advanceTimersByTimeAsync(11_000);
}

beforeEach(() => {
  vi.useFakeTimers();
  loadMotors.mockClear();
  loadComponents.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

const HOST = 'https://cdn.test/gh/owner/repo@data/';
const MANIFEST = { motors: 'abc123', components: 'def456' };

/**
 * A worker that is active and, when `controlled`, controls the page; a host
 * answering every URL with 200; and the Cache API recording each write.
 */
function stubWorker(controlled: boolean): { opened: string[]; put: string[]; fetched: string[] } {
  const seen = { opened: [] as string[], put: [] as string[], fetched: [] as string[] };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller: controlled ? {} : null, ready: Promise.resolve({}) },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      seen.fetched.push(url);
      const body = url.endsWith('manifest.json') ? MANIFEST : [];
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
  vi.stubGlobal('caches', {
    open: vi.fn((name: string) => {
      seen.opened.push(name);
      return Promise.resolve({
        put: vi.fn((url: string) => {
          seen.put.push(url);
          return Promise.resolve();
        }),
      });
    }),
  });
  return seen;
}

/**
 * A data-host build carries no copy of the motors or components, so offline they
 * exist only as the service worker's cached download. Fetched only when a picker
 * opens, an app installed online and first used at a field with no signal would
 * have none.
 */
describe('warmCatalogs', () => {
  it('downloads both hosted catalogs through their own loaders once the app is idle', async () => {
    vi.stubEnv('VITE_DATA_BASE', 'https://cdn.test/gh/owner/repo@data/');
    await warm();
    expect(loadMotors).toHaveBeenCalledOnce();
    expect(loadComponents).toHaveBeenCalledOnce();
  });

  it('fetches nothing early in a build that reads its own copy', async () => {
    vi.stubEnv('VITE_DATA_BASE', '');
    await warm();
    expect(loadMotors).not.toHaveBeenCalled();
    expect(loadComponents).not.toHaveBeenCalled();
  });

  // The worker's rule stores only what a page it controls fetches, and the
  // first visit is never controlled, so there the app writes the cache itself,
  // under the keys the rule reads offline.
  it('writes each loaded catalog and the manifest to astra-catalogs on an uncontrolled page', async () => {
    vi.stubEnv('VITE_DATA_BASE', HOST);
    const seen = stubWorker(false);
    await warm();
    expect(new Set(seen.opened)).toEqual(new Set(['astra-catalogs']));
    expect(new Set(seen.put)).toEqual(
      new Set([
        `${HOST}manifest.json`,
        `${HOST}motors.generated.json?v=abc123`,
        `${HOST}components.generated.json?v=def456`,
      ]),
    );
  });

  it('leaves the cache to the worker on a page it controls', async () => {
    vi.stubEnv('VITE_DATA_BASE', HOST);
    const seen = stubWorker(true);
    await warm();
    expect(loadMotors).toHaveBeenCalledOnce();
    expect(seen.opened).toEqual([]);
    expect(seen.put).toEqual([]);
  });

  it('stores nothing for a catalog that failed to load', async () => {
    vi.stubEnv('VITE_DATA_BASE', HOST);
    const seen = stubWorker(false);
    loadMotors.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    await warm();
    expect(seen.put.some((u) => u.includes('motors'))).toBe(false);
    expect(seen.put).toContain(`${HOST}components.generated.json?v=def456`);
  });

  it('swallows a failed download, which the picker retries and reports', async () => {
    vi.stubEnv('VITE_DATA_BASE', 'https://cdn.test/gh/owner/repo@data/');
    loadMotors.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    await expect(warm()).resolves.toBeUndefined();
  });
});
