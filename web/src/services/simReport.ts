export type StabilityState = 'ok' | 'under' | 'over';
export function stabilityState(cal: number | null | undefined): StabilityState | null {
  if (cal == null || !Number.isFinite(cal)) return null;
  if (cal < 1.0) return 'under';
  if (cal > 6.0) return 'over';
  return 'ok';
}
