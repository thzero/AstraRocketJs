import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  findMounts,
  findRecoveryDevices,
  findSeparators,
  findStages,
  isUpperStageMount,
} from '../../services/design/treeEdit';
import { useWorkspaceStore, selectEditedConfig } from '../../state/store';
import { MotorRow } from '../sim/MotorRow';
import { DeploymentSection } from './DeploymentSection';
import { SeparationSection } from './SeparationSection';
import { partName } from './ConfigsTable';
import { mountFit } from '../../services/motors/motorPicker';

/**
 * One flight configuration: its name, and whichever part of it the tab's sub-tab
 * is showing - a motor card per mount, a deployment card per recovery device, or
 * a separation card per booster.
 *
 * The ONLY place a configuration is written. A setup several simulations share
 * cannot also be editable from one of those simulations without the two surfaces
 * disagreeing about whether a change is about the row or about the setup, so the
 * simulation editor points at a configuration and this changes it.
 *
 * Sits in the Configurations tab's right column at lg+, and inline under the
 * table below that, which is the only way a phone can change a motor at all.
 * Reads the store directly, so the same element works in both places.
 */
export function ConfigEditor() {
  const { t } = useTranslation();
  const tree = useWorkspaceStore((s) => s.tree);
  const config = useWorkspaceStore(selectEditedConfig);
  const setMountMotor = useWorkspaceStore((s) => s.setMountMotor);
  const setMountIgnition = useWorkspaceStore((s) => s.setMountIgnition);
  const renameConfig = useWorkspaceStore((s) => s.renameConfig);
  const onCommit = useWorkspaceStore((s) => s.commitEdit);
  const onError = useWorkspaceStore((s) => s.setErr);
  const flights = useWorkspaceStore((s) => s.sims.filter((x) => x.configId === config.id).length);

  const sub = useWorkspaceStore((s) => s.configsTab);
  const mounts = useMemo(() => findMounts(tree), [tree]);
  const devices = useMemo(() => findRecoveryDevices(tree), [tree]);
  const stages = useMemo(() => findStages(tree), [tree]);
  // Which of them have something above to let go of; the rest can still be
  // grounded, which is the other half of what this sub-tab decides.
  const separates = useMemo(() => new Set(findSeparators(tree).map((n) => n.id as string)), [tree]);

  return (
    <div className="space-y-4 p-3">
      <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
        {/* A div rather than a <label htmlFor>: this component renders twice (the
            phone's inline copy and the desktop column), and a duplicated id is a
            broken association for whichever copy loses. */}
        <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">{t('configs.name')}</div>
        <input
          value={config.name ?? ''}
          onChange={(e) => renameConfig(config.id, e.target.value)}
          onBlur={onCommit}
          // Empty is not a blank name: the label falls back to the motor list,
          // which is what the desktop shows for a setup nobody titled.
          placeholder={t('configs.namePlaceholder')}
          aria-label={t('configs.rename')}
          // The field's weight is for a NAME somebody typed. The placeholder is
          // a hint about what happens if they do not, so it drops back to the
          // weight and color every other hint in the app uses.
          className="w-full rounded-md bg-slate-800 px-2 py-1.5 text-sm font-medium text-slate-100 ring-1 ring-white/10 placeholder:font-normal placeholder:text-slate-500 focus:outline-none focus:ring-sky-500"
        />
        <p className="mt-2 text-[11px] leading-snug text-slate-500">{t('configs.flownBy', { count: flights })}</p>
      </section>

      {sub === 'recovery' &&
        (devices.length ? (
          devices.map((d) => <DeploymentSection key={d.id as string} config={config} device={d} />)
        ) : (
          <p className="text-xs text-slate-500">{t('configs.noRecovery')}</p>
        ))}

      {sub === 'separation' &&
        (stages.length ? (
          stages.map((st) => (
            <SeparationSection
              key={st.id as string}
              config={config}
              stage={st}
              separates={separates.has(st.id as string)}
            />
          ))
        ) : (
          <p className="text-xs text-slate-500">{t('configs.noSeparation')}</p>
        ))}

      {sub === 'motors' &&
        mounts.map((mt, i) => {
          const id = mt.id as string;
          const seated = config.motors[id];
          // The same numbers the file reader judges a fit by (motorPicker.mountFit).
          const mount = mountFit(mt as unknown as Record<string, unknown>);
          return (
            <MotorRow
              key={id}
              title={mounts.length > 1 ? `${t('sims.motor')} - ${partName(mt, i, t)}` : undefined}
              motor={seated?.spec ?? null}
              onChange={(m) => setMountMotor(config.id, id, m)}
              onError={onError}
              mount={mount}
              ignition={{ event: seated?.ignitionEvent ?? 'automatic', delay: seated?.ignitionDelay ?? 0 }}
              onIgnitionChange={(e, d) => setMountIgnition(config.id, id, e, d)}
              onCommit={onCommit}
              upperStage={isUpperStageMount(tree, id)}
            />
          );
        })}
    </div>
  );
}
