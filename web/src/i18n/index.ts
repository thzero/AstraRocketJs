// i18n setup (react-i18next). English is the source-of-truth locale; other
// locales fall back to it for any missing key. Add a language by dropping a
// JSON file under locales/ and adding one row to LOCALES below.
import i18n, { type BackendModule, type ResourceKey } from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import { nsKey } from '../services/storage/storageKeys';

/** A locale file's module, as a dynamic import returns it. */
type LocaleModule = Promise<{ default: ResourceKey }>;

/**
 * Every locale, once: its code, its native name for the switcher, and how its
 * bundle loads. `LANGUAGES` and the loader are both derived from this, so a
 * bundle cannot be loadable without being selectable, or the reverse.
 *
 * English is bundled with the app: it is the fallback for every missing key, so
 * it has to be there before anything renders. Every other locale is its own
 * chunk, fetched only when it is the language in use; each is over 100 kB and a
 * browser only ever needs one.
 *
 * A code carries a region only when the variants are genuinely different
 * translations rather than one with an accent moved. Brazilian and European
 * Portuguese diverge in about a third of these strings: in everyday vocabulary,
 * in the nouns this app leans on hardest (rocket, stage, launch pad, thrust,
 * drag, landing are each a different word), and in how a verb in progress is
 * built. So they ship as two files, not one.
 *
 * Order matters for a region-tagged pair: a browser asking for a bare language,
 * or for a region we do not ship, lands on the first matching row here. See
 * resolve.test.ts, which pins every case.
 */
const LOCALES = [
  { code: 'en', name: 'English', load: () => Promise.resolve({ default: en }) },
  { code: 'de', name: 'Deutsch', load: () => import('./locales/de.json') },
  { code: 'es', name: 'Español', load: () => import('./locales/es.json') },
  { code: 'fr', name: 'Français', load: () => import('./locales/fr.json') },
  { code: 'pt-BR', name: 'Português (Brasil)', load: () => import('./locales/pt-BR.json') },
  { code: 'pt-PT', name: 'Português (Portugal)', load: () => import('./locales/pt-PT.json') },
  { code: 'nl', name: 'Nederlands', load: () => import('./locales/nl.json') },
  { code: 'pl', name: 'Polski', load: () => import('./locales/pl.json') },
  { code: 'ru', name: 'Русский', load: () => import('./locales/ru.json') },
  { code: 'ja', name: '日本語', load: () => import('./locales/ja.json') },
] as const satisfies readonly { code: string; name: string; load: () => LocaleModule }[];

/** Selectable languages (code → native name), for the switcher. */
export const LANGUAGES: { code: string; name: string }[] = LOCALES.map(({ code, name }) => ({ code, name }));

/**
 * Fetches a locale's bundle the first time i18next asks for it. A failed fetch
 * (offline before the chunk was cached, or a deploy that removed it) is reported
 * to i18next, which then shows the English fallback rather than raw keys.
 */
export const localeBackend: BackendModule = {
  type: 'backend',
  init: () => {},
  read: (language, _namespace, done) => {
    const row = LOCALES.find((l) => l.code === language);
    if (!row) {
      done(new Error(`no locale ${language}`), false);
      return;
    }
    row.load().then(
      (m) => done(null, m.default),
      (e: unknown) => done(e instanceof Error ? e : new Error(String(e)), false),
    );
  },
};

// The page's language follows the UI's, so a screen reader reads Spanish text
// with Spanish pronunciation; index.html can only say `en`. Bound before init,
// so the first language set is caught too. No document in the sim worker.
i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
});

i18n
  .use(LanguageDetector) // ?lng=, localStorage, then navigator
  .use(localeBackend)
  .use(initReactI18next)
  .init({
    // English up front; the backend fetches any other language when it is chosen.
    resources: { en: { translation: en } },
    partialBundledLanguages: true,
    fallbackLng: 'en',
    supportedLngs: LANGUAGES.map((l) => l.code),
    // No `load: 'languageOnly'`: it strips the region from every code,
    // collapsing pt-BR and pt-PT onto a 'pt' we do not ship and sending every
    // Portuguese browser to English. i18next's best-match already widens
    // correctly: an unshipped region falls back to the base language when we
    // ship one ('es-MX' → 'es'), and to the first matching region when we ship
    // only regions ('pt' → 'pt-BR').
    interpolation: { escapeValue: false }, // React already escapes
    // No suspending while a locale loads. No Suspense boundary sits above the
    // app, so a component that suspends on a locale fetch that never settles
    // keeps the whole UI from appearing. Not ready, `t` reads the English
    // fallback, and the components render again when the bundle arrives.
    react: { useSuspense: false },
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      caches: ['localStorage'],
      // App-namespaced so we don't collide with another i18next app on the same
      // origin (the detector's default key is a bare 'i18nextLng').
      lookupLocalStorage: nsKey('i18nextLng'),
    },
  })
  // A locale that fails to fetch does not reject this: i18next falls back to
  // English. A rejection means the config above is wrong. It is still handled
  // rather than dropped, because the failure mode is the app coming up showing
  // raw translation keys, and without this nothing anywhere says why.
  //
  // `console.error` and not the store's error banner: this runs at module load,
  // before the store exists, and a broken i18n cannot translate its own message.
  .catch((e: unknown) => {
    console.error('i18n init failed; the UI will show raw keys', e);
  });

/**
 * The longest `languageReady` waits for a locale bundle. A bundle that has not
 * arrived by then is stalled, and the boot carries on in English rather than
 * hold the stored design back.
 */
export const LANGUAGE_WAIT_MS = 3000;

/**
 * Whether the language in use has its bundle, or its fetch has failed (which
 * leaves English).
 *
 * Asked of `language` itself: until its bundle is in, i18next resolves to
 * English and would report English as loaded. A change still loading leaves
 * `language` on the one before; i18next marks it in `isLanguageChangingTo`,
 * which its types leave out.
 */
export function isLanguageReady(instance: typeof i18n = i18n): boolean {
  const changing = (instance as typeof instance & { isLanguageChangingTo?: string }).isLanguageChangingTo;
  return instance.isInitialized && !changing && instance.hasLoadedNamespace('translation', { lng: instance.language });
}

/**
 * Settles once {@link isLanguageReady}, or after `ceilingMs`, whichever is first.
 *
 * For text worked out once and kept as a string, such as a note or a warning
 * in the store: `t` called before the bundle lands returns the English
 * fallback, and nothing translates the kept string when the bundle arrives.
 */
export function languageReady(instance: typeof i18n = i18n, ceilingMs = LANGUAGE_WAIT_MS): Promise<void> {
  if (isLanguageReady(instance)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      instance.off('initialized', check);
      instance.off('loaded', check);
      instance.off('languageChanged', check);
      resolve();
    };
    const check = () => {
      if (isLanguageReady(instance)) done();
    };
    const timer = setTimeout(done, ceilingMs);
    instance.on('initialized', check);
    instance.on('loaded', check);
    // Also emitted when the fetch failed, leaving the English fallback.
    instance.on('languageChanged', check);
  });
}

export default i18n;
