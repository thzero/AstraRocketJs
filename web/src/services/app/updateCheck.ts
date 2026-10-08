/**
 * When to ask the server whether a newer build exists, and when to ask the user
 * about it again.
 *
 * The service worker is registered with `registerType: 'prompt'` so a deploy can
 * never reload the page under someone mid-design. The cost of that choice is
 * that nothing happens on its own: the browser only looks for a new worker on a
 * navigation, so a tab left open all afternoon (which is how this app is
 * used) would never find out a new version had shipped.
 *
 * The timing lives here rather than in the component so it can be tested without
 * a service worker, a fake clock in a jsdom page, or the `virtual:pwa-register`
 * module.
 */

/**
 * How often a tab that is simply sitting there asks again.
 *
 * Ten minutes, not an hour. The site is served through the GitHub Pages CDN,
 * which caches `sw.js` for 600 s and ignores the no-cache request a worker
 * update check sends (and a cache-busting query, which it strips), so a
 * deploy is invisible to every browser for up to ten minutes whatever they
 * do. An hourly poll stacked on that would let a focused tab sit on a stale
 * build for over an hour with no toast, and the natural reaction is a hard
 * reload, which is the thing the toast exists to spare people. Each check is
 * one conditional GET of a 12 kB script; ten minutes is cheap.
 */
export const UPDATE_POLL_MS = 10 * 60_000;

/**
 * The shortest gap between two checks.
 *
 * The event-driven triggers (coming back to the tab, coming back online) fire as
 * often as the user alt-tabs, and each check is a network request for the
 * worker. This is the floor that keeps a restless afternoon from becoming a
 * poll loop.
 */
export const UPDATE_MIN_GAP_MS = 5 * 60_000;

/**
 * How long "Later" holds the prompt back.
 *
 * Held back rather than dismissed for the session: a permanent dismissal means
 * one click and no further mention however long the tab stays open. Long enough
 * not to nag, short enough that a day's work does not end on a stale build.
 */
export const UPDATE_SNOOZE_MS = 2 * 60 * 60_000;

/**
 * Whether enough time has passed since the last check to make another one.
 *
 * `last` is null when none has happened yet, which is always due.
 */
export function dueForCheck(last: number | null, now: number, gap: number = UPDATE_MIN_GAP_MS): boolean {
  return last === null || now - last >= gap;
}

/** When a snooze started now would end. */
export function snoozeUntil(now: number, ms: number = UPDATE_SNOOZE_MS): number {
  return now + ms;
}

/**
 * How long the tab has to stay hidden before a waiting update is applied
 * without anyone having asked for it.
 *
 * Long enough that alt-tabbing to read a motor chart and coming straight back
 * does not reload the page under you; short enough that stepping away for a
 * minute is enough. The design is already safe either way (the workspace
 * autosaves on a 500 ms debounce and flushes on `visibilitychange`), so what
 * this protects is attention, not data.
 */
export const UPDATE_APPLY_HIDDEN_MS = 30_000;

/**
 * Whether a waiting worker may be applied with no answer from the user.
 *
 * `registerType: 'prompt'` means the new worker activates only when the running
 * page posts SKIP_WAITING, and `clientsClaim` is off, so it cannot take over by
 * itself. A worker nobody asks for therefore waits for the life of the tab.
 * That is a permanent stranding in three ordinary cases: a build old enough to
 * have no prompt, a second tab holding the old worker alive, and the prompt
 * simply being dismissed. The only escape is the hard reload this whole
 * mechanism exists to spare people, so an offer nobody answered is taken up on
 * their behalf, but only once doing it cannot interrupt anything.
 *
 * `busy` is a flight in the air. A reload would throw it away, and it is the
 * one thing here that keeps running while the tab is hidden.
 */
export function readyToApplyHidden(
  waiting: boolean,
  hiddenSince: number | null,
  busy: boolean,
  now: number,
  after: number = UPDATE_APPLY_HIDDEN_MS,
): boolean {
  if (!waiting || busy || hiddenSince === null) return false;
  return now - hiddenSince >= after;
}
