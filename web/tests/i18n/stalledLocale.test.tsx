// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import { createInstance, type BackendModule } from 'i18next';
import { I18nextProvider, useTranslation } from 'react-i18next';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';

/**
 * A browser set to a language other than English fetches that locale's bundle
 * at boot. A fetch that never settles (a stalled connection, not a failed one)
 * must not keep the UI from rendering: nothing above the app catches a
 * component that suspends, so the boot screen would stay up for good.
 *
 * Booted with the app's own i18n options and a bundle fetch that never answers.
 */
describe('a locale bundle that never arrives', () => {
  it('renders the English text rather than nothing', async () => {
    const stalled: BackendModule = { type: 'backend', init: () => {}, read: () => {} };
    const booting = createInstance();
    void booting.use(stalled).init({
      ...i18n.options,
      lng: 'de',
      resources: { en: { translation: en } },
      initAsync: false,
    });
    expect(booting.language).toBe('de');

    function Probe() {
      const { t } = useTranslation();
      return createElement('p', null, t('file.new'));
    }
    await act(async () => {
      render(createElement(I18nextProvider, { i18n: booting }, createElement(Probe)));
    });
    expect(screen.getByText(en.file.new)).toBeTruthy();
  });
});
