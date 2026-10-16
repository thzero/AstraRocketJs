/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /**
   * Optional base URL for the separately-deployed runtime catalogs (motors,
   * components). Set at build time to serve them from the `data` branch and
   * nowhere else: such a build leaves its own copy out (vite.config.ts). See
   * services/app/remoteData.ts and .github/workflows/sync-catalogs.yml. Unset →
   * the copy in public/data.
   */
  readonly VITE_DATA_BASE?: string;
}
