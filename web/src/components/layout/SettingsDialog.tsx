import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../state/SettingsProvider';
import { DEFAULT_SETTINGS } from '../../services/settings';
import { PART_KEYS, mergePalette } from '../../services/partColors';

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const speedLabel = (s: number) => (s === 0.25 ? '¼×' : s === 0.5 ? '½×' : `${s}×`);

/** Settings panel: 3D part colours, flight-path phase colours, and the default
 *  playback speed — all persisted via the SettingsProvider. */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { settings, update, reset } = useSettings();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const palette = mergePalette(settings.partColors);
  const setPart = (key: string, color: string) => update({ partColors: { ...settings.partColors, [key]: color } });
  const resetPart = (key: string) => { const p = { ...settings.partColors }; delete p[key as keyof typeof p]; update({ partColors: p }); };
  const setPhase = (k: 'boost' | 'coast' | 'descent', c: string) => update({ phaseColors: { ...settings.phaseColors, [k]: c } });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-slate-900 ring-1 ring-white/10"
        role="dialog" aria-modal="true" aria-label={t('settings.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
          <h2 className="text-lg font-semibold text-slate-100">{t('settings.title')}</h2>
          <button
            onClick={onClose} aria-label={t('settings.close')}
            className="shrink-0 rounded-lg bg-slate-800 px-2 py-1 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
          >✕</button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          <Section title={t('settings.parts')} onReset={() => update({ partColors: {} })} resetLabel={t('settings.resetSection')}>
            {PART_KEYS.map((key) => (
              <ColorRow
                key={key} label={t(`settings.part.${key}`)} value={palette[key]}
                overridden={key in settings.partColors}
                onChange={(c) => setPart(key, c)} onReset={() => resetPart(key)} resetTitle={t('settings.resetOne')}
              />
            ))}
          </Section>

          <Section title={t('settings.phases')} onReset={() => update({ phaseColors: DEFAULT_SETTINGS.phaseColors })} resetLabel={t('settings.resetSection')}>
            <ColorRow label={t('flight.boost')} value={settings.phaseColors.boost} onChange={(c) => setPhase('boost', c)} />
            <ColorRow label={t('flight.coast')} value={settings.phaseColors.coast} onChange={(c) => setPhase('coast', c)} />
            <ColorRow label={t('flight.descent')} value={settings.phaseColors.descent} onChange={(c) => setPhase('descent', c)} />
          </Section>

          <Section title={t('settings.playback')} onReset={() => update({ playbackSpeed: DEFAULT_SETTINGS.playbackSpeed })} resetLabel={t('settings.resetSection')}>
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-400">{t('settings.defaultSpeed')}</span>
              <select
                value={settings.playbackSpeed}
                onChange={(e) => update({ playbackSpeed: parseFloat(e.target.value) })}
                className="rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
              >
                {SPEEDS.map((s) => <option key={s} value={s}>{speedLabel(s)}</option>)}
              </select>
            </label>
          </Section>
        </div>

        <div className="flex items-center justify-between border-t border-white/10 p-4">
          <button onClick={reset} className="text-xs font-medium text-slate-400 hover:text-slate-200">{t('settings.reset')}</button>
          <button onClick={onClose} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500">{t('settings.close')}</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, onReset, resetLabel }: {
  title: string; children: React.ReactNode; onReset?: () => void; resetLabel?: string;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
        {onReset && (
          <button onClick={onReset} className="text-[11px] font-medium text-sky-400 hover:underline">{resetLabel}</button>
        )}
      </div>
      {children}
    </section>
  );
}

function ColorRow({ label, value, overridden, onChange, onReset, resetTitle }: {
  label: string; value: string; overridden?: boolean;
  onChange: (c: string) => void; onReset?: () => void; resetTitle?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-300">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color" value={value} onChange={(e) => onChange(e.target.value)}
          className="h-7 w-10 cursor-pointer rounded-md border border-white/10 bg-slate-800 p-0.5"
        />
        {overridden && onReset && (
          <button
            onClick={onReset} title={resetTitle}
            className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-400 ring-1 ring-white/10 hover:bg-slate-700"
          >↺</button>
        )}
      </span>
    </label>
  );
}
