import { useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query currently matches, as React state.
 *
 * Almost everything responsive in this app is a Tailwind `lg:` class, and should
 * stay that way — CSS needs no JavaScript and no re-render. This is for the one
 * case classes cannot express: a component that must exist in exactly ONE place
 * in the DOM, but a different place per breakpoint.
 *
 * Rendering it twice and hiding one copy is the usual trick, and it is wrong
 * here. A hidden copy is still in the document: its inputs still carry the same
 * `aria-label`, so "the Ignition select" resolves to two elements, and the
 * accessibility tree of a phone-sized viewport carries a desktop column nobody
 * can reach. `display:none` hides pixels, not identity.
 *
 * `useSyncExternalStore` rather than an effect + state, so the first render
 * already has the right answer and there is no flash of the wrong layout.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    // Server/prerender: no viewport to measure, so answer "not desktop" and let
    // the first client render correct it.
    () => false,
  );
}

/** The `lg:` breakpoint, as a boolean. Keep in step with Tailwind's default. */
export const useIsDesktop = (): boolean => useMediaQuery('(min-width: 1024px)');
