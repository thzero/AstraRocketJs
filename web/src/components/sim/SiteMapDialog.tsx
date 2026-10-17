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
 * Clicking the map hands the coordinates to the caller's `onPick`: the launch
 * panel writes them as one undoable edit on whichever simulations it is
 * editing, and a tool writes them to its own site.
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
      // It opens over the launch panel, which is itself inside a dialog in
      // Settings, or over a tool's site fields.
      layer="over"
      size="3xl"
      // A map cannot usefully scroll, so the body takes the height and the map
      // fills it.
      layout="fill"
    >
      <SiteMap latitudeDeg={latitudeDeg} longitudeDeg={longitudeDeg} onPick={onPick} className="m-4 min-h-0 flex-1" />
    </Dialog>
  );
}
