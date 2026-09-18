import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { findMounts, isUpperStageMount } from '../../services/treeEdit';
import { useWorkspaceStore, selectActive, selectExtraMotors } from '../../state/store';
import { useSettings } from '../../state/SettingsProvider';
import { MotorRow } from './MotorRow';
import { RunButton } from './RunButton';
import { useIsDesktop } from '../common/useMediaQuery';
import { LaunchPanel } from './LaunchPanel';
import { NumberInput } from '../common/NumberInput';
import { useUnits } from '../../prefs/useUnits';
import { BusyLock } from '../common/BusyLock';

/**
 * Everything about the SELECTED simulation: its name, a motor card per mount,
 * the launch conditions, and its overrides of the global run preferences.
 *
 * Sits in the Simulations tab's right column at lg+, and inline under the table
 * on a phone — the table alone would leave a phone with no way to change a motor
 * at all, which the old single-column panel did allow.
 *
 * Reads the store directly, so the same element works in both places.
 */
export function SimEditor() {
  const { t } = useTranslation();
  const activeId = useWorkspaceStore((s) => selectActive(s).id);
  const name = useWorkspaceStore((s) => selectActive(s).name);
  const motor = useWorkspaceStore((s) => selectActive(s).motor);
  const ignitionEvent = useWorkspaceStore((s) => selectActive(s).ignitionEvent);
  const ignitionDelay = useWorkspaceStore((s) => selectActive(s).ignitionDelay);
  const launch = useWorkspaceStore((s) => selectActive(s).launch);
  const tree = useWorkspaceStore((s) => s.tree);
  const extraMotors = useWorkspaceStore(selectExtraMotors);
  const setExtraMotor = useWorkspaceStore((s) => s.setExtraMotor);
  const onRenameSim = useWorkspaceStore((s) => s.renameSim);
  const onMotorChange = useWorkspaceStore((s) => s.setActiveMotor);
  const setActiveIgnition = useWorkspaceStore((s) => s.setActiveIgnition);
  const setExtraIgnition = useWorkspaceStore((s) => s.setExtraIgnition);
  const onLaunchChange = useWorkspaceStore((s) => s.patchLaunch);
  const onCommit = useWorkspaceStore((s) => s.commitEdit);
  const onError = useWorkspaceStore((s) => s.setErr);

  // One card per motor mount. The first (primary) mount's motor is the sim's
  // `motor`; the rest are its `extraMotors`, keyed by mount id. All of it is
  // per-simulation, so two sims can seat different upper-stage motors.
  const mounts = useMemo(() => findMounts(tree), [tree]);
  const primaryId = mounts[0]?.id;
  const desktop = useIsDesktop();

  return (
    <div className="relative space-y-4 p-3">
      <BusyLock />

      {/* Run heads this column, above the simulation it flies. On a phone this
          component is inline UNDER the table, so the button stays in the pane's
          toolbar instead - one instance either way (see useMediaQuery). */}
      {desktop && <RunButton />}

      <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
        {/* A div, not a <label htmlFor>: this component is rendered twice (the
            phone's inline copy and the desktop column), and a duplicated id is
            a broken association for whichever copy loses. The input names itself
            with aria-label instead. */}
        <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">{t('sims.name')}</div>
        <input
          value={name}
          onChange={(e) => onRenameSim(activeId, e.target.value)}
          onBlur={onCommit}
          aria-label={t('sims.rename')}
          className="w-full rounded-md bg-slate-800 px-2 py-1.5 text-sm font-medium text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
        />
      </section>

      {mounts.map((mt, i) => {
        const id = mt.id as string;
        const isPrimary = id === primaryId;
        const mountName = typeof mt.name === 'string' && mt.name ? mt.name : `${t('part.innertube')} ${i + 1}`;
        const or = typeof mt.outerRadius === 'number' ? mt.outerRadius : null;
        const th = typeof mt.thickness === 'number' ? mt.thickness : 0;
        const bore = or != null ? (or - th) * 2 * 1000 : null; // inner diameter, mm
        return (
          <MotorRow
            key={id}
            title={mounts.length > 1 ? `${t('sims.motor')} - ${mountName}` : undefined}
            motor={isPrimary ? motor : (extraMotors[id]?.spec ?? null)}
            onChange={isPrimary ? onMotorChange : (m) => setExtraMotor(id, m)}
            onError={onError}
            mountDiameter={bore}
            ignition={
              isPrimary
                ? { event: ignitionEvent ?? 'automatic', delay: ignitionDelay ?? 0 }
                : {
                    event: extraMotors[id]?.ignitionEvent ?? 'automatic',
                    delay: extraMotors[id]?.ignitionDelay ?? 0,
                  }
            }
            onIgnitionChange={isPrimary ? setActiveIgnition : (e, d) => setExtraIgnition(id, e, d)}
            onCommit={onCommit}
            upperStage={isUpperStageMount(tree, id)}
          />
        );
      })}

      <LaunchPanel launch={launch} onChange={onLaunchChange} onCommit={onCommit} />
      <SimOptions />
    </div>
  );
}

