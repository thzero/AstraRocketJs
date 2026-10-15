import { afterEach, describe, it, expect, vi } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The docs footer names the app version in every locale.
 *
 * The line lives in `website/docusaurus.config.ts`, which Docusaurus loads once
 * per locale with DOCUSAURUS_CURRENT_LOCALE set. A `copyright` entry in a
 * locale's `docusaurus-theme-classic/footer.json` replaces the config's line,
 * and a translation file cannot carry the version, so none may have one.
 */
const repo = fileURLToPath(new URL('../../', import.meta.url));
const { version } = JSON.parse(readFileSync(`${repo}web/package.json`, 'utf8')) as { version: string };

type FooterConfig = { default: { themeConfig: { footer: { copyright: string } } } };

/** The footer line the config builds with DOCUSAURUS_CURRENT_LOCALE set to `locale`, or unset. */
const footerFor = async (locale: string | undefined): Promise<string> => {
  if (locale === undefined) vi.stubEnv('DOCUSAURUS_CURRENT_LOCALE', undefined);
  else vi.stubEnv('DOCUSAURUS_CURRENT_LOCALE', locale);
  vi.resetModules();
  const mod = (await import('../../website/docusaurus.config')) as unknown as FooterConfig;
  return mod.default.themeConfig.footer.copyright;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('docs footer', () => {
  it.each([['en'], ['es'], [undefined]])('names v<version> with the locale %s', async (locale) => {
    expect(await footerFor(locale)).toContain(`v${version}`);
  });

  // `docusaurus start` with no --locale stores the string "undefined".
  it.each([[undefined], ['undefined']])('reads the default locale when the locale is %s', async (locale) => {
    expect(await footerFor(locale)).toBe(await footerFor('en'));
  });

  it('is in Spanish for es', async () => {
    const es = await footerFor('es');
    // cspell:disable-next-line
    expect(es).toContain('Documentación de AstraRocketJs');
    expect(es).not.toBe(await footerFor('en'));
  });

  it('is not overridden by a translation file', () => {
    const locales = globSync('*/', { cwd: `${repo}website/i18n` });
    expect(locales.length).toBeGreaterThan(0);
    for (const file of globSync('*/docusaurus-theme-classic/footer.json', { cwd: `${repo}website/i18n` })) {
      const footer = JSON.parse(readFileSync(`${repo}website/i18n/${file}`, 'utf8')) as Record<string, unknown>;
      expect(Object.keys(footer), file).not.toContain('copyright');
    }
  });
});
