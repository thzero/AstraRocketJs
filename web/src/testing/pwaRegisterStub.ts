/**
 * Stand-in for `virtual:pwa-register/react` under Vitest.
 *
 * That specifier is synthesized by `vite-plugin-pwa`, which only runs in the
 * app build - under Vitest the import fails at resolution time, before any
 * `vi.mock` can intercept it, so `UpdateToast` could not be rendered in a test
 * at all. `vitest.config.ts` aliases the specifier here to give the resolver
 * something real; a test that cares about the registration then `vi.mock`s it
 * as usual.
 *
 * The default is the quiet case: no waiting worker, nothing to announce.
 */
export function useRegisterSW(_options?: {
  onRegisteredSW?: (url: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
}): {
  needRefresh: [boolean, (v: boolean) => void];
  offlineReady: [boolean, (v: boolean) => void];
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
} {
  return {
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  };
}
