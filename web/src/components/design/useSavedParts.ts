import { useEffect, useState } from 'react';
import { useLatest } from '../common/useLatest';
import { listSavedParts, onSavedPartsChanged, type SavedPartEntry } from '../../services/parts/customParts';

/**
 * Every saved part, kept in step with the store.
 *
 * Subscribed to `onSavedPartsChanged`, so saving a part in the property panel
 * or deleting one from the component picker updates this list without the
 * dialog being reopened. That signal is the same one the picker uses.
 *
 * The sequence guard is the one `useLocationList` documents: the FIRST read of
 * a session waits on IndexedDB opening its database, a write in the meantime
 * refreshes and resolves first, and then that first answer lands, taken before
 * anything was saved, and overwrites it with an empty list that nothing
 * retries.
 *
 * `null` means not read yet, so the view can tell an empty library apart from
 * an unread one instead of flashing "nothing saved" at somebody who has parts.
 */
export function useSavedParts(): { entries: SavedPartEntry[] | null } {
  const [entries, setEntries] = useState<SavedPartEntry[] | null>(null);
  /** Which read is the current one; an older answer, or one after unmount, is dropped. */
  const { claim } = useLatest();

  useEffect(() => {
    const refresh = () => {
      const mine = claim();
      listSavedParts()
        .then((list) => {
          if (mine()) setEntries(list);
        })
        .catch(() => {
          if (mine()) setEntries([]);
        });
    };
    refresh();
    return onSavedPartsChanged(refresh);
  }, [claim]);

  return { entries };
}
