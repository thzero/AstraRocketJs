// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';

vi.mock('../../src/engine/simClient', () => ({ warmSimWorker: vi.fn() }));
vi.mock('../../src/services/storage/persistStorage', () => ({
  requestPersistentStorage: vi.fn(() => Promise.resolve(true)),
}));

import i18n, { localeBackend } from '../../src/i18n';
import de from '../../src/i18n/locales/de.json';
import { useWorkspaceEffects } from '../../src/state/useWorkspaceEffects';
import { useWorkspaceStore } from '../../src/state/store';
import { getWorkspaceStore } from '../../src/services/storage/workspaceStore';
import { appName } from '../../src/services/app/appInfo';
import { renderWithProviders } from '../testing/renderWithProviders';

/**
 * A first run in a language whose bundle lands after the app has mounted.
 * The store builds the default design as the app mounts, so its names are the
 * English fallback until the bundle is in; the design the user starts from,
 * and the one the first edit saves, is named in the user's language.
 */

let release: () => void;
const originalRead = localeBackend.read.bind(localeBackend);

const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

beforeEach(() => {
  // Dropped from the store directly: `removeResourceBundle` also drops the
  // namespace, after which nothing loads at all.
  delete (i18n.store.data as Record<string, unknown>).de;
  let pending: (() => void) | null = null;
  release = () => pending?.();
  localeBackend.read = (_lng, _ns, done) => {
    pending = () => done(null, de);
  };
  void i18n.changeLanguage('de');
  // The default design as the store builds it before the bundle lands.
  useWorkspaceStore.getState().resetWorkspace();
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

const s = () => useWorkspaceStore.getState();

/** The German names, from the German bundle. */
const german = () => ({
  design: de.app.designName.replace('{{name}}', appName()),
  stage: de.stageName.sustainer,
  sim: de.sims.untitled.replace('{{n}}', '1'),
});

describe('the default design on a first run in another language', () => {
  it.each([
    ['nothing is stored', () => Promise.resolve(null)],
    ['the stored design cannot be read', () => Promise.reject(new Error('unreadable'))],
  ])('is named in that language when %s', async (_what, read) => {
    const english = s().tree.name;
    expect(english).not.toBe(german().design);
    vi.spyOn(getWorkspaceStore(), 'load').mockImplementation(read as never);
    renderWithProviders(<Host />);
    await act(flush);
    await act(async () => {
      release();
      await flush();
    });

    expect(s().tree.name).toBe(german().design);
    expect(s().tree.components[0]!.name).toBe(german().stage);
    expect(s().sims[0]!.name).toBe(german().sim);
  });

  it('is not saved for the renaming alone', async () => {
    vi.spyOn(getWorkspaceStore(), 'load').mockResolvedValue(null);
    const save = vi.spyOn(getWorkspaceStore(), 'save');
    renderWithProviders(<Host />);
    await act(flush);
    await act(async () => {
      release();
      await flush();
    });
    expect(s().tree.name).toBe(german().design);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps an edit made before the bundle lands', async () => {
    let resolveLoad: (w: null) => void = () => {};
    vi.spyOn(getWorkspaceStore(), 'load').mockReturnValue(new Promise((r) => (resolveLoad = r)));
    renderWithProviders(<Host />);
    await act(flush);
    act(() => s().addPartToTree('bodytube'));
    const edited = s().tree;
    await act(async () => {
      resolveLoad(null);
      release();
      await flush();
    });
    expect(s().tree).toBe(edited);
  });
});
