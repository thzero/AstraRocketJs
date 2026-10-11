import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * An example fetch that fails rejects with a keyed reason. The reason lands in
 * a translated sentence (`errors.openExample`), so the browser's English or an
 * English sentence of our own would show untranslated in it.
 */
async function load() {
  vi.resetModules();
  return import('../../../src/services/storage/exampleLibrary');
}

afterEach(() => vi.unstubAllGlobals());

const reply = (status: number, body: unknown = {}) =>
  Promise.resolve({ ok: status < 400, status, statusText: 'Not Found', json: () => Promise.resolve(body) });

describe('example fetch failures', () => {
  it('keys an HTTP failure by its status', async () => {
    vi.stubGlobal('fetch', () => reply(404));
    const { fetchExample } = await load();
    await expect(fetchExample('a.ork')).rejects.toMatchObject({ key: 'errors.remote.http', values: { status: 404 } });
  });

  it('keys a refused connection', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const { loadExampleIndex } = await load();
    await expect(loadExampleIndex()).rejects.toMatchObject({ name: 'KeyedError', key: 'errors.remote.network' });
  });

  it('keys an index with no examples', async () => {
    vi.stubGlobal('fetch', () => reply(200, { generated: '' }));
    const { loadExampleIndex } = await load();
    await expect(loadExampleIndex()).rejects.toMatchObject({ key: 'errors.remote.noExamples' });
  });
});
