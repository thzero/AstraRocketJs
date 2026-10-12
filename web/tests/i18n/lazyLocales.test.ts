import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import i18n, { LANGUAGES, localeBackend } from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import de from '../../src/i18n/locales/de.json';

/**
 * Only English ships in the app's own chunk; every other locale is fetched when
 * it is the language in use. The test setup registers every bundle up front
 * (tests/testing/allLocales.ts), so these read the module's imports and its
 * backend rather than the shared instance's store.
 */
describe('locale loading', () => {
  // A static import puts the bundle in the app's chunk, and the worker's.
  it('imports only English statically', () => {
    const source = readFileSync(new URL('../../src/i18n/index.ts', import.meta.url), 'utf8');
    const statics = [...source.matchAll(/^import\s[^;]*?from\s+'(\.\/locales\/[^']+)'/gm)].map((m) => m[1]);
    expect(statics).toEqual(['./locales/en.json']);
    expect(i18n.options.partialBundledLanguages).toBe(true);
  });

  it('fetches every selectable language', async () => {
    for (const { code } of LANGUAGES) {
      const [err, bundle] = await new Promise<unknown[]>((resolve) =>
        localeBackend.read(code, 'translation', (...result) => resolve(result)),
      );
      expect(err, code).toBeNull();
      expect(bundle, code).toBeTypeOf('object');
    }
  });

  it('reports a language it does not have', async () => {
    const err = await new Promise<unknown>((resolve) => localeBackend.read('xx', 'translation', (e) => resolve(e)));
    expect(err).toBeInstanceOf(Error);
  });

  it('translates once the chosen bundle arrives', async () => {
    const fresh = createInstance();
    await fresh.use(localeBackend).init({
      lng: 'de',
      fallbackLng: 'en',
      resources: { en: { translation: en } },
      partialBundledLanguages: true,
    });
    expect(fresh.t('stageName.sustainer')).toBe(de.stageName.sustainer);
    expect(fresh.t('stageName.sustainer')).not.toBe(en.stageName.sustainer);
  });
});
