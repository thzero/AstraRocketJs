import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { useFocusTrap } from '../common/useFocusTrap';
import { printableParts } from '../../services/rocketPrintExport';

/**
 * The whole-rocket 3D-print export.
 *
 * A list of what the design can actually print, ticked by default, plus the two
 * choices that change the shape of the output rather than its content: one file
 * of named objects or a zip of one file per part, and whether each part is
 * dropped onto the build plate.
 *
 * Only PRINTABLE parts are listed. A parachute or a mass component has no solid
 * body, and offering it a tick box that does nothing would be a worse answer
 * than leaving it out — the per-component ⬇ button takes the same line.
 */
export function PrintExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const tree = useWorkspaceStore((s) => s.tree);
  const exportPrint = useWorkspaceStore((s) => s.exportPrint);
  const panelRef = useFocusTrap<HTMLDivElement>(true, { onEscape: onClose });

  const parts = useMemo(() => printableParts(tree), [tree]);
  // What the list shows, and what the file's object names become for a part
  // with no name of its own — the same string in both places.
  const label = (p: (typeof parts)[number]) => p.name || t(`part.${p.type}`, { defaultValue: p.type });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [separateFiles, setSeparateFiles] = useState(false);
  const [placeOnPlate, setPlaceOnPlate] = useState(true);

  // Tracked as EXCLUSIONS, not inclusions: everything is on by default, and a
  // design edited behind this dialog would otherwise silently drop a new part.
  const selected = parts.filter((p) => !excluded.has(p.id));
  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('print.title')}
    >
      <div
        ref={panelRef}
        className="dialog-panel flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="font-semibold text-slate-100">{t('print.title')}</h2>
          <button onClick={onClose} className="px-2 text-slate-400 hover:text-slate-200" aria-label={t('common.close')}>
            ✕
          </button>
        </div>

        {parts.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">{t('print.nothing')}</p>
        ) : (
          <>
            <p className="border-b border-white/10 px-4 py-2 text-xs leading-snug text-slate-400">{t('print.intro')}</p>
            <ul className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
              {parts.map((p) => (
                <li key={p.id} style={{ paddingLeft: `${p.depth * 14}px` }}>
                  <label className="flex items-center gap-2 py-1 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={!excluded.has(p.id)}
                      onChange={() => toggle(p.id)}
                      className="accent-sky-500"
                    />
                    {label(p)}
                  </label>
                </li>
              ))}
            </ul>
            <div className="space-y-2 border-t border-white/10 px-4 py-3">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={separateFiles}
                  onChange={(e) => setSeparateFiles(e.target.checked)}
                  className="accent-sky-500"
                />
                {t('print.separateFiles')}
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={placeOnPlate}
                  onChange={(e) => setPlaceOnPlate(e.target.checked)}
                  className="accent-sky-500"
                />
                {t('print.placeOnPlate')}
              </label>
              <p className="text-[11px] leading-snug text-slate-500">{t('print.orientationNote')}</p>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
              <span className="text-xs text-slate-400">{t('print.count', { count: selected.length })}</span>
              <button
                disabled={selected.length === 0}
                onClick={() => {
                  void exportPrint({
                    include: new Set(selected.map((p) => p.id)),
                    separateFiles,
                    placeOnPlate,
                    labels: Object.fromEntries(selected.map((p) => [p.id, label(p)])),
                  });
                  onClose();
                }}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {t('print.save')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
