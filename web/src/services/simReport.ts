export type StabilityState = 'ok' | 'under' | 'over';

/** Healthy-band classifier for the 2D schematic: under-stable (<1 cal), the ok
 *  band, or over-stable (>6 cal). The readout tiles use the finer margin-sign
 *  tiers below (stabilityTone / stabilityVerdictKey) instead. */
export function stabilityState(cal: number | null | undefined): StabilityState | null {
  if (cal == null || !Number.isFinite(cal)) return null;
  if (cal < 1.0) return 'under';
  if (cal > 6.0) return 'over';
  return 'ok';
}

/** Tailwind text tone for a stability margin (caliber) — the one classification
 *  the readout tiles and the info overlay share: stable ≥1, marginal ≥0, else unstable. */
export function stabilityTone(cal: number): string {
  return cal >= 1 ? 'text-emerald-400' : cal >= 0 ? 'text-amber-400' : 'text-red-400';
}

/** i18n key for the one-word stability verdict, matching {@link stabilityTone}. */
export function stabilityVerdictKey(cal: number): string {
  return cal >= 1 ? 'stability.stable' : cal >= 0 ? 'stability.marginal' : 'stability.unstable';
}

/** Engine FlightEvent.Type names worth marking on the flight views → i18n keys. */
export const EVENT_LABEL: Record<string, string> = {
  APOGEE: 'flight.apogee',
  BURNOUT: 'flight.burnout',
  RECOVERY_DEVICE_DEPLOYMENT: 'flight.deploy',
  EJECTION_CHARGE: 'flight.ejection',
  GROUND_HIT: 'flight.landing',
};

/** Most-significant-first, for keeping the top event when labels cluster in time. */
export const EVENT_PRIORITY = ['APOGEE', 'BURNOUT', 'RECOVERY_DEVICE_DEPLOYMENT', 'EJECTION_CHARGE', 'GROUND_HIT'];

const DEPLOY = 'RECOVERY_DEVICE_DEPLOYMENT';

/**
 * Collapse near-coincident event LABELS so they don't pile up on the flight
 * chart: events whose x (px) fall within `minGap` merge, keeping the cluster's
 * highest-{@link EVENT_PRIORITY} type. A recovery deployment is the exception —
 * it ALWAYS keeps its own marker, because on a dual-deploy rocket the drogue
 * fires right at apogee and folding it into the apogee label hides it (the very
 * event people look for). Same-instant ties order non-deploys first, so an
 * ejection charge folds into the apogee cluster while the deployment it triggers
 * still stands alone. Returns one entry per surviving label, left→right.
 */
export function clusterEventLabels(
  events: { time: number; type: string }[],
  xOf: (t: number) => number,
  minGap = 20,
): { x: number; type: string }[] {
  const groups: { x: number; type: string }[] = [];
  const sorted = [...events].sort(
    (a, b) => a.time - b.time || Number(a.type === DEPLOY) - Number(b.type === DEPLOY),
  );
  for (const e of sorted) {
    const x = xOf(e.time);
    const last = groups[groups.length - 1];
    if (last && e.type !== DEPLOY && last.type !== DEPLOY && x - last.x < minGap) {
      if (EVENT_PRIORITY.indexOf(e.type) < EVENT_PRIORITY.indexOf(last.type)) last.type = e.type;
    } else {
      groups.push({ x, type: e.type });
    }
  }
  return groups;
}
