/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /**
   * Optional base URL for the separately-deployed runtime catalogs (motors,
   * components). Set at build time to serve them from the `data` branch instead
   * of the copy inside the build — see services/remoteData.ts and
   * .github/workflows/sync-catalogs.yml. Unset → the in-build copy.
   */
  readonly VITE_DATA_BASE?: string;
}