/**
 * Per-simulation overrides of Settings › Simulation: the run options, and the
 * recovery-deployment speeds that decide when a flight raises a warning.
 *
 * Empty means "follow the global value", which is shown as the placeholder — so
 * the field reads as the number that will actually be used, and clearing it is
 * how you hand the setting back. OpenRocket carries all of these per simulation
 * too; ours additionally fall through, rather than being copied at creation, so
 * changing a global still moves every simulation that never overrode it.
 */
function SimOptions() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const u = useUnits();
  const prefs = useWorkspaceStore((s) => selectActive(s).prefs);
  const setSimPref = useWorkspaceStore((s) => s.setSimPref);
  const onCommit = useWorkspaceStore((s) => s.commitEdit);
  const g = settings.simulation;

  // The three deployment thresholds are SPEEDS, so they follow the user's
  // velocity unit both ways; the stored value stays SI. `fmt` for the
  // placeholder rather than the raw number, since the global is SI too.
  const speed = (si: number | undefined): number | null => (si == null ? null : u.toUi('velocity', si));
  const onSpeed = (key: 'deploymentSpeedWarn' | 'mainHighSpeedWarn' | 'mainLowSpeedWarn') => (v: number | null) =>
    setSimPref(key, v == null ? null : u.fromUi('velocity', v));
  const vSym = u.sym('velocity');
  const vStep = u.step('velocity', 1);

  return (
    <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-slate-400">{t('sims.options')}</div>
      <div className="space-y-2">
        <Override
          label={t('settings.timeStep')}
          unit="s"
          value={prefs?.timeStep ?? null}
          placeholder={String(g.timeStep)}
          step={0.01}
          min={0.001}
          onChange={(v) => setSimPref('timeStep', v)}
          onCommit={onCommit}
        />
        <Override
          label={t('settings.maxTime')}
          unit="s"
          value={prefs?.maxTime ?? null}
          placeholder={String(g.maxTime)}
          step={60}
          min={1}
          onChange={(v) => setSimPref('maxTime', v)}
          onCommit={onCommit}
        />
        <Override
          label={t('settings.randomSeed')}
          value={prefs?.randomSeed ?? null}
          placeholder={g.randomSeed == null ? t('settings.seedAuto') : String(g.randomSeed)}
          step={1}
          onChange={(v) => setSimPref('randomSeed', v)}
          onCommit={onCommit}
        />
      </div>

      {/* The deployment-speed thresholds, per simulation. Which one a flight uses
          depends on the stage's recovery layout: no drogue is single-deployment
          and uses the first alone; a drogue makes it dual-deployment and the MAIN
          is judged against the other two. All three reach the kernel, which is
          what raises the warning shown on the Results tab. */}
      <div className="mt-3 border-t border-white/10 pt-2 text-[10px] uppercase tracking-wide text-slate-400">
        {t('settings.warnings')}
      </div>
      <div className="mt-2 space-y-2">
        <Override
          label={t('settings.deploySpeedWarn')}
          hint={t('settings.deploySpeedWarnHint')}
          unit={vSym}
          value={speed(prefs?.deploymentSpeedWarn)}
          placeholder={u.fmt('velocity', g.deploymentSpeedWarn)}
          step={vStep}
          min={0}
          onChange={onSpeed('deploymentSpeedWarn')}
          onCommit={onCommit}
        />
        <Override
          label={t('settings.mainHighSpeedWarn')}
          hint={t('settings.mainHighSpeedWarnHint')}
          unit={vSym}
          value={speed(prefs?.mainHighSpeedWarn)}
          placeholder={u.fmt('velocity', g.mainHighSpeedWarn)}
          step={vStep}
          min={0}
          onChange={onSpeed('mainHighSpeedWarn')}
          onCommit={onCommit}
        />
        <Override
          label={t('settings.mainLowSpeedWarn')}
          hint={t('settings.mainLowSpeedWarnHint')}
          unit={vSym}
          value={speed(prefs?.mainLowSpeedWarn)}
          placeholder={u.fmt('velocity', g.mainLowSpeedWarn)}
          step={vStep}
          min={0}
          onChange={onSpeed('mainLowSpeedWarn')}
          onCommit={onCommit}
        />
      </div>

      <p className="mt-2 text-[11px] text-slate-500">{t('sims.optionsHint')}</p>
    </section>
  );
}

function Override({
  label,
  unit,
  value,
  placeholder,
  step,
  min,
  hint,
  onChange,
  onCommit,
}: {
  label: string;
  unit?: string;
  value: number | null;
  placeholder: string;
  step: number;
  min?: number;
  /** What the number is FOR — same text the global setting carries. */
  hint?: string;
  onChange: (v: number | null) => void;
  onCommit: () => void;
}) {
  if (hint) {
    return (
      <div>
        <Override
          label={label}
          unit={unit}
          value={value}
          placeholder={placeholder}
          step={step}
          min={min}
          onChange={onChange}
          onCommit={onCommit}
        />
        <p className="mt-0.5 pr-24 text-[11px] leading-snug text-slate-500">{hint}</p>
      </div>
    );
  }
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="flex items-center gap-1">
        <NumberInput
          ariaLabel={label}
          value={value}
          onChange={onChange}
          onCommit={onCommit}
          step={step}
          min={min}
          placeholder={placeholder}
          className="w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
        />
        <span className="min-w-4 text-xs text-slate-500">{unit}</span>
      </span>
    </label>
  );
}
