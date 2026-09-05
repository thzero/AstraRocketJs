import { useTranslation } from 'react-i18next';

/** Banner shown when a .ork was imported: the design name, a discard button, and
 *  any warnings raised while opening it (nothing else — a clean import is quiet). */
export function LoadedBanner({ loaded, onClose }: { loaded: { name: string; notes: string[] }; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="m-3 rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">{t('banner.loaded')}</div>
          <div className="truncate text-lg font-semibold text-sky-400">{loaded.name}</div>
        </div>
        <button
          onClick={onClose}
          title={t('banner.closeTitle')}
          className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300"
        >
          {t('banner.close')}
        </button>
      </div>
      {loaded.notes.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-amber-400/90">
          {loaded.notes.map((n, i) => (
            <li key={i}>⚠ {n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
