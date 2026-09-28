import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { Dialog } from '../common/Dialog';
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

  const empty = parts.length === 0;
  return (
    <Dialog
      id="printExport"
      title={t('print.title')}
      onClose={onClose}
      size="lg"
      // The intro and the options/Save row are PINNED, above and below the part
      // list, which is the only thing here that can grow. Leaving them in the
      // flow put the Save button below however many parts the design has.
      toolbar={empty ? undefined : <p className="px-4 py-2 text-xs leading-snug text-slate-400">{t('print.intro')}</p>}
      footer={
        empty ? undefined : (
          <>
            <div className="space-y-2 px-4 py-3">
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
        )
      }
    >
      {empty ? (
        <p className="px-4 py-8 text-center text-sm text-slate-400">{t('print.nothing')}</p>
      ) : (
        <ul className="px-4 py-2">
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
      )}
    </Dialog>
  );
}
