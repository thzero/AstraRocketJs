import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { recoveryDevices } from '../../services/design/treeEdit';
import { useWorkspaceStore } from '../../state/store';
import { partLabel } from '../../i18n/format';

/**
 * A stage's recovery plan: single deployment, or dual with one of its devices
 * acting as the drogue.
 *
 * OpenRocket's own Recovery tab on the stage dialog, and the ONLY place it lets
 * the drogue be set. The flag is stored per device, but what it describes is the
 * stage: single deployment is no drogue, dual is exactly one. We had it as a
 * checkbox on each chute, which let a stage carry two drogues - a design the
 * desktop cannot produce and whose warnings then depend on which device the
 * kernel walks into first. Choosing here makes that unreachable, because
 * `setStageDrogue` clears the stage before it sets one.
 *
 * It changes warnings only. A drogue and a main are simulated by their own
 * diameters and deployment events; what the flag picks is which speed
 * thresholds a deployment is judged against (see openRocketEngine's
 * `drogueLowSpeedWarn`).
 */
export function StageRecovery({ node }: { node: ComponentNode }) {
  const { t } = useTranslation();
  const tree = useWorkspaceStore((s) => s.tree);
  const setDrogue = useWorkspaceStore((s) => s.setStageDrogue);
  const stageId = node.id as string;

  const devices = recoveryDevices(tree, stageId);
  const drogue = devices.find((d) => d['drogue'] === true);
  const dual = drogue !== undefined;
  // With nothing to be the drogue there is no dual deployment to choose, so the
  // option is refused rather than offered and silently ignored.
  const hasDevices = devices.length > 0;
  // What the picker shows while single deployment is selected: the device that
  // WOULD become the drogue, so switching over is one click and not two.
  const picked = drogue?.id ?? devices[0]?.id ?? '';

  const deviceName = (d: ComponentNode) => partLabel(t, d);

  return (
    <div className="space-y-2 border-t border-white/5 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('prop.recoveryType')}</h3>
      <label className="flex items-center gap-2 text-xs text-slate-300">
        <input
          type="radio"
          name={`recovery-${stageId}`}
          checked={!dual}
          onChange={() => setDrogue(stageId, null)}
          className="accent-sky-500"
        />
        {t('prop.single')}
      </label>
      <label className="flex items-center gap-2 text-xs text-slate-300">
        <input
          type="radio"
          name={`recovery-${stageId}`}
          checked={dual}
          disabled={!hasDevices}
          onChange={() => setDrogue(stageId, picked as string)}
          className="accent-sky-500"
        />
        <span className={hasDevices ? undefined : 'text-slate-500'}>{t('prop.dual')}</span>
      </label>
      {hasDevices ? (
        <label className="flex items-center justify-between gap-3 pl-6">
          <span className="text-xs text-slate-400">{t('prop.drogueDevice')}</span>
          <select
            value={picked as string}
            disabled={!dual}
            aria-label={t('prop.drogueDevice')}
            onChange={(e) => setDrogue(stageId, e.target.value)}
            className={`w-32 rounded-md px-2 py-1 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-sky-500 ${
              dual ? 'bg-slate-800 text-slate-100' : 'bg-slate-800/50 text-slate-500'
            }`}
          >
            {devices.map((d) => (
              <option key={d.id as string} value={d.id as string}>
                {deviceName(d)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="pl-6 text-xs text-slate-500">{t('prop.noDevices')}</p>
      )}
    </div>
  );
}
