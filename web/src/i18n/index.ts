// i18n setup (react-i18next). English is the source-of-truth locale; other
// locales fall back to it for any missing key. Add a language by dropping a
// JSON file under locales/ and adding ONE row to LOCALES below.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import de from './locales/de.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import ptBR from './locales/pt-BR.json';
import ptPT from './locales/pt-PT.json';
import nl from './locales/nl.json';
import pl from './locales/pl.json';
import ru from './locales/ru.json';
import ja from './locales/ja.json';

/**
 * Every locale, once: its code, its native name for the switcher, and its
 * bundle. `LANGUAGES` and `resources` are both derived from this, where they
 * used to be two lists that had to be kept in step by hand (a bundle
 * registered but not selectable, or the reverse, compiled fine).
 *
 * A code carries a region only when the variants are genuinely different
 * translations rather than one with an accent moved. Brazilian and European
 * Portuguese diverge in about a third of these strings: in everyday vocabulary,
 * in the nouns this app leans on hardest (rocket, stage, launch pad, thrust,
 * drag, landing are each a different word), and in how a verb in progress is
 * built. So they ship as two files, not one.
 *
 * ORDER MATTERS for a region-tagged pair: a browser asking for a bare language,
 * or for a region we do not ship, lands on the FIRST matching row here. See
 * resolve.test.ts, which pins every case.
 */
const LOCALES = [
  { code: 'en', name: 'English', translation: en },
  { code: 'de', name: 'Deutsch', translation: de },
  { code: 'es', name: 'Español', translation: es },
  { code: 'fr', name: 'Français', translation: fr },
  { code: 'pt-BR', name: 'Português (Brasil)', translation: ptBR },
  { code: 'pt-PT', name: 'Português (Portugal)', translation: ptPT },
  { code: 'nl', name: 'Nederlands', translation: nl },
  { code: 'pl', name: 'Polski', translation: pl },
  { code: 'ru', name: 'Русский', translation: ru },
  { code: 'ja', name: '日本語', translation: ja },
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
    // NO `load: 'languageOnly'`. It used to be here so a browser set to
    // es-ES / es-MX resolved to our 'es' bundle, but it strips the region from
    // every code, which would have collapsed pt-BR and pt-PT onto a 'pt' we do
    // not ship, sending every Portuguese browser to English. i18next's
    // best-match already does the widening we wanted: an unshipped region falls
    // back to the base language when we ship one ('es-MX' → 'es'), and to the
    // first matching region when we ship only regions ('pt' → 'pt-BR').
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
