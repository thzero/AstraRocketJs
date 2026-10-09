import { useSyncExternalStore } from 'react';

/**
 * The 3D views' colors, as tokens (src/index.css, `--c-scene-*`).
 *
 * three.js and a 2D canvas take a color value and cannot resolve a CSS
 * variable, so the views read each token's current value here and redraw when
 * it changes: a theme is a class or attribute on the root element, or the
 * system's light/dark preference, and either one is watched. The token values
 * are written as hex so every three.js color parser reads them.
 *
 * What the scene shows of the rocket itself (part paint, the motor flame, the
 * parachute's lines) is not here: that is the rocket's color in any theme.
 */
export const SCENE_TOKENS = [
  'scene-sky',
  'scene-ground',
  'scene-floor',
  'scene-grid',
  'scene-grid-minor',
  'scene-marker',
  'scene-light-key',
  'scene-light-fill',
  'scene-callout',
  'scene-callout-light',
  'scene-selected',
  'scene-selected-glow',
  'scene-cg',
  'scene-cp',
  'scene-stable-ok',
  'scene-stable-over',
  'scene-stable-under',
] as const;

export type SceneToken = (typeof SCENE_TOKENS)[number];
export type SceneColors = Readonly<Record<SceneToken, string>>;

/** What a token reads as where no stylesheet is loaded (a unit test's DOM). */
const UNRESOLVED = '#808080';

let cached: { key: string; colors: SceneColors } | null = null;
/**
 * Whether the cached colors may be out of date. `getSnapshot` runs on every
 * render of every subscriber (the 3D flight path renders about ten times a
 * second while it plays), and a fresh read forces a style resolution, so the
 * colors are re-read only after something that can change them: a change the
 * subscription saw, a new subscription, or a stretch with no subscriber
 * watching.
 */
let stale = true;
let watchers = 0;

function snapshot(): SceneColors {
  if (cached && !stale) return cached.colors;
  const style = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  const values = SCENE_TOKENS.map((name) => style?.getPropertyValue(`--c-${name}`).trim() || UNRESOLVED);
  const key = values.join('|');
  // The same object while nothing changed, so a memo keyed on it holds.
  if (cached?.key !== key) {
    cached = { key, colors: Object.fromEntries(SCENE_TOKENS.map((n, i) => [n, values[i]!])) as SceneColors };
  }
  // Trusted only while a subscription is watching for the next change.
  stale = watchers === 0;
  return cached.colors;
}

function subscribe(onChange: () => void): () => void {
  watchers++;
  // A change made before this observer existed is never delivered to it, and
  // React reads the snapshot once more right after subscribing: re-read then.
  stale = true;
  const changed = () => {
    stale = true;
    onChange();
  };
  const root = document.documentElement;
  const observer = new MutationObserver(changed);
  observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
  const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  scheme?.addEventListener('change', changed);
  return () => {
    watchers--;
    if (watchers === 0) stale = true;
    observer.disconnect();
    scheme?.removeEventListener('change', changed);
  };
}

/** The 3D scene colors for the current theme, updating when the theme does. */
export function useSceneColors(): SceneColors {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
