// i18n setup (react-i18next). English is the source-of-truth locale; other
// locales fall back to it for any missing key. Add a language by dropping a
// JSON file under locales/ and registering it in `resources` + LANGUAGES.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import es from './locales/es.json';

/** Selectable languages (code → native name), for the switcher. */
export const LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
];

i18n
  .use(LanguageDetector) // ?lng=, localStorage, then navigator
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
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
