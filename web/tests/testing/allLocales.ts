import i18n from '../../src/i18n';

/**
 * Every locale registered before a test runs. The app fetches a non-English
 * bundle when it is chosen, so `changeLanguage` settles a tick later; the tests
 * switch language and read the next render straight away, which needs the
 * bundle already in place.
 */
const bundles = import.meta.glob<{ default: Record<string, unknown> }>('../../src/i18n/locales/*.json', {
  eager: true,
});
for (const [path, bundle] of Object.entries(bundles)) {
  const code = /([^/]+)\.json$/.exec(path)![1]!;
  i18n.addResourceBundle(code, 'translation', bundle.default, true, true);
}
