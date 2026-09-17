import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { appName } from '../../services/appInfo';
import { useFocusTrap } from '../common/useFocusTrap';

/** Privacy policy modal — the app is client-only; nothing leaves the device
 *  except the optional public motor-data fetch. Copy lives in i18n. */
export function PrivacyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Tab stays inside the modal, and focus returns to the trigger on close.
  // Seven dialogs declared aria-modal and had neither, so Tab walked straight
  // out into the page behind the overlay — the exact gap useFocusTrap exists
  // to close, already used by seven of their siblings.
  const panelRef = useFocusTrap<HTMLDivElement>(open);
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="dialog-overlay fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={panelRef}
        className="dialog-panel w-full max-w-lg rounded-2xl bg-slate-900 p-6 ring-1 ring-white/10"
        role="dialog"
        aria-modal="true"
        aria-label={t('privacy.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">{t('privacy.title')}</h2>
          <button
            onClick={onClose}
            aria-label={t('privacy.close')}
            className="shrink-0 rounded-lg bg-slate-800 px-2 py-1 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-300">
          <p>{t('privacy.intro', { name: appName() })}</p>
          <p>{t('privacy.storage')}</p>
          <p>{t('privacy.network')}</p>
          <p className="text-xs text-slate-500">{t('privacy.hosting')}</p>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            {t('privacy.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
