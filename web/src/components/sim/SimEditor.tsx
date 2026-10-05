import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive, selectConfig } from '../../state/store';
import { launchDiffKeys, prefDiffKeys } from '../../services/flight/simDiff';
import { loadoutLabel } from '../../services/flight/flightConfigs';
import { useSettings } from '../../state/SettingsProvider';
import { SIM_BOUNDS } from '../../services/storage/settings';
import { RunButton } from './RunButton';
import { useIsDesktop } from '../common/useMediaQuery';
import { LaunchPanel } from './LaunchPanel';
import { NumberInput } from '../common/NumberInput';
import { useUnits } from '../../prefs/useUnits';
import { onSi } from '../../prefs/entryValue';
import { unitScope } from '../../prefs/units';
import { FieldLabel, markRing } from '../common/FieldMark';
import type { SimPrefs } from '../../services/flight/simulations';

/**
 * Everything about the SELECTED simulation: its name, the flight configuration
 * it flies, the launch conditions, and its overrides of the global run
 * preferences.
 *
 * The configuration is PICKED here and edited in the Configurations tab. A
 * loadout several simulations share cannot also be editable from one of them
 * without the two surfaces disagreeing about whether a change is about the row
 * or about the setup.
 *
 * Sits in the Simulations tab's right column at lg+, and inline under the table
 * on a phone. Reads the store directly, so the same element works in both places.
 */
