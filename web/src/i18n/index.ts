// i18n setup (react-i18next). English is the source-of-truth locale; other
// locales fall back to it for any missing key. Add a language by dropping a
// JSON file under locales/ and adding ONE row to LOCALES below.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import es from './locales/es.json';

/**
 * Every locale, once: its code, its native name for the switcher, and its
 * bundle. `LANGUAGES` and `resources` are both derived from this, where they
 * used to be two lists that had to be kept in step by hand (a bundle
 * registered but not selectable, or the reverse, compiled fine).
 */
const LOCALES = [
  { code: 'en', name: 'English', translation: en },
  { code: 'es', name: 'Español', translation: es },
] as const;

/** Selectable languages (code → native name), for the switcher. */
export const LANGUAGES: { code: string; name: string }[] = LOCALES.map(({ code, name }) => ({ code, name }));

i18n
  .use(LanguageDetector) // ?lng=, localStorage, then navigator
  .use(initReactI18next)
  .init({
    resources: Object.fromEntries(LOCALES.map((l) => [l.code, { translation: l.translation }])),
    fallbackLng: 'en',
    supportedLngs: LANGUAGES.map((l) => l.code),
    // Match on the base language only, so a browser set to es-ES / es-MX / etc.
    // resolves to our 'es' bundle instead of falling back to English.
    load: 'languageOnly',
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      caches: ['localStorage'],
      // App-namespaced so we don't collide with another i18next app on the same
      // origin (the detector's default key is a bare 'i18nextLng').
      lookupLocalStorage: 'astrarrocketjs:i18nextLng',
    },
  });

export default i18n;
