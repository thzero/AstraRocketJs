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

function snapshot(): SceneColors {
  const style = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  const values = SCENE_TOKENS.map((name) => style?.getPropertyValue(`--c-${name}`).trim() || UNRESOLVED);
  const key = values.join('|');
  // The same object while nothing changed, so a memo keyed on it holds.
  if (cached?.key !== key) {
    cached = { key, colors: Object.fromEntries(SCENE_TOKENS.map((n, i) => [n, values[i]!])) as SceneColors };
  }
  return cached.colors;
}

function subscribe(onChange: () => void): () => void {
  const root = document.documentElement;
  const observer = new MutationObserver(onChange);
  observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
  const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  scheme?.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    scheme?.removeEventListener('change', onChange);
  };
}

/** The 3D scene colors for the current theme, updating when the theme does. */
export function useSceneColors(): SceneColors {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
