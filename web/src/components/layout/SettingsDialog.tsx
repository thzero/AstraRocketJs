import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../state/SettingsProvider';
import { DEFAULT_SETTINGS, type SimulationSettings } from '../../services/settings';
import { PART_KEYS, mergePalette } from '../../services/partColors';
import { NumberInput } from '../common/NumberInput';
import { useFocusTrap } from '../common/useFocusTrap';
import { LaunchPanel } from '../sim/LaunchPanel';
import { withRequiredFrom } from '../../services/requiredLaunch';
import { IMPERIAL_UNITS, METRIC_UNITS, QUANTITIES, UNITS } from '../../prefs/units';
import { useUnits } from '../../prefs/useUnits';

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const speedLabel = (s: number) => (s === 0.25 ? '¼×' : s === 0.5 ? '½×' : `${s}×`);

type TabKey = 'general' | 'units' | 'colors' | 'playback' | 'sketch' | 'sim' | 'launch';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'general', label: 'settings.tabGeneral' },
  { key: 'units', label: 'settings.tabUnits' },
  { key: 'colors', label: 'settings.tabColors' },
  { key: 'playback', label: 'settings.tabPlayback' },
  { key: 'sketch', label: 'settings.tabSketch' },
  { key: 'sim', label: 'settings.tabSim' },
  { key: 'launch', label: 'settings.tabLaunch' },
];

const RULER_SIDES = ['top', 'bottom', 'left', 'right'] as const;

