import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useTranslation } from 'react-i18next';
import { APP_VERSION } from '../../services/app/appInfo';
import {
  UPDATE_POLL_MS,
  dueForCheck,
  snoozeUntil,
  UPDATE_SNOOZE_MS,
  readyToApplyHidden,
} from '../../services/app/updateCheck';
import { useWorkspaceStore } from '../../state/store';
import { useUpdateStore } from '../../state/updateStore';

/**
 * "A new version is available — reload?" for the service worker.
 *
 * The SW is registered with `registerType: 'prompt'` precisely so a deploy cannot
 * reload the page under someone mid-design. Applying the update calls
 * skipWaiting and reloads, so it has to be the user's choice.
 *
 * It also has to ASK, though, and for a long time it effectively did not. Two
 * things were missing:
 *
 *   - Nothing ever checked. `useRegisterSW` was called with no `onRegisteredSW`,
 *     so the only time the browser looked for a new worker was on a navigation.
 *     A tab left open across a deploy - the normal way this app is used - never
 *     found out. It now polls (see UPDATE_POLL_MS), and again whenever the tab
 *     is brought back to the front or the network returns, both rate-limited.
 *   - Dismissing was permanent. `setNeedRefresh(false)` for the rest of the
 *     session, so one click and it never mentioned the update again. "Later" now
 *     snoozes, and the prompt comes back.
 *
 * Deliberately NOT a modal. A modal on a deploy would interrupt an edit in
 * progress, which is the exact thing `registerType: 'prompt'` exists to prevent.
 * It is a banner across the top instead, under the header with the app's other
 * banners: hard to miss, and it still lets you finish the sentence you were
 * typing. A card in a bottom corner was easy to take for part of the page.
 *
 * And it finishes the job whether or not it is answered. Under `prompt` the new
 * worker activates only when the page posts SKIP_WAITING, and `clientsClaim` is
 * off, so one that is never asked waits for the life of the tab - which is the
 * whole of it if the prompt was dismissed, if a second tab is holding the old
 * worker alive, or if the running build is old enough to have no prompt at all.
 * A tab left hidden long enough therefore takes the update up unasked; see
 * `readyToApplyHidden`.
 */
