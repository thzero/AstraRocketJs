// @vitest-environment jsdom
import { afterAll, describe, expect, it } from 'vitest';
import i18n from '../../src/i18n';

/** A screen reader picks its voice from the page's `lang`, so it follows the UI. */
describe('the page language', () => {
  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('follows the language the UI shows', async () => {
    await i18n.changeLanguage('es');
    expect(document.documentElement.lang).toBe('es');
    await i18n.changeLanguage('pt-BR');
    expect(document.documentElement.lang).toBe('pt-BR');
  });
});
