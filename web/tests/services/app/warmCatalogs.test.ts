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
});

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

  it('swallows a failed download, which the picker retries and reports', async () => {
    vi.stubEnv('VITE_DATA_BASE', 'https://cdn.test/gh/owner/repo@data/');
    loadMotors.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    await expect(warm()).resolves.toBeUndefined();
  });
});
