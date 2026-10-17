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
 *
 * The warning list is the whole flight's, every stage's and every deployment's
 * devices together, so only a warning raised for one of `devices` counts: the
 * devices of the deployment whose speed the tile shows ({@link lastDeployment}).
 * A warning is matched to them by the app node ids of its sources
 * (`sourceIds`), since two unnamed devices in different stages fly under the
 * same kernel default name. A warning without ids (a result read from a file,
 * or a stored result that carries none) is matched by name instead: the kernel
 * names each source in the message
 * (`Message.toString` appends each as `"name"`). A name in `sharedNames` is
 * flown by more than one of the design's recovery devices, so a warning naming
 * it could be another stage's and does not count.
 */
export function deploymentVerdict(
  speed: number,
  warnings: readonly { key: string; message?: string; sourceIds?: readonly string[] }[] | undefined,
  deploymentSpeedWarn: number,
  devices: readonly DeployedDevice[],
  sharedNames: ReadonlySet<string> = new Set(),
): 'tooFast' | 'tooSlow' | null {
  if (!warnings) return speed > deploymentSpeedWarn ? 'tooFast' : null;
  const own = warnings.filter((w) =>
    w.sourceIds?.length
      ? devices.some((d) => d.id != null && w.sourceIds!.includes(d.id))
      : devices.some((d) => d.name !== '' && !sharedNames.has(d.name) && w.message?.includes(`"${d.name}"`)),
  );
  if (own.some((w) => TOO_FAST.has(w.key))) return 'tooFast';
  if (own.some((w) => TOO_SLOW.has(w.key))) return 'tooSlow';
  return null;
}

/**
 * A recovery device a branch deployed: its app node id when the event carries
 * one, and the name the kernel gave it.
 */
export interface DeployedDevice {
  id?: string;
  name: string;
}

/**
 * The recovery devices of a branch's last deployment: the deployment whose speed
 * the kernel reports as the branch's deployment velocity (`FlightData`, which
 * keeps the velocity at the last `RECOVERY_DEVICE_DEPLOYMENT` event it reads).
 * Devices deployed at that same instant share its speed, so they count too; a
 * drogue opened earlier does not.
 */
export function lastDeployment(
  events: readonly { type: string; time?: number; source?: string; sourceId?: string }[] | undefined,
): DeployedDevice[] {
  const deployments = (events ?? []).filter((e) => e.type === 'RECOVERY_DEVICE_DEPLOYMENT');
  const last = deployments[deployments.length - 1];
  if (!last) return [];
  return deployments.flatMap((e) =>
    e.time === last.time && (e.source || e.sourceId) ? [{ id: e.sourceId, name: e.source ?? '' }] : [],
  );
}
