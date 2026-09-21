import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '../common/useFocusTrap';
import { SiteMap } from './SiteMap';

/**
 * The launch site map, opened over the simulation panel.
 *
 * The site card is one column of a three-column workbench, around 380px wide,
 * and a map that small shows a field and nothing around it - not the road in,
 * not the town, not the next field over, which is exactly the context that
 * tells you whether you have the right place. So it opens rather than sitting
 * inline: the location editor, which is already a dialog, has room for the map
 * beside its fields and keeps it there.
 *
 * Clicking the map writes the coordinates through the panel's own change path,
 * so it is one undoable edit like typing them, and it lands on whichever
 * simulations the panel is editing rather than only the active one.
 */
export function SiteMapDialog({
  latitudeDeg,
  longitudeDeg,
  onPick,
  onClose,
}: {
  latitudeDeg: number | null;
  longitudeDeg: number | null;
  onPick: (latitudeDeg: number, longitudeDeg: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panelRef = useFocusTrap<HTMLDivElement>(true, { onEscape: onClose });

  return (
    <div
      className="dialog-overlay fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('map.title')}
    >
      <div
        ref={panelRef}
        className="dialog-panel flex h-[80vh] max-h-[44rem] w-full max-w-3xl flex-col gap-3 rounded-2xl bg-slate-900 p-4 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-100">{t('map.title')}</h2>
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-300 hover:text-slate-100"
          >
            {t('common.close')}
          </button>
        </div>
        <SiteMap latitudeDeg={latitudeDeg} longitudeDeg={longitudeDeg} onPick={onPick} className="min-h-0 flex-1" />
      </div>
    </div>
  );
}
