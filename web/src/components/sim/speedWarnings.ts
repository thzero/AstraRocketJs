/**
 * The deployment-speed thresholds, in the order both editors show them: the
 * single-deployment threshold, then the main's high and low pair, then the
 * drogue's low. Each is a speed stored in SI and edited in the velocity unit.
 * Keys stay literal so the i18n key scan can find them.
 */
export const SPEED_WARNINGS = [
  { key: 'deploymentSpeedWarn', label: 'settings.deploySpeedWarn', hint: 'settings.deploySpeedWarnHint' },
  { key: 'mainHighSpeedWarn', label: 'settings.mainHighSpeedWarn', hint: 'settings.mainHighSpeedWarnHint' },
  { key: 'mainLowSpeedWarn', label: 'settings.mainLowSpeedWarn', hint: 'settings.mainLowSpeedWarnHint' },
  { key: 'drogueLowSpeedWarn', label: 'settings.drogueLowSpeedWarn', hint: 'settings.drogueLowSpeedWarnHint' },
] as const;

/** Warning keys the kernel raises for a recovery device opened too fast. */
const TOO_FAST = new Set(['HighSpeedDeployment', 'RECOVERY_MAIN_HIGH_SPEED']);
/** And for a dual-deployment main opened too slow. */
const TOO_SLOW = new Set(['RECOVERY_MAIN_LOW_SPEED']);

/**
 * The verdict on a flight's deployment speed, as the kernel reached it.
 *
 * The kernel picks the threshold from the stage's recovery layout: a stage with
 * a drogue judges its main against the main's high and low pair, and any other
 * stage judges against the single-deployment threshold. Reading its warnings
 * keeps the tile and the warning list in agreement for either layout. A result
 * with no warning list is judged against `deploymentSpeedWarn`, which must be
 * the simulation's effective value (its override over the global), and like
 * the kernel only a speed over it warns.
 */
export function deploymentVerdict(
  speed: number,
  warnings: readonly { key: string }[] | undefined,
  deploymentSpeedWarn: number,
): 'tooFast' | 'tooSlow' | null {
  if (!warnings) return speed > deploymentSpeedWarn ? 'tooFast' : null;
  if (warnings.some((w) => TOO_FAST.has(w.key))) return 'tooFast';
  if (warnings.some((w) => TOO_SLOW.has(w.key))) return 'tooSlow';
  return null;
}
