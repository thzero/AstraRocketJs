import { useRegisterSW } from 'virtual:pwa-register/react';
import { useTranslation } from 'react-i18next';

/**
 * "A new version is available — reload?" for the service worker.
 *
 * The SW is registered with `registerType: 'prompt'` precisely so a deploy cannot
 * reload the page under someone mid-design. Applying the update calls
 * skipWaiting and reloads, so it has to be the user's choice; dismissing keeps
 * the running version until the next natural reload.
 */
export function UpdateToast() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[min(26rem,92vw)] items-center gap-3 rounded-xl bg-slate-800 px-4 py-3 text-sm text-slate-100 shadow-lg ring-1 ring-white/10"
      role="status"
    >
      <p className="flex-1">{t('update.available')}</p>
      <button
        onClick={() => void updateServiceWorker(true)}
        className="rounded-lg bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500"
      >
        {t('update.reload')}
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        className="rounded-lg px-2 py-1.5 text-slate-400 hover:text-slate-200"
        aria-label={t('update.dismiss')}
      >
        ✕
      </button>
    </div>
  );
}
