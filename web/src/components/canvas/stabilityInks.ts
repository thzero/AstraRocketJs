import type { StabilityState } from '../../services/flight/simReport.js';
import type { SceneToken } from './sceneColors';

/**
 * The stability inks of the 3D view, as scene tokens (canvas/sceneColors), so
 * each theme sets its own. The names live here, the values in index.css.
 */

/** The CG marker's ink, and the legend dot that names it. */
export const CG_INK = 'scene-cg' satisfies SceneToken;

/** The CP marker's ink: marker, leader and legend dot alike. */
export const CP_INK = 'scene-cp' satisfies SceneToken;

/** The margin color tiers, shared by every stability ink in the 3D view. */
export const MARGIN_INK: Record<StabilityState, SceneToken> = {
  ok: 'scene-stable-ok',
  over: 'scene-stable-over',
  under: 'scene-stable-under',
};
