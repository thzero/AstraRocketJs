import { useTranslation } from 'react-i18next';
import { appName, isPreRelease } from '../../services/appInfo';
import { useSettings } from '../../state/SettingsProvider';

/**
 * A one-time "this is a work in progress" gate, shown on load while the app is
 * pre-1.0 (see {@link isPreRelease}) until the user accepts. The acceptance is
 * persisted as `wipAcknowledged` in the app settings store, so it survives
 * reloads and rides along with the rest of the user's preferences. It is modal
 * and must be acknowledged — no outside-click / Escape dismissal.
 */
export function WorkInProgressDialog() {
  const { t } = useTranslation();
  const { settings, update } = useSettings();

  if (!isPreRelease() || settings.wipAcknowledged) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4">
      <div
        className="w-full max-w-md rounded-2xl bg-slate-900 p-6 ring-1 ring-white/10"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="wip-title"
      >
        <div className="flex items-center gap-3">
          <span className="text-3xl">🚧</span>
          <h2 id="wip-title" className="text-lg font-semibold text-slate-100">
            {t('wip.title')}
          </h2>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-300">{t('wip.body', { name: appName() })}</p>
        <div className="mt-6 flex justify-end">
          <button
            onClick={() => update({ wipAcknowledged: true })}
            autoFocus
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            {t('wip.accept')}
          </button>
        </div>
      </div>
    </div>
  );
}
