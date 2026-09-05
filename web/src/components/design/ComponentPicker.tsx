import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { componentsForType, filterComponents, type ComponentType, type Component } from '../../services/componentDb';
import { fmtNum } from '../../i18n/format';

/**
 * Picks a real catalogued part (from the bundled OpenRocket component DB) of a
 * given type and applies it via `onApply`. Opens a modal dialog with a live
 * search over manufacturer / part number / description; the caller maps the
 * chosen Component onto its target node (see catalogPatch).
 */
export function ComponentPicker({ type, onApply }: { type: ComponentType; onApply: (p: Component) => void }) {
  const { t } = useTranslation();
  const all = useMemo(() => componentsForType(type), [type]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const matches = useMemo(() => filterComponents(all, q).slice(0, 300), [all, q]);

  // Reset the query each time the dialog opens; close on Escape.
  useEffect(() => {
    if (!open) return;
    setQ('');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const dims = (p: Component): string => {
    if (p.type === 'parachute') return `⌀ ${fmtNum(p.diameter * 1000, 0)} mm · Cd ${fmtNum(p.cd ?? 0.8, 2)}`;
    if (p.type === 'nosecone')
      return `${p.shape} · ⌀ ${fmtNum(p.outerDiameter * 1000, 1)} mm · ${fmtNum(p.length * 1000, 0)} mm`;
    return `⌀ ${fmtNum(p.outerDiameter * 1000, 1)} mm · ${fmtNum(p.length * 1000, 0)} mm`;
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-lg bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
      >
        {t('picker.pick', { count: all.length })}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/10 p-3">
              <h2 className="text-sm font-semibold text-slate-200">{t('picker.dialogTitle')}</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label={t('picker.close')}
                className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="p-3">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
                placeholder={t('picker.search')}
                className="w-full rounded-lg bg-slate-950 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-sky-500"
              />
            </div>

            <ul className="min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto">
              {matches.map((p, i) => (
                <li key={`${p.mfr}:${p.partNo}:${i}`}>
                  <button
                    onClick={() => {
                      onApply(p);
                      setOpen(false);
                    }}
                    className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-slate-800"
                  >
                    <span className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">
                        <span className="text-slate-500">{p.mfr}</span>{' '}
                        <span className="font-medium text-slate-100">{p.partNo}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-xs text-slate-400">{dims(p)}</span>
                    </span>
                    {p.desc && <span className="truncate text-xs text-slate-500">{p.desc}</span>}
                  </button>
                </li>
              ))}
              {matches.length === 0 && (
                <li className="px-3 py-8 text-center text-sm text-slate-500">{t('picker.noResults')}</li>
              )}
            </ul>

            <div className="border-t border-white/10 p-2 text-center text-[11px] uppercase tracking-wide text-slate-500">
              {t('picker.results', { count: matches.length })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
