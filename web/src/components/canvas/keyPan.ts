import type { ZoomState } from '../../tree/schematicGeometry';

/** The fraction of the view one arrow press moves it; Shift moves five times as far. */
const STEP = 0.1;

/**
 * Pan a zoomed view from the keyboard: the arrows bring the part of the drawing
 * on that side into view, the way a drag toward the other side would. `span` is
 * the view's width in its own (viewBox) units.
 *
 * Returns null for a key that is not a pan or a view that is not zoomed in: at
 * the fitted view the whole drawing is already on screen, so there is nothing
 * to bring in, and the key is left to whatever else answers it.
 */
export function keyPan(z: ZoomState, key: string, shift: boolean, span: number): ZoomState | null {
  if (z.k <= 1) return null;
  const d = span * STEP * (shift ? 5 : 1);
  switch (key) {
    case 'ArrowLeft':
      return { ...z, x: z.x + d };
    case 'ArrowRight':
      return { ...z, x: z.x - d };
    case 'ArrowUp':
      return { ...z, y: z.y + d };
    case 'ArrowDown':
      return { ...z, y: z.y - d };
    default:
      return null;
  }
}
