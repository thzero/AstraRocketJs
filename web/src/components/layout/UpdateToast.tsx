import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useTranslation } from 'react-i18next';
import { APP_VERSION } from '../../services/appInfo';
import { UPDATE_POLL_MS, dueForCheck, promptDue, snoozeUntil, UPDATE_SNOOZE_MS } from '../../services/updateCheck';

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
 *     found out. It now polls hourly, and again whenever the tab is brought back
 *     to the front or the network returns, both rate-limited.
 *   - Dismissing was permanent. `setNeedRefresh(false)` for the rest of the
 *     session, so one click and it never mentioned the update again. "Later" now
 *     snoozes, and the prompt comes back.
 *
 * Deliberately NOT a modal. A modal on a deploy would interrupt an edit in
 * progress, which is the exact thing `registerType: 'prompt'` exists to prevent;
 * this says its piece from the bottom of the window and lets you finish the
 * sentence you were typing.
 */
export function UpdateToast() {
  const { t } = useTranslation();
  const lastCheck = useRef<number | null>(null);
  const [snoozed, setSnoozed] = useState<number | null>(null);

  // The registration arrives from a library callback, so it is held in state to
  // hand it to an effect - which is what gets a cleanup. Wiring the timer and
  // the listeners inside the callback leaked both: it has no unmount hook, and
  // under StrictMode the whole thing runs twice in development.
  const [swReg, setSwReg] = useState<ServiceWorkerRegistration | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      lastCheck.current = Date.now(); // registering just did one
      setSwReg(registration ?? null);
    },
  });

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

  // Snoozing hides the prompt without throwing away `needRefresh`, so the same
  // waiting worker is still there to offer when the snooze runs out.
  useEffect(() => {
    if (snoozed === null) return;
    const id = setTimeout(() => setSnoozed(null), Math.max(0, snoozed - Date.now()));
    return () => clearTimeout(id);
  }, [snoozed]);

  const later = useCallback(() => setSnoozed(snoozeUntil(Date.now())), []);

  if (!needRefresh || !promptDue(snoozed, Date.now())) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[min(30rem,92vw)] items-center gap-3 rounded-xl bg-slate-800 px-4 py-3 text-sm text-slate-100 shadow-lg ring-1 ring-white/10"
      role="status"
    >
      <div className="min-w-0 flex-1">
        <p>{t('update.available')}</p>
        {/* Which build you are ON. The waiting worker does not tell us its own
            version, so this names the one being replaced rather than inventing
            the one replacing it. */}
        <p className="text-xs text-slate-400">{t('update.running', { version: APP_VERSION })}</p>
      </div>
      <button
        onClick={() => void updateServiceWorker(true)}
        className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500"
      >
        {t('update.reload')}
      </button>
      <button
        onClick={later}
        title={t('update.laterTitle', { hours: Math.round(UPDATE_SNOOZE_MS / 3_600_000) })}
        className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:text-slate-200"
      >
        {t('update.later')}
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        className="shrink-0 rounded-lg px-1 py-1.5 text-slate-500 hover:text-slate-200"
        aria-label={t('update.dismiss')}
      >
        ✕
      </button>
    </div>
  );
}
