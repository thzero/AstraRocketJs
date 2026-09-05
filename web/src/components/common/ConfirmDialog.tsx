import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirmStore } from '../../state/confirmStore';

/**
 * The single app-wide confirmation modal, driven imperatively by the confirm
 * store (see {@link confirm}). Mounted once at the app root. Enter confirms,
 * Escape / backdrop cancels. Styled to match the other dialogs; the confirm
 * button turns red for destructive actions.
 */
export function ConfirmDialog() {
  const { t } = useTranslation();
  const request = useConfirmStore((s) => s.request);
  const settle = useConfirmStore((s) => s.settle);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false);
      else if (e.key === 'Enter') settle(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, settle]);

  if (!request) return null;
  const { title, message, confirmLabel, cancelLabel, danger } = request;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4" onClick={() => settle(false)}>
      <div
        className="w-full max-w-sm rounded-2xl bg-slate-900 p-6 ring-1 ring-white/10"
        role="alertdialog"
        aria-modal="true"
        aria-label={title ?? t('common.confirmTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-slate-100">{title ?? t('common.confirmTitle')}</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={() => settle(false)}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
          >
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            autoFocus
            onClick={() => settle(true)}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-sky-600 hover:bg-sky-500'}`}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
