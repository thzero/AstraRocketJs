import { useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query currently matches, as React state.
 *
 * Almost everything responsive in this app is a Tailwind `lg:` class, and should
 * stay that way: CSS needs no JavaScript and no re-render. This is for the one
 * case classes cannot express: a component that must exist in exactly one place
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
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    // Server/prerender: no viewport to measure, so answer "no match" and let
    // the first client render correct it.
    () => false,
  );
}

/** The `lg:` breakpoint, as a boolean. Keep in step with Tailwind's default. */
export const useIsDesktop = (): boolean => useMediaQuery('(min-width: 1024px)');

/**
 * The `2xl:` breakpoint, as a boolean.
 *
 * The Design tab's property column needs the window to be this wide: it is a
 * third column beside the component tree and the drawing, and under 1536 the
 * three of them leave the drawing too little to be a drawing. An ordinary
 * laptop is on the dialog, which is the point: 1280 and 1440 are the widths
 * this is about, not only phones. Below it the component editor is a dialog
 * instead (see components/design/ComponentDialog), which is why this is a
 * JavaScript query rather than a `2xl:` class: the editor has to exist in
 * exactly one of the two places, never both.
 *
 * The header's save status says how long ago the write landed only from here
 * up (see layout/SaveStatus), for the same reason: "Saved just now" and
 * "Saved" are one status, and rendering both would put two of them on screen
 * for every role and text query.
 */
export const useIsWide = (): boolean => useMediaQuery('(min-width: 1536px)');
