import type { StabilityState } from '../../services/flight/simReport.js';

/** The margin color tiers, shared by every stability ink in the 3D view. */

// DARK-theme status hexes on purpose: the 3D background is the dusk gradient
// in both themes, so the dark-theme inks are the legible set here.
export const MARGIN_COLOR: Record<StabilityState, string> = {
  ok: '#4dbd4d',
  over: '#e0a53d',
  under: '#f0716f',
};
