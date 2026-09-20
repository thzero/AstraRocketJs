import type { StaticInfo } from '../../engine/openRocketEngine';
import { stabilityState, type StabilityState } from '../../services/simReport.js';
import { markerRadius } from './rocketPieces';

/**
 * Owns the pure side of the 3D stability readout: the margin color tiers
 * shared by every stability ink in the 3D view, and the floating CG/CP gadget
 * layout. No React or three.js objects, so the numbers are provable without
 * a mounted canvas (stabilityGadget.test.ts).
 */

// DARK-theme status hexes on purpose: the 3D background is the dusk gradient
// in both themes, so the dark-theme inks are the legible set here.
export const MARGIN_COLOR: Record<StabilityState, string> = {
  ok: '#4dbd4d',
  over: '#e0a53d',
  under: '#f0716f',
};

export interface CalloutGadget {
  /** Radial (z) offset of the gadget column, clear of the hull. */
  off: number;
  /** Gadget sphere radius — smaller than the on-axis markers. */
  r: number;
  cg: { pos: [number, number, number]; text: string; color: string };
  cp: { pos: [number, number, number]; text: string; color: string };
  /** Margin readout between the spheres; null when stability is unknown. */
  margin: { pos: [number, number, number]; text: string; color: string } | null;
}

/**
 * Floating CG/CP callout beside the rocket (Eric, 2026-08-21c: "RocketForge
 * also uses callouts in 3D and it looks slick"): the two spheres sit at the
 * TRUE axial stations, offset radially clear of the hull, with the static
 * margin between them. Pure so the numbers are provable — the R3F canvas
 * cannot mount in tests.
 */
export function calloutGadget(info: StaticInfo | null, maxR: number, totalLen: number): CalloutGadget | null {
  if (!info || !Number.isFinite(info.cg) || !Number.isFinite(info.cp)) return null;
  const markerR = markerRadius(totalLen, maxR);
  const off = maxR + markerR * 2.2;
  const state = stabilityState(info.stabilityCalibers);
  return {
    off,
    r: markerR * 0.55,
    cg: { pos: [info.cg, 0, off], text: 'CG', color: '#e9edf1' },
    cp: { pos: [info.cp, 0, off], text: 'CP', color: '#e34948' },
    margin:
      state === null
        ? null
        : {
            pos: [(info.cg + info.cp) / 2, 0, off],
            text: `${info.stabilityCalibers.toFixed(2)} cal`,
            color: MARGIN_COLOR[state],
          },
  };
}