export function UpdateToast() {
  const lastCheck = useRef<number | null>(null);
  const [snoozed, setSnoozed] = useState<number | null>(null);

  // The registration arrives from a library callback, so it is held in state to
  // hand it to an effect - which is what gets a cleanup. Wiring the timer and
  // the listeners inside the callback leaked both: it has no unmount hook, and
  // under StrictMode the whole thing runs twice in development.
  const [swReg, setSwReg] = useState<ServiceWorkerRegistration | null>(null);

  /*
   * A waiting worker, remembered independently of whether the PROMPT is still
   * showing.
   *
   * Dismissing the toast hides the offer; it does not make the new build go
   * away, and `setNeedRefresh(false)` is the app forgetting the one fact it
   * needs to finish the job. The worker is still sitting there waiting to be
   * asked, and with `clientsClaim` off it will wait for the life of the tab.
   */
  const [waiting, setWaiting] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      lastCheck.current = Date.now(); // registering just did one
      setSwReg(registration ?? null);
    },
    // The worker telling us one is waiting, which is the fact the dismissal
    // below must not erase. Taken from the registration's own callback rather
    // than derived from `needRefresh`, so nothing here has to set state from a
    // render or an effect to remember it.
    onNeedRefresh() {
      setWaiting(true);
    },
    // The library reloads only on a controller change, and only when a worker
    // already controlled the page at load. Routed through `reloadOnce` so the
    // reload `apply` arranges below and this one never both run.
    onNeedReload: reloadOnce,
  });

  /*
   * Take the waiting worker up, then land on it.
   *
   * `updateServiceWorker(true)` posts SKIP_WAITING, and the library reloads
   * when the new worker takes control. A tab opened on its FIRST visit has no
   * controller (`clientsClaim` is off), so the new worker activates without
   * ever taking control of it and nothing reloads: Reload did nothing at all.
   * Waiting for the worker to reach `activated` covers that tab, and a worker
   * already gone from `waiting` (another tab took it up) needs only a reload.
   */
  const apply = useCallback(() => {
    const next = swReg?.waiting;
    if (swReg && !next) {
      reloadOnce();
      return;
    }
    next?.addEventListener('statechange', () => next.state === 'activated' && reloadOnce());
    // The button says "Reloading" from the click on, so it must: a worker that
    // never reaches `activated` would otherwise leave it saying so forever.
    if (swReg) setTimeout(reloadOnce, APPLY_FALLBACK_MS);
    void updateServiceWorker(true);
  }, [swReg, updateServiceWorker]);

  useEffect(() => {
    if (!swReg) return;
    const check = () => {
      const now = Date.now();
      if (!dueForCheck(lastCheck.current, now)) return;
      lastCheck.current = now;
      // A failed check is not worth reporting: the app works offline by design,
      // and "could not reach the server" is not news at a launch site.
      void swReg.update().catch(() => {});
    };
    const onVisible = () => document.visibilityState === 'visible' && check();
    const id = setInterval(check, UPDATE_POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', check);
    };
  }, [swReg]);

  /*
   * The About dialog's "Check for updates": the same update() the timer calls,
   * but waited on and answered. A worker that starts installing is followed to
   * the end, so "up to date" is never said over a download still in progress.
   * One already waiting, behind a dismissed or snoozed banner, brings the banner
   * back: the person asked.
   */
  useEffect(() => {
    if (!swReg) return;
    const { setChecker } = useUpdateStore.getState();
    setChecker(async () => {
      lastCheck.current = Date.now();
      await swReg.update();
      const installing = swReg.installing;
      if (installing) {
        await new Promise<void>((done) => {
          const settle = () => {
            if (installing.state === 'installed' || installing.state === 'redundant') done();
          };
          installing.addEventListener('statechange', settle);
          settle();
        });
      }
      if (!swReg.waiting) return 'upToDate';
      setSnoozed(null);
      setNeedRefresh(true);
      return 'available';
    });
    return () => setChecker(null);
  }, [swReg, setNeedRefresh]);

  /*
   * Apply it while nobody is looking.
   *
   * `registerType: 'prompt'` is the right default and stays: a deploy must not
   * reload the page mid-design. But an offer that is never answered leaves the
   * tab on the old build for good, and the only way out is the hard reload this
   * whole mechanism exists to spare people. So once the tab has been hidden
   * long enough for a reload to cost nothing, it is taken up unasked.
   *
   * `simBusy` is read at the moment it fires rather than subscribed to: a
   * flight in the air is the one thing that keeps running while the tab is
   * hidden, and re-running this effect every time it changes would restart the
   * clock on a batch finishing.
   */
  useEffect(() => {
    if (!waiting) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      stop();
      if (document.visibilityState !== 'hidden') return;
      const hiddenSince = Date.now();
      // Polled rather than a single timeout: if a flight is still in the air
      // when the wait is up, this has to come back to it rather than give up.
      timer = setInterval(() => {
        if (!readyToApplyHidden(true, hiddenSince, useWorkspaceStore.getState().simBusy, Date.now())) return;
        stop();
        apply();
      }, 5_000);
    };
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility(); // the tab may be hidden already
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [waiting, apply]);

  // Snoozing hides the prompt without throwing away `needRefresh`, so the same
  // waiting worker is still there to offer when the snooze runs out.
  useEffect(() => {
    if (snoozed === null) return;
    const id = setTimeout(() => setSnoozed(null), Math.max(0, snoozed - Date.now()));
    return () => clearTimeout(id);
  }, [snoozed]);

  const later = useCallback(() => setSnoozed(snoozeUntil(Date.now())), []);

  // No clock read in render: the snooze effect above nulls `snoozed` the
  // moment it expires, so "not snoozed" is the whole condition.
  const show = needRefresh && snoozed === null;

  // The live region is ALWAYS mounted; only its contents come and go.
  //
  // A `role="status"` created at the same moment as its text is not announced
  // by most screen readers - the region has to exist in the DOM before
  // content is inserted into it. Rendering `null` until there was something
  // to say meant the toast announced nothing, which is the entire purpose of
  // the toast.
  return (
    <div role="status" aria-live="polite">
      {show && <UpdateToastBody onRefresh={apply} onLater={later} onDismiss={() => setNeedRefresh(false)} />}
    </div>
  );
}

/** How long Reload waits for the new worker before reloading regardless. */
const APPLY_FALLBACK_MS = 10_000;

let reloading = false;

/** Reload the page, once, however many paths ask for it. */
function reloadOnce(): void {
  if (reloading) return;
  reloading = true;
  window.location.reload();
}

function UpdateToastBody({
  onRefresh,
  onLater,
  onDismiss,
}: {
  onRefresh: () => void;
  onLater: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  // Set on the click and never cleared: the page reloads out from under it.
  // Until then the new worker is activating, which takes a moment, and a
  // button that looked untouched in that moment read as one that did nothing.
  const [applying, setApplying] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-sky-500/40 bg-sky-900/60 px-4 py-2 text-sm text-sky-50">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t('update.available')}</p>
        {/* Which build you are ON. The waiting worker does not tell us its own
            version, so this names the one being replaced rather than inventing
            the one replacing it. */}
        <p className="text-xs text-sky-200/80">{t('update.running', { version: APP_VERSION })}</p>
      </div>
      <button
        onClick={() => {
          setApplying(true);
          onRefresh();
        }}
        disabled={applying}
        aria-busy={applying}
        className="flex shrink-0 items-center gap-2 rounded-lg bg-sky-500 px-3 py-1.5 font-semibold text-white transition-transform hover:bg-sky-400 active:scale-95 active:bg-sky-600 disabled:cursor-wait disabled:bg-sky-700 disabled:active:scale-100"
      >
        {applying && (
          <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        )}
        {applying ? t('update.reloading') : t('update.reload')}
      </button>
      {/* Gone once Reload is pressed: there is nothing left to put off. */}
      {!applying && (
        <>
          <button
            onClick={onLater}
            title={t('update.laterTitle', { hours: Math.round(UPDATE_SNOOZE_MS / 3_600_000) })}
            className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-sky-200 hover:text-white"
          >
            {t('update.later')}
          </button>
          <button
            onClick={onDismiss}
            className="shrink-0 rounded-lg px-1 py-1.5 text-sky-300 hover:text-white"
            aria-label={t('update.dismiss')}
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
}
