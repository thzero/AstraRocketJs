// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

vi.mock('../../src/engine/simClient', () => ({ warmSimWorker: vi.fn() }));
vi.mock('../../src/services/storage/persistStorage', () => ({
  requestPersistentStorage: vi.fn(() => Promise.resolve(true)),
}));

import i18n, { languageReady, localeBackend } from '../../src/i18n';
import de from '../../src/i18n/locales/de.json';
import { useWorkspaceEffects } from '../../src/state/useWorkspaceEffects';
import { useWorkspaceStore } from '../../src/state/store';
import { getWorkspaceStore } from '../../src/services/storage/workspaceStore';
import { SavePartButton } from '../../src/components/design/SavePartButton';
import { renderWithProviders } from '../testing/renderWithProviders';

/**
 * Text kept as a string is worded in the language the user reads, even when
 * that language's bundle arrives after the app has mounted. Here the German
 * bundle is held until the moment each test releases it.
 */

let release: () => void;
const originalRead = localeBackend.read.bind(localeBackend);

const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

beforeEach(() => {
  // jsdom has no matchMedia; dialogs ask it which layout they are in.
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
  // Dropped from the store directly: `removeResourceBundle` also drops the
  // namespace, after which nothing loads at all.
  delete (i18n.store.data as Record<string, unknown>).de;
  let pending: (() => void) | null = null;
  release = () => pending?.();
  localeBackend.read = (_lng, _ns, done) => {
    pending = () => done(null, de);
  };
  void i18n.changeLanguage('de');
});

afterEach(async () => {
  localeBackend.read = originalRead;
  i18n.addResourceBundle('de', 'translation', de, true, true);
  await i18n.changeLanguage('en');
  vi.restoreAllMocks();
});

function Host() {
  useWorkspaceEffects();
  return null;
}

describe('a locale bundle that lands after the app mounts', () => {
  it('words the boot warning in that language', async () => {
    vi.spyOn(getWorkspaceStore(), 'load').mockRejectedValue(new Error('unreadable'));
    renderWithProviders(<Host />);
    await act(flush);
    await act(async () => {
      release();
      await flush();
    });

    expect(useWorkspaceStore.getState().storageWarning).toBe(de.storage.loadFailed);
  });

  it('stops waiting for a bundle that never lands', async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      void languageReady().then(() => (settled = true));
      await flush();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
      release();
    }
  });

  it('seeds the save-part form in that language', async () => {
    renderWithProviders(<SavePartButton node={{ type: 'bodytube', id: 'tube' }} type="bodytube" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
      await flush();
    });
    await act(async () => {
      release();
      await flush();
    });

    expect((document.getElementById('save-part-no') as HTMLInputElement).value).toBe(de.part.bodytube);
    expect((document.getElementById('save-part-mfr') as HTMLInputElement).value).toBe(de.picker.saveDefaultMfr);
  });
});
