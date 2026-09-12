/**
 * Ask the browser to keep this origin's storage.
 *
 * By default storage is "best effort": under disk pressure the browser may evict
 * an origin's data without asking, which here would take the user's designs,
 * custom motors and materials with it (IndexedDB — see idbKeyValueStore.ts)
 * along with the offline caches. `persist()` moves the origin to "persistent",
 * where data is only removed if the user removes it.
 *
 * Called after the first autosave rather than at startup, deliberately: Chrome
 * grants this silently based on engagement/installation, but Firefox shows a
 * permission prompt, and prompting someone who has just landed on the page and
 * has nothing stored yet is both annoying and likely to be denied. Waiting until
 * a design has actually been saved means there is something to protect and the
 * request makes sense.
 */

let attempted = false;

/** Request persistent storage once per session. Best-effort and never throws. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (attempted) return false;
  attempted = true;
  try {
    if (!navigator.storage?.persist) return false; // Safari < 17, older browsers
    if (await navigator.storage.persisted()) return true; // already granted
    return await navigator.storage.persist();
  } catch {
    // Denied, unsupported, or blocked by policy — the app works either way.
    return false;
  }
}
