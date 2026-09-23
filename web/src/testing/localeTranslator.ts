import type { Translate } from '../services/flightPathExport';

/**
 * A {@link Translate} over a REAL locale bundle, for tests of code that writes
 * translated strings into a file.
 *
 * Real strings rather than a stub, for the same reason the component tests use
 * real i18n: an assertion then reads like the file a user opens, and a renamed
 * or missing key fails in a test instead of shipping a raw key into a KML.
 *
 * Interpolation is i18next's `{{name}}`, done here rather than pulled in, so a
 * node-environment test needs no i18next instance.
 */
export function localeTranslator(bundle: unknown): Translate {
  return (key, vars) => {
    const raw = key
      .split('.')
      .reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), bundle);
    const text = typeof raw === 'string' ? raw : key;
    return vars ? text.replace(/{{(\w+)}}/g, (_m, name: string) => String(vars[name] ?? '')) : text;
  };
}
