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
