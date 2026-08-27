import i18n from '../i18n';

/**
 * Single source for the app's identity:
 *  - the display NAME comes from the translated `app.title` i18n string, so it's
 *    localizable and defined in exactly one place per locale;
 *  - the VERSION comes from package.json, injected at build time by Vite
 *    (`__APP_VERSION__`, see vite.config.ts + globals.d.ts).
 *
 * Everything (UI and non-React code) should read the name/version from here
 * rather than hard-coding "AstraRocketJs" or a version literal.
 */

/** Build version from package.json (e.g. "0.1.0"). */
export const APP_VERSION: string = __APP_VERSION__;

/** The app's display name — translated (i18next singleton; safe outside React). */
export const appName = (): string => i18n.t('app.title');

/** Name + version, e.g. "AstraRocketJs 0.1.0". */
export const appLabel = (): string => `${appName()} ${APP_VERSION}`;

/** Default name for a new / exported design, e.g. "AstraRocketJs design" (translated). */
export const defaultDesignName = (): string => i18n.t('app.designName', { name: appName() });
