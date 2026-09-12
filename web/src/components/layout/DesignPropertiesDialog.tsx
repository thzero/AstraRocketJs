import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '../common/useFocusTrap';

/**
 * Name/rename a saved design. Used by File → Save As… and by Rename in the
 * library, which differ only in title and button label.
 *
 * Replaces a `window.prompt`, which could not be styled, translated reliably,
 * or validated — and which some browsers suppress entirely.
 */
export function DesignPropertiesDialog({
  open,
  title,
  confirmLabel,
  initialName,
  takenNames = [],
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  initialName: string;
  /** Other designs' names, to warn about a duplicate (not to forbid it). */
  takenNames?: string[];
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useFocusTrap<HTMLDivElement>(open);

  // Reseed each time it opens — the same dialog instance serves Save As and
  // every rename, so a stale value from last time would be wrong.
  useEffect(() => {
    if (!open) return;
    setName(initialName);
    const id = requestAnimationFrame(() => inputRef.current?.select());
    return () => cancelAnimationFrame(id);
  }, [open, initialName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const trimmed = name.trim();
  const duplicate = trimmed !== '' && takenNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());
  const submit = () => {
    if (trimmed === '') return; // the empty name is the one thing we refuse
    onConfirm(trimmed);
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4" onClick={onCancel}>
      <div
        ref={panelRef}
        className="w-full max-w-sm rounded-2xl bg-slate-900 p-6 ring-1 ring-white/10"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-slate-100">{title}</h2>

        <label htmlFor="design-name" className="mt-4 block text-xs font-medium text-slate-400">
          {t('library.name')}
        </label>
        <input
          id="design-name"
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          maxLength={80}
          className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10 focus:ring-sky-500"
        />

        {/* A duplicate name is allowed — designs are keyed by id, not name — but
            two identical rows in the library are confusing, so say so. */}
        {duplicate && <p className="mt-2 text-xs text-amber-300">{t('library.duplicateName')}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={trimmed === ''}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