export function SimEditor() {
  const { t } = useTranslation();
  const activeId = useWorkspaceStore((s) => selectActive(s).id);
  const name = useWorkspaceStore((s) => selectActive(s).name);
  const launch = useWorkspaceStore((s) => selectActive(s).launch);
  const tree = useWorkspaceStore((s) => s.tree);
  const config = useWorkspaceStore(selectConfig);
  const configs = useWorkspaceStore((s) => s.configs);
  const onRenameSim = useWorkspaceStore((s) => s.renameSim);
  const setSimConfig = useWorkspaceStore((s) => s.setSimConfig);
  const setSelectedConfigId = useWorkspaceStore((s) => s.setSelectedConfigId);
  const setTab = useWorkspaceStore((s) => s.setTab);
  const onLaunchChange = useWorkspaceStore((s) => s.patchLaunch);
  const onCommit = useWorkspaceStore((s) => s.commitEdit);

  const desktop = useIsDesktop();

  // Everything the editor writes to: the ticked rows, or the active simulation
  // when nothing is ticked. Derived rather than subscribed, because the id list
  // is rebuilt per call and zustand compares by reference (see selectEditIds).
  const sims = useWorkspaceStore((s) => s.sims);
  const selectedIds = useWorkspaceStore((s) => s.selectedSimIds);
  const targets = useMemo(() => {
    const ids = new Set(selectedIds.length ? selectedIds : [activeId]);
    return sims.filter((x) => ids.has(x.id));
  }, [sims, selectedIds, activeId]);
  const multi = targets.length > 1;

  // Which fields the targets disagree on, so a bulk edit cannot flatten a value
  // that is not on screen. Only meaningful for a real multi-selection.
  const launchDiff = useMemo(() => launchDiffKeys(targets), [targets]);
  const prefDiff = useMemo(() => prefDiffKeys(targets), [targets]);

  /**
   * A multi-target edit is never silent: the same tick that means "fly these"
   * means "edit these", so the editor says which it is pointed at and what a
   * change will touch. It rides in the sticky band beside Run for the reason
   * Run is sticky at all -- the fields it is warning about are further down the
   * scroll than the warning would otherwise reach.
   */
  const banner = multi ? (
    <p
      role="status"
      className="rounded-lg border border-sky-500/30 bg-sky-950/40 px-2 py-1.5 text-xs leading-snug text-sky-200"
    >
      {t('sims.editingMany', { count: targets.length })}{' '}
      <span className="text-sky-300/80">{t('sims.editingManyHint')}</span>
    </p>
  ) : null;

  return (
    <div className="relative p-3">
      {/* Run heads this column, above the simulation it flies, and STAYS there.
          Everything below it -- a motor card per mount, the launch conditions,
          the run options -- is far taller than the column, so the one control
          you reach for after every edit used to scroll away from you.

          Full-bleed (-mx-3 -mt-3 against the container's p-3) and opaque, so
          the options pass BEHIND the band rather than beside it; `sticky`
          pins to the scrolling ancestor, which is the 380px column in App.

          On a phone this component is inline UNDER the table, so the button
          stays in the pane's toolbar instead - one instance either way
          (see useMediaQuery). */}
      {desktop && (
        <div className="sticky top-0 z-10 -mx-3 -mt-3 mb-4 space-y-2 border-b border-white/10 bg-slate-950 p-3">
          <RunButton />
          {banner}
        </div>
      )}

      <div className="space-y-4">
        {!desktop && banner}

        <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
          {/* A div, not a <label htmlFor>: this component is rendered twice (the
              phone's inline copy and the desktop column), and a duplicated id is
              a broken association for whichever copy loses. The input names itself
              with aria-label instead. */}
          {/* The one field that does NOT follow the selection: pushing a name
              across three simulations would leave three rows called the same
              thing, which is the opposite of what naming is for. */}
          <div className="mb-1 flex items-baseline gap-2 text-[10px] uppercase tracking-wide text-slate-400">
            {t('sims.name')}
            {multi && <span className="normal-case text-slate-500">{t('sims.thisOneOnly')}</span>}
          </div>
          <input
            value={name}
            onChange={(e) => onRenameSim(activeId, e.target.value)}
            onBlur={onCommit}
            aria-label={t('sims.rename')}
            className="w-full rounded-md bg-slate-800 px-2 py-1.5 text-sm font-medium text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
          />
        </section>

        {/* WHICH setup this row flies. The motors themselves are in the
            Configurations tab: one place writes a loadout, and a configuration
            several rows share cannot be quietly edited from one of them. */}
        <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
          <div className="mb-1 flex items-baseline gap-2 text-[10px] uppercase tracking-wide text-slate-400">
            {t('configs.name')}
            {multi && <span className="normal-case text-slate-500">{t('sims.thisOneOnly')}</span>}
          </div>
          <select
            value={config.id}
            onChange={(e) => setSimConfig(activeId, e.target.value)}
            aria-label={t('configs.pick')}
            className="w-full rounded-md bg-slate-800 px-2 py-1.5 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
          >
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || loadoutLabel(tree, c) || t('configs.noMotors')}
              </option>
            ))}
          </select>
          {/* What it actually seats, spelled out: a named configuration says
              nothing about its motors, and the motors are what the row flies. */}
          <p className="mt-2 text-xs text-slate-400">{loadoutLabel(tree, config) || t('configs.noMotors')}</p>
          <button
            type="button"
            onClick={() => {
              // Open the tab ON this configuration rather than wherever it was
              // left, so the round trip lands on the motors this row flies.
              setSelectedConfigId(config.id);
              setTab('configs');
            }}
            className="mt-2 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            {t('configs.edit')}
          </button>
        </section>

        <LaunchPanel launch={launch} onChange={onLaunchChange} onCommit={onCommit} diff={launchDiff} weather />
        <SimOptions diff={prefDiff} />
      </div>
    </div>
  );
}

/**
 * The time-step stops the slider offers, coarsest to finest, with OpenRocket's
 * 0.05 s default among them. A slider needs discrete stops because the useful
 * range spans two orders of magnitude and a linear sweep would spend most of its
 * travel on values nobody wants.
 */
const TIME_STEPS = [0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.001];

