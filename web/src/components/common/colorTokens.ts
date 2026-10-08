/**
 * A color token (src/index.css) as a CSS value, for colors set in code rather
 * than by a class: an SVG `fill` or `stroke`, a gradient stop, an inline style.
 * The browser resolves it, so it follows the token wherever the token goes.
 *
 * Not for three.js or a canvas, which take a color value and cannot resolve a
 * variable; the 3D views keep their own fixed colors (their scene is the same
 * in any theme, see canvas/stabilityGadget). Nor for anything drawn into an SVG
 * the user downloads, which has no stylesheet to resolve it against (see
 * services/exports/schematicExport).
 */
export const token = (name: string): string => `var(--c-${name})`;