/** Settings panel — tabbed: 3D part colors, flight-path phase colors, and the
 *  default playback speed. Persisted via the SettingsProvider. */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { settings, update, reset } = useSettings();
  const u = useUnits();
  const [tab, setTab] = useState<TabKey>('general');
  const panelRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const palette = mergePalette(settings.partColors);
  const setPart = (key: string, color: string) => update({ partColors: { ...settings.partColors, [key]: color } });
  const resetPart = (key: string) => {
    const p = { ...settings.partColors };
    delete p[key as keyof typeof p];
    update({ partColors: p });
  };
  const setPhase = (k: 'boost' | 'coast' | 'descent', c: string) =>
    update({ phaseColors: { ...settings.phaseColors, [k]: c } });
  const setSim = (patch: Partial<SimulationSettings>) => update({ simulation: { ...settings.simulation, ...patch } });
  const overriddenFields = Object.keys(settings.unitOverrides).length;

  const resetSection = () => {
    if (tab === 'general') update({ saveDesignInfo: DEFAULT_SETTINGS.saveDesignInfo });
    else if (tab === 'units') update({ units: DEFAULT_SETTINGS.units, unitOverrides: {} });
    else if (tab === 'colors') update({ partColors: {}, phaseColors: DEFAULT_SETTINGS.phaseColors });
    else if (tab === 'playback') update({ playbackSpeed: DEFAULT_SETTINGS.playbackSpeed });
    else if (tab === 'sketch') update({ showMarkers: DEFAULT_SETTINGS.showMarkers, rulers: DEFAULT_SETTINGS.rulers });
    else if (tab === 'sim') update({ simulation: DEFAULT_SETTINGS.simulation });
    else update({ launchDefaults: DEFAULT_SETTINGS.launchDefaults });
  };

  return (
    <div className="dialog-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={panelRef}
        className="dialog-panel flex h-[560px] max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-slate-900 ring-1 ring-white/10"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
          <h2 className="text-lg font-semibold text-slate-100">{t('settings.title')}</h2>
          <button
            onClick={onClose}
            aria-label={t('settings.close')}
            className="shrink-0 rounded-lg bg-slate-800 px-2 py-1 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        {/* Tabs. A real tablist: which section is open was signalled by
            background color alone, which a screen reader cannot announce. */}
        <div role="tablist" className="flex flex-wrap gap-1 px-4 pt-3">
          {TABS.map((tb) => (
            <button
              key={tb.key}
              role="tab"
              aria-selected={tab === tb.key}
              onClick={() => setTab(tb.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${tab === tb.key ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              {t(tb.label)}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {tab === 'colors' && (
            <>
              {/* Part colors apply to the 3D model, which a phone reaches
                  through the Sketch tab just as a desktop reaches it through the
                  view switch — so this is not gated on width. */}
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t('settings.parts')}
              </div>
              {PART_KEYS.map((key) => (
                <ColorRow
                  key={key}
                  label={t(`settings.part.${key}`)}
                  value={palette[key]}
                  overridden={key in settings.partColors}
                  onChange={(c) => setPart(key, c)}
                  onReset={() => resetPart(key)}
                  resetTitle={t('settings.resetOne')}
                />
              ))}
              {/* Taste, not correctness: the default is a magnitude ramp, and
                  OpenRocket's green-to-red is here for anyone who reads that
                  faster because they already know it from the desktop. */}
              <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t('settings.aeroHeat')}
              </div>
              <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
                {t('settings.aeroHeatLabel')}
                <select
                  value={settings.aeroHeat}
                  onChange={(e) => update({ aeroHeat: e.target.value as 'sky' | 'openrocket' })}
                  className="w-44 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
                >
                  <option value="sky">{t('settings.aeroHeatSky')}</option>
                  <option value="openrocket">{t('settings.aeroHeatOr')}</option>
                </select>
              </label>
              <p className="text-[11px] leading-snug text-slate-500">{t('settings.aeroHeatNote')}</p>

              <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t('settings.phases')}
              </div>
              <ColorRow
                label={t('flight.boost')}
                value={settings.phaseColors.boost}
                onChange={(c) => setPhase('boost', c)}
              />
              <ColorRow
                label={t('flight.coast')}
                value={settings.phaseColors.coast}
                onChange={(c) => setPhase('coast', c)}
              />
              <ColorRow
                label={t('flight.descent')}
                value={settings.phaseColors.descent}
                onChange={(c) => setPhase('descent', c)}
              />
            </>
          )}

          {tab === 'general' && (
            <>
              <p className="text-[11px] leading-snug text-slate-500">{t('settings.generalNote')}</p>
              <CheckRow
                label={t('settings.saveDesignInfo')}
                checked={settings.saveDesignInfo}
                onChange={(v) => update({ saveDesignInfo: v })}
              />
            </>
          )}

          {tab === 'units' && (
            <>
              <p className="text-[11px] leading-snug text-slate-500">{t('settings.unitsNote')}</p>
              {/* Whole-system presets first: most people want "imperial" and are
                  done, and only then reach in to change one quantity. A preset
                  is a clean slate, so it also drops every per-field override —
                  otherwise "Imperial defaults" would leave a field a chip had
                  touched still showing its old unit. */}
              <div className="flex gap-2 pb-1">
                <button
                  onClick={() => update({ units: METRIC_UNITS, unitOverrides: {} })}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
                >
                  {t('settings.unitsMetric')}
                </button>
                <button
                  onClick={() => update({ units: IMPERIAL_UNITS, unitOverrides: {} })}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
                >
                  {t('settings.unitsImperial')}
                </button>
              </div>
              {QUANTITIES.map((q) => (
                <label key={q} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-300">{t(`units.q.${q}`)}</span>
                  <select
                    aria-label={t(`units.q.${q}`)}
                    value={settings.units[q]}
                    onChange={(e) => update({ units: { ...settings.units, [q]: e.target.value } })}
                    className="w-28 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
                  >
                    {UNITS[q].map((u) => (
                      <option key={u.symbol} value={u.symbol}>
                        {u.symbol}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {/* A unit set from a chip lives on one field, which makes it easy
                  to forget where it was: a field showing inches while this tab
                  says cm looks like a bug unless you remember changing it. This
                  is the one place that can say how many there are and undo them
                  all — hidden when there are none, so it is never noise. */}
              {overriddenFields > 0 && (
                <button
                  onClick={() => update({ unitOverrides: {} })}
                  className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-amber-300 ring-1 ring-white/10 hover:bg-slate-700"
                >
                  {t('settings.unitsClearFields', { count: overriddenFields })}
                </button>
              )}
            </>
          )}

          {tab === 'playback' && (
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-300">{t('settings.defaultSpeed')}</span>
              <select
                value={settings.playbackSpeed}
                onChange={(e) => update({ playbackSpeed: parseFloat(e.target.value) })}
                className="rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {speedLabel(s)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {tab === 'sketch' && (
            <>
              <p className="text-[11px] leading-snug text-slate-500">{t('settings.sketchNote')}</p>
              <CheckRow
                label={t('settings.sketchMarkers')}
                checked={settings.showMarkers}
                onChange={(v) => update({ showMarkers: v })}
              />
              <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t('settings.sketchRulers')}
              </div>
              {RULER_SIDES.map((side) => (
                <CheckRow
                  key={side}
                  label={t(`view.ruler_${side}`)}
                  checked={settings.rulers[side]}
                  onChange={(v) => update({ rulers: { ...settings.rulers, [side]: v } })}
                />
              ))}
            </>
          )}

          {tab === 'sim' && (
            <>
              <CheckRow
                label={t('settings.confirmDelete')}
                checked={settings.simulation.confirmDelete}
                onChange={(v) => setSim({ confirmDelete: v })}
              />
              {/* 'Run outdated simulations automatically' hidden for now (setting still
                  defaults to off; the auto-run effect just never triggers). */}
              <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t('settings.simOptions')}
              </div>
              <InfoRow label={t('settings.calcMethod')} value="Extended Barrowman" />
              <InfoRow label={t('settings.simMethod')} value="6-DOF Runge-Kutta 4" />
              <NumRow
                label={t('settings.timeStep')}
                unit="s"
                step={0.01}
                min={0.001}
                value={settings.simulation.timeStep}
                onChange={(v) => setSim({ timeStep: v ?? DEFAULT_SETTINGS.simulation.timeStep })}
              />
              <NumRow
                label={t('settings.maxTime')}
                unit="s"
                step={60}
                min={1}
                value={settings.simulation.maxTime}
                onChange={(v) => setSim({ maxTime: v ?? DEFAULT_SETTINGS.simulation.maxTime })}
              />
              <NumRow
                label={t('settings.maxAngleStep')}
                unit="°"
                step={0.5}
                min={0.05}
                // Stored in radians like the kernel's field; shown in degrees.
                value={+((settings.simulation.maxAngleStep * 180) / Math.PI).toFixed(3)}
                onChange={(v) =>
                  setSim({
                    maxAngleStep: v == null ? DEFAULT_SETTINGS.simulation.maxAngleStep : (v * Math.PI) / 180,
                  })
                }
              />
              <NumRow
                label={t('settings.randomSeed')}
                step={1}
                placeholder={t('settings.seedAuto')}
                value={settings.simulation.randomSeed}
                onChange={(v) => setSim({ randomSeed: v })}
              />
              <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t('settings.warnings')}
              </div>
              <NumRow
                label={t('settings.railExitMin')}
                hint={t('settings.railExitMinHint')}
                unit={u.sym('velocity')}
                step={u.step('velocity', 1)}
                min={0}
                value={u.toUi('velocity', settings.simulation.railExitVelocityMin)}
                onChange={(v) =>
                  setSim({
                    railExitVelocityMin:
                      v == null ? DEFAULT_SETTINGS.simulation.railExitVelocityMin : u.fromUi('velocity', v),
                  })
                }
              />
              {/* The three deployment thresholds. Which one a flight uses depends
                  on the stage's recovery layout: no drogue is single-deployment
                  and uses the first alone; a drogue makes it dual-deployment, and
                  the main is then judged against the other two. All three reach
                  the kernel, which raises the warning — they are not just tile
                  colors, which is all `deploySpeedWarn` used to be. */}
              <NumRow
                label={t('settings.deploySpeedWarn')}
                hint={t('settings.deploySpeedWarnHint')}
                unit={u.sym('velocity')}
                step={u.step('velocity', 1)}
                min={0}
                value={u.toUi('velocity', settings.simulation.deploymentSpeedWarn)}
                onChange={(v) =>
                  setSim({
                    deploymentSpeedWarn:
                      v == null ? DEFAULT_SETTINGS.simulation.deploymentSpeedWarn : u.fromUi('velocity', v),
                  })
                }
              />
              <NumRow
                label={t('settings.mainHighSpeedWarn')}
                hint={t('settings.mainHighSpeedWarnHint')}
                unit={u.sym('velocity')}
                step={u.step('velocity', 1)}
                min={0}
                value={u.toUi('velocity', settings.simulation.mainHighSpeedWarn)}
                onChange={(v) =>
                  setSim({
                    mainHighSpeedWarn:
                      v == null ? DEFAULT_SETTINGS.simulation.mainHighSpeedWarn : u.fromUi('velocity', v),
                  })
                }
              />
              <NumRow
                label={t('settings.mainLowSpeedWarn')}
                hint={t('settings.mainLowSpeedWarnHint')}
                unit={u.sym('velocity')}
                step={u.step('velocity', 1)}
                min={0}
                value={u.toUi('velocity', settings.simulation.mainLowSpeedWarn)}
                onChange={(v) =>
                  setSim({
                    mainLowSpeedWarn:
                      v == null ? DEFAULT_SETTINGS.simulation.mainLowSpeedWarn : u.fromUi('velocity', v),
                  })
                }
              />
            </>
          )}

          {tab === 'launch' && (
            <>
              <p className="text-[11px] leading-snug text-slate-500">{t('settings.launchNote')}</p>
              {/* These are the values a NEW simulation is seeded from, so a
                  blank one would hand every future simulation a hole. Clearing
                  a required field here keeps what it had rather than storing
                  the blank -- which is why no red marker ever shows up in this
                  copy of the panel. */}
              <LaunchPanel
                launch={settings.launchDefaults}
                onChange={(patch) =>
                  update({
                    launchDefaults: withRequiredFrom(
                      { ...settings.launchDefaults, ...patch },
                      DEFAULT_SETTINGS.launchDefaults,
                    ),
                  })
                }
              />
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/10 p-4">
          <div className="flex gap-2">
            <button
              onClick={resetSection}
              className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
            >
              {t('settings.resetTab', { name: t(TABS.find((x) => x.key === tab)!.label) })}
            </button>
            <button
              onClick={reset}
              className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
            >
              {t('settings.resetAll')}
            </button>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-sky-500"
      />
      <span className="text-sm text-slate-300">{label}</span>
    </label>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm text-slate-300">{value}</span>
    </div>
  );
}

function NumRow({
  label,
  unit,
  value,
  step,
  min,
  max,
  placeholder,
  hint,
  onChange,
}: {
  label: string;
  unit?: string;
  value: number | null;
  step: number;
  min?: number;
  max?: number;
  placeholder?: string;
  /** What the number is FOR. A threshold with no explanation is only usable by
   *  someone who already knows what it does. */
  hint?: string;
  onChange: (v: number | null) => void;
}) {
  if (hint) {
    return (
      <div>
        <NumRow
          label={label}
          unit={unit}
          value={value}
          step={step}
          min={min}
          max={max}
          placeholder={placeholder}
          onChange={onChange}
        />
        <p className="mt-0.5 pr-28 text-[11px] leading-snug text-slate-500">{hint}</p>
      </div>
    );
  }
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-300">{label}</span>
      <span className="flex items-center gap-1">
        <NumberInput
          value={value}
          onChange={onChange}
          step={step}
          min={min}
          max={max}
          placeholder={placeholder}
          ariaLabel={label}
          className="w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
        />
        {unit && <span className="min-w-8 text-xs text-slate-500">{unit}</span>}
      </span>
    </label>
  );
}

function ColorRow({
  label,
  value,
  overridden,
  onChange,
  onReset,
  resetTitle,
}: {
  label: string;
  value: string;
  overridden?: boolean;
  onChange: (c: string) => void;
  onReset?: () => void;
  resetTitle?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-300">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-10 cursor-pointer rounded-md border border-white/10 bg-slate-800 p-0.5"
        />
        {overridden && onReset && (
          <button
            onClick={onReset}
            title={resetTitle}
            className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-400 ring-1 ring-white/10 hover:bg-slate-700"
          >
            ↺
          </button>
        )}
      </span>
    </label>
  );
}
