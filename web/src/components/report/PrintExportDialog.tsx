import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { Dialog } from '../common/Dialog';
import { printableParts } from '../../services/exports/printableParts';
import { partLabel } from '../../i18n/format';
import { Check } from '../common/Check';
import { DialogButton } from '../common/DialogButton';

/**
 * The whole-rocket 3D-print export.
 *
 * A list of what the design can actually print, ticked by default, plus the two
 * choices that change the shape of the output rather than its content: one file
 * of named objects or a zip of one file per part, and whether each part is
 * dropped onto the build plate.
 *
 * Only printable parts are listed. A parachute or a mass component has no solid
 * body, and offering it a tick box that does nothing would be a worse answer
 * than leaving it out; the per-component ⬇ button takes the same line.
 */
export function PrintExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const tree = useWorkspaceStore((s) => s.tree);
  const exportPrint = useWorkspaceStore((s) => s.exportPrint);

  const parts = useMemo(() => printableParts(tree), [tree]);
  // What the list shows, and what the file's object names become for a part
  // with no name of its own: the same string in both places.
  const label = (p: (typeof parts)[number]) => partLabel(t, p);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [separateFiles, setSeparateFiles] = useState(false);
  const [placeOnPlate, setPlaceOnPlate] = useState(true);

  // Tracked as exclusions, not inclusions: everything is on by default, and a
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
      // The intro and the options/Save row are pinned, above and below the part
      // list, which is the only thing here that can grow. Left in the flow, the
      // Save button would sit below however many parts the design has.
      toolbar={empty ? undefined : <p className="px-4 py-2 text-xs leading-snug text-ink-muted">{t('print.intro')}</p>}
      footer={
        empty ? undefined : (
          <>
            <div className="space-y-2 px-4 py-3">
              <Check
                className="text-xs text-ink-soft"
                checked={separateFiles}
                onChange={setSeparateFiles}
                label={t('print.separateFiles')}
              />
              <Check
                className="text-xs text-ink-soft"
                checked={placeOnPlate}
                onChange={setPlaceOnPlate}
                label={t('print.placeOnPlate')}
              />
              <p className="text-[11px] leading-snug text-ink-faint">{t('print.orientationNote')}</p>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line/10 px-4 py-3">
              <span className="text-xs text-ink-muted">{t('print.count', { count: selected.length })}</span>
              <DialogButton
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
                variant="primary"
              >
                {t('print.save')}
              </DialogButton>
            </div>
          </>
        )
      }
    >
      {empty ? (
        <p className="px-4 py-8 text-center text-sm text-ink-muted">{t('print.nothing')}</p>
      ) : (
        <ul className="px-4 py-2">
          {parts.map((p) => (
            <li key={p.id} style={{ paddingLeft: `${p.depth * 14}px` }}>
              <Check
                className="py-1 text-sm text-ink"
                checked={!excluded.has(p.id)}
                onChange={() => toggle(p.id)}
                label={label(p)}
              />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
