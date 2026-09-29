import { useEffect, useRef, useState } from 'react';
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
  // Re-armed in the effect body rather than only cleared in cleanup: the app
  // mounts under StrictMode, whose development double-invoke runs the cleanup
  // once and then the effect again (see MaterialPicker for the same guard).
  const mounted = useRef(true);
  /** Which read is the current one; an older answer is dropped, not applied. */
  const latest = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      const seq = ++latest.current;
      listSavedParts()
        .then((list) => {
          if (mounted.current && seq === latest.current) setEntries(list);
        })
        .catch(() => {
          if (mounted.current && seq === latest.current) setEntries([]);
        });
    };
    refresh();
    const stop = onSavedPartsChanged(refresh);
    return () => {
      mounted.current = false;
      stop();
    };
  }, []);

  return { entries };
}
