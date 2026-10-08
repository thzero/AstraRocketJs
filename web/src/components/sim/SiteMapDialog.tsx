import { useTranslation } from 'react-i18next';
import { Dialog } from '../common/Dialog';
import { SiteMap } from './SiteMap';

/**
 * The launch site map, opened over the panel that holds the site fields.
 *
 * The site card sits in a narrow column, and a map that small shows a field and
 * nothing around it (not the road in, not the town, not the next field over),
 * which is exactly the context that tells you whether you have the right place.
 * So it opens rather than sitting inline: the location editor, which is already
 * a dialog, has room for the map under its fields and keeps it there.
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

  return (
    <Dialog
      id="siteMap"
      title={t('map.title')}
      onClose={onClose}
      // It opens over the simulation panel, which is itself inside a dialog when
      // reached from the location editor.
      layer="over"
      size="3xl"
      // A map cannot usefully scroll, so the body takes the height and the map
      // fills it. `role="dialog"` belongs on the panel, not the overlay, which
      // would tell assistive tech the whole viewport is the dialog.
      layout="fill"
    >
      <SiteMap latitudeDeg={latitudeDeg} longitudeDeg={longitudeDeg} onPick={onPick} className="m-4 min-h-0 flex-1" />
    </Dialog>
  );
}