/** The stop closest to a typed value, so the slider tracks the field. */
const nearestStepIndex = (v: number): number =>
  TIME_STEPS.reduce((best, s, i) => (Math.abs(s - v) < Math.abs(TIME_STEPS[best]! - v) ? i : best), 0);

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
function SimOptions({ diff }: { diff?: ReadonlySet<keyof SimPrefs> }) {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const u = useUnits();
  const prefs = useWorkspaceStore((s) => selectActive(s).prefs);
  const setSimPref = useWorkspaceStore((s) => s.setSimPref);
  const clearSimPrefs = useWorkspaceStore((s) => s.clearSimPrefs);
  const onCommit = useWorkspaceStore((s) => s.commitEdit);
  const g = settings.simulation;
  // The SAME FieldUnit the global setting resolves, under the same scope key, so
  // the two surfaces for this one stored value cannot disagree about its unit.
  // This read a hardcoded degree sign and an inline `* 180 / Math.PI`, which
  // SettingsDialog says in its own comment it was changed away from. `angle`
  // offers `rad`, so a user working in radians saw one surface in degrees and the
  // other in radians, for the same number.
  const angle = u.at(unitScope('settings', 'maxAngleStep'), 'angle');

  /** What this simulation actually runs with: its overrides over the globals. */
  const eff = { ...g, ...(prefs ?? {}) };
  const mixed = (k: keyof SimPrefs) => diff?.has(k) ?? false;
  const overridden = Object.keys(prefs ?? {}).length > 0;

  // The four deployment thresholds are SPEEDS, so they follow the user's
  // velocity unit both ways; the stored value stays SI. `fmt` for the
  // placeholder rather than the raw number, since the global is SI too.
  const speed = (si: number | undefined): number | null => (si == null ? null : u.toUi('velocity', si));
  const onSpeed = (key: 'deploymentSpeedWarn' | 'mainHighSpeedWarn' | 'mainLowSpeedWarn' | 'drogueLowSpeedWarn') =>
    onSi(u.plain('velocity'), (si) => setSimPref(key, si));
  const vSym = u.sym('velocity');
  const vStep = u.step('velocity', 1);

  return (
    <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-slate-400">{t('sims.options')}</div>

      {/* What the kernel is actually running, stated rather than assumed, as the
          desktop states it. Fixed, not chosen: the bridge always builds a
          BarrowmanCalculator and the RK4 stepper, and the supersonic-aero
          extensions the engine CAN carry are not wired into the web app. */}
      <dl className="mb-3 space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-xs text-slate-400">{t('settings.calcMethod')}</dt>
          <dd className="text-xs text-slate-300">Extended Barrowman</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-xs text-slate-400">{t('settings.simMethod')}</dt>
          <dd className="text-xs text-slate-300">6-DOF Runge-Kutta 4</dd>
        </div>
      </dl>

      <div className="space-y-2">
        <Override
          label={t('settings.timeStep')}
          unit="s"
          mixed={mixed('timeStep')}
          value={prefs?.timeStep ?? null}
          placeholder={String(g.timeStep)}
          step={0.01}
          min={SIM_BOUNDS.timeStep.min}
          max={SIM_BOUNDS.timeStep.max}
          onChange={(v) => setSimPref('timeStep', v)}
          onCommit={onCommit}
        />
        <Override
          label={t('settings.maxTime')}
          unit="s"
          mixed={mixed('maxTime')}
          value={prefs?.maxTime ?? null}
          placeholder={String(g.maxTime)}
          step={60}
          min={SIM_BOUNDS.maxTime.min}
          max={SIM_BOUNDS.maxTime.max}
          onChange={(v) => setSimPref('maxTime', v)}
          onCommit={onCommit}
        />
        <Override
          label={t('settings.maxAngleStep')}
          hint={t('settings.maxAngleStepHint')}
          unit={angle.sym}
          // Stored in RADIANS like the kernel's field, edited in the user's angle
          // unit through `angle` above - not in degrees by assumption.
          mixed={mixed('maxAngleStep')}
          value={prefs?.maxAngleStep == null ? null : angle.toUi(prefs.maxAngleStep)}
          placeholder={String(angle.toUi(g.maxAngleStep))}
          step={angle.step((0.5 * Math.PI) / 180)}
          min={angle.toUi(SIM_BOUNDS.maxAngleStep.min)}
          max={angle.toUi(SIM_BOUNDS.maxAngleStep.max)}
          onChange={onSi(angle, (si) => setSimPref('maxAngleStep', si))}
          onCommit={onCommit}
        />
        {/* The desktop pairs the time step with a slider, because the useful
            range is narrow and the consequences of leaving it are not obvious.
            Same stops it offers, coarsest to finest. */}
        <input
          type="range"
          min={0}
          max={TIME_STEPS.length - 1}
          step={1}
          aria-label={t('settings.timeStep')}
          value={nearestStepIndex(eff.timeStep)}
          onChange={(e) => setSimPref('timeStep', TIME_STEPS[Number(e.target.value)]!)}
          onMouseUp={onCommit}
          onKeyUp={onCommit}
          className="w-full accent-sky-500"
        />
        <Override
          label={t('settings.randomSeed')}
          mixed={mixed('randomSeed')}
          value={prefs?.randomSeed ?? null}
          placeholder={g.randomSeed == null ? t('settings.seedAuto') : String(g.randomSeed)}
          step={1}
          onChange={(v) => setSimPref('randomSeed', v)}
          onCommit={onCommit}
        />
      </div>

      {/* The desktop's two buttons. "Reset" drops this simulation's overrides so
          every field falls back through to the global again; "Save as default"
          pushes what it is running now INTO the globals, which is the only way
          to make a value you arrived at here the starting point for new work. */}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={!overridden}
          onClick={() => {
            clearSimPrefs();
            onCommit();
          }}
          className="flex-1 rounded-md bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-white/10 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('sims.resetToDefault')}
        </button>
        <button
          type="button"
          onClick={() => {
            // Saved as the globals AND dropped as overrides: leaving them behind
            // would pin this simulation to today's numbers, so a later change to
            // the global would move every OTHER simulation but not this one.
            update({ simulation: eff });
            clearSimPrefs();
            onCommit();
          }}
          className="flex-1 rounded-md bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
        >
          {t('sims.saveAsDefault')}
        </button>
      </div>

      {/* The deployment-speed thresholds, per simulation. Which one a flight uses
          depends on the stage's recovery layout: no drogue is single-deployment
          and uses the first alone; a drogue makes it dual-deployment and the MAIN
          is judged against the next two, the DROGUE against the last. All of them
          reach the kernel, which is what raises the warnings shown on the Results
          tab. The last three apply only once a device is marked as a drogue. */}
      <div className="mt-3 border-t border-white/10 pt-2 text-[10px] uppercase tracking-wide text-slate-400">
        {t('settings.warnings')}
      </div>
      <div className="mt-2 space-y-2">
        <Override
          label={t('settings.deploySpeedWarn')}
          hint={t('settings.deploySpeedWarnHint')}
          unit={vSym}
          mixed={mixed('deploymentSpeedWarn')}
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
          mixed={mixed('mainHighSpeedWarn')}
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
          mixed={mixed('mainLowSpeedWarn')}
          value={speed(prefs?.mainLowSpeedWarn)}
          placeholder={u.fmt('velocity', g.mainLowSpeedWarn)}
          step={vStep}
          min={0}
          onChange={onSpeed('mainLowSpeedWarn')}
          onCommit={onCommit}
        />
        <Override
          label={t('settings.drogueLowSpeedWarn')}
          hint={t('settings.drogueLowSpeedWarnHint')}
          unit={vSym}
          mixed={mixed('drogueLowSpeedWarn')}
          value={speed(prefs?.drogueLowSpeedWarn)}
          placeholder={u.fmt('velocity', g.drogueLowSpeedWarn)}
          step={vStep}
          min={0}
          onChange={onSpeed('drogueLowSpeedWarn')}
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
  max,
  hint,
  mixed,
  onChange,
  onCommit,
}: {
  label: string;
  unit?: string;
  value: number | null;
  placeholder: string;
  step: number;
  min?: number;
  max?: number;
  /** What the number is FOR — same text the global setting carries. */
  hint?: string;
  /** The simulations being edited together disagree on this override. */
  mixed?: boolean;
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
          max={max}
          mixed={mixed}
          onChange={onChange}
          onCommit={onCommit}
        />
        <p className="mt-0.5 pr-24 text-[11px] leading-snug text-slate-500">{hint}</p>
      </div>
    );
  }
  return (
    <label className="flex items-center justify-between gap-3">
      <FieldLabel text={label} mixed={mixed} />
      <span className="flex items-center gap-1">
        <NumberInput
          ariaLabel={label}
          value={value}
          onChange={onChange}
          onCommit={onCommit}
          step={step}
          min={min}
          max={max}
          placeholder={placeholder}
          className={markRing(
            'w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500',
            false,
            mixed,
          )}
        />
        <span className="min-w-4 text-xs text-slate-500">{unit}</span>
      </span>
    </label>
  );
}
