import { useCallback, useEffect, useRef, useState } from 'react';
import { getLaunchLocationStore, type LaunchLocation } from '../../services/launchLocationStore';

/**
 * The saved locations, kept in step with the store.
 *
 * Shared by the launch panel's dropdown and the manage dialog, which both list
 * the same locations and both have to re-read them after a write.
 *
 * The sequence guard is not defensive tidiness. The FIRST `list()` of a session
 * waits on IndexedDB opening its database, which on a busy machine takes longer
 * than every later read put together; a save in the meantime refreshes and
 * resolves first, and then that first answer lands - taken before anything was
 * saved, so EMPTY - and overwrites it. The result is a dropdown with no locations in
 * it over a database that has them, and nothing retries, because nothing knows
 * it is wrong. It showed up as an intermittent end-to-end failure where the
 * stored blob held the location and the select did not.
 *
 * `null` means not read yet, which is how the manage dialog tells an empty list
 * apart from an unread one and avoids flashing its "no saved locations" card at
 * somebody who has several.
 */
export function useLocationList(): { locations: LaunchLocation[] | null; refresh: () => Promise<void> } {
  const [locations, setPads] = useState<LaunchLocation[] | null>(null);

  // Re-armed in the effect body, not only cleared in cleanup: the app mounts
  // under StrictMode, whose development double-invoke runs the cleanup once and
  // then the effect again (see MaterialPicker for the same guard).
  const mounted = useRef(true);
  /** Which read is the current one; an older answer is dropped, not applied. */
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++latest.current;
    const list = await getLaunchLocationStore().list();
    if (mounted.current && seq === latest.current) setPads(list);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => mounted.current && setPads([]));
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  return { locations, refresh };
}
