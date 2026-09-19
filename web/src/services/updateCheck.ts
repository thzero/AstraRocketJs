/**
 * When to ask the server whether a newer build exists, and when to ask the user
 * about it again.
 *
 * The service worker is registered with `registerType: 'prompt'` so a deploy can
 * never reload the page under someone mid-design. The cost of that choice is
 * that nothing happens on its own: the browser only looks for a new worker on a
 * NAVIGATION, so a tab left open all afternoon -- which is exactly how this app
 * is used -- would never find out a new version had shipped.
 *
 * The timing lives here rather than in the component so it can be tested without
 * a service worker, a fake clock in a jsdom page, or the `virtual:pwa-register`
 * module.
 */

/** How often a tab that is simply sitting there asks again. */
export const UPDATE_POLL_MS = 60 * 60_000;

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
 * Dismissing used to be permanent for the session: one click and the app never
 * mentioned it again, however long the tab stayed open. That is a dismissal, not
 * a reminder. Long enough not to nag, short enough that a day's work does not
 * end on a stale build.
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

/** Whether the prompt may show, given a snooze that may still be running. */
export function promptDue(snoozedUntil: number | null, now: number): boolean {
  return snoozedUntil === null || now >= snoozedUntil;
}

/** When a snooze started now would end. */
export function snoozeUntil(now: number, ms: number = UPDATE_SNOOZE_MS): number {
  return now + ms;
}
