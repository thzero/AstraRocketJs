import { useTranslation } from 'react-i18next';
import { Dialog } from '../common/Dialog';
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
      // fills it. `role="dialog"` used to sit on the OVERLAY here, which told
      // assistive tech the whole viewport was the dialog.
      layout="fill"
    >
      <SiteMap latitudeDeg={latitudeDeg} longitudeDeg={longitudeDeg} onPick={onPick} className="m-4 min-h-0 flex-1" />
    </Dialog>
  );
}
