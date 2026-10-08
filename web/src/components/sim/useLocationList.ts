import { useCallback, useEffect, useState } from 'react';
import { useLatest } from '../common/useLatest';
import { getLaunchLocationStore, type LaunchLocation } from '../../services/storage/launchLocationStore';

/**
 * The saved locations, kept in step with the store.
 *
 * Shared by the launch panel's dropdown and the manage dialog, which both list
 * the same locations and both have to re-read them after a write.
 *
 * The sequence guard is required. The first `list()` of a session waits on
 * IndexedDB opening its database, which on a busy machine takes longer than
 * every later read put together; a save in the meantime refreshes and resolves
 * first, and then that first answer (taken before anything was saved, so empty)
 * would land and overwrite it. The result would be a dropdown with no locations
 * in it over a database that has them, and nothing retries, because nothing
 * knows it is wrong.
 *
 * `null` means not read yet, which is how the manage dialog tells an empty list
 * apart from an unread one and avoids flashing its "no saved locations" card at
 * somebody who has several.
 */
export function useLocationList(): { locations: LaunchLocation[] | null; refresh: () => Promise<void> } {
  const [locations, setPads] = useState<LaunchLocation[] | null>(null);

  /** Which read is the current one; an older answer, or one after unmount, is dropped. */
  const { claim } = useLatest();

  const refresh = useCallback(async () => {
    const mine = claim();
    const list = await getLaunchLocationStore().list();
    if (mine()) setPads(list);
  }, [claim]);

  // The first read, with an empty list as its fallback. A caller's `refresh`
  // rejects to that caller instead.
  useEffect(() => {
    const mine = claim();
    // Async, so a store that throws synchronously still lands in the fallback.
    void (async () => getLaunchLocationStore().list())().then(
      (list) => mine() && setPads(list),
      () => mine() && setPads([]),
    );
  }, [claim]);

  return { locations, refresh };
}
