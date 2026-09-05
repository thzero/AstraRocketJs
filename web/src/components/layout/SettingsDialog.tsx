import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../state/SettingsProvider';
import { DEFAULT_SETTINGS, type SimulationSettings } from '../../services/settings';
import { PART_KEYS, mergePalette } from '../../services/partColors';
import { LaunchPanel } from '../sim/LaunchPanel';

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const speedLabel = (s: number) => (s === 0.25 ? '¼×' : s === 0.5 ? '½×' : `${s}×`);

type TabKey = 'parts' | 'phases' | 'playback' | 'sim' | 'launch';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'parts', label: 'settings.tabParts' },
  { key: 'phases', label: 'settings.tabPhases' },
  { key: 'playback', label: 'settings.tabPlayback' },
  { key: 'sim', label: 'settings.tabSim' },
  { key: 'launch', label: 'settings.tabLaunch' },
];

/** Settings panel — tabbed: 3D part colours, flight-path phase colours, and the
 *  default playback speed. Persisted via the SettingsProvider. */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { settings, update, reset } = useSettings();
  // Part colours are a desktop 3D-model concern; hide that tab on mobile (< lg).
  const isDesktop = useIsDesktop();
  const visibleTabs = isDesktop ? TABS : TABS.filter((tb) => tb.key !== 'parts');
  const [tab, setTab] = useState<TabKey>(() => (isDesktop ? 'parts' : 'phases'));
  useEffect(() => {
    if (!visibleTabs.some((tb) => tb.key === tab)) setTab(visibleTabs[0].key);
  }, [visibleTabs, tab]);

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

  const resetSection = () => {
    if (tab === 'parts') update({ partColors: {} });
    else if (tab === 'phases') update({ phaseColors: DEFAULT_SETTINGS.phaseColors });
    else if (tab === 'playback') update({ playbackSpeed: DEFAULT_SETTINGS.playbackSpeed });
    else if (tab === 'sim') update({ simulation: DEFAULT_SETTINGS.simulation });
    else update({ launchDefaults: DEFAULT_SETTINGS.launchDefaults });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex h-[560px] max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-slate-900 ring-1 ring-white/10"
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

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 px-4 pt-3">
          {visibleTabs.map((tb) => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${tab === tb.key ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              {t(tb.label)}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {tab === 'parts' &&
            PART_KEYS.map((key) => (
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

          {tab === 'phases' && (
            <>
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
                {t('settings.warnings')}
              </div>
              <NumRow
                label={t('settings.railExitMin')}
                unit="m/s"
                step={1}
                min={0}
                value={settings.simulation.railExitVelocityMin}
                onChange={(v) => setSim({ railExitVelocityMin: v ?? DEFAULT_SETTINGS.simulation.railExitVelocityMin })}
              />
              <NumRow
                label={t('settings.deploySpeedWarn')}
                unit="m/s"
                step={1}
                min={0}
                value={settings.simulation.deploymentSpeedWarn}
                onChange={(v) => setSim({ deploymentSpeedWarn: v ?? DEFAULT_SETTINGS.simulation.deploymentSpeedWarn })}
              />
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
                label={t('settings.randomSeed')}
                step={1}
                placeholder={t('settings.seedAuto')}
                value={settings.simulation.randomSeed}
                onChange={(v) => setSim({ randomSeed: v })}
              />
            </>
          )}

          {tab === 'launch' && (
            <>
              <p className="text-[11px] leading-snug text-slate-500">{t('settings.launchNote')}</p>
              <LaunchPanel
                launch={settings.launchDefaults}
                onChange={(patch) => update({ launchDefaults: { ...settings.launchDefaults, ...patch } })}
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

/** True at the app's desktop breakpoint (Tailwind `lg`, ≥1024px). */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => setDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return desktop;
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
  placeholder,
  onChange,
}: {
  label: string;
  unit?: string;
  value: number | null;
  step: number;
  min?: number;
  placeholder?: string;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-300">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={step}
          min={min}
          placeholder={placeholder}
          value={value === null || value === undefined || Number.isNaN(value) ? '' : value}
          onChange={(e) => onChange(e.target.value === '' ? null : parseFloat(e.target.value) || 0)}
          className="w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
        />
        {unit && <span className="w-4 text-xs text-slate-500">{unit}</span>}
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
