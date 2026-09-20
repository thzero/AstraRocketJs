import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '../common/useFocusTrap';

/**
 * Name/rename a saved design. Used by File > Save As... and by Rename in the
 * library, which differ only in title and button label.
 *
 * Replaces a `window.prompt`, which could not be styled, translated reliably,
 * or validated, and which some browsers suppress entirely.
 *
 * Mounted only while open (`{open && <DesignPropertiesDialog />}`), so the
 * name field is seeded once from `initialName` in its initializer; there is no
 * "reseed on open" effect, and every rename gets a fresh instance.
 */
export function DesignPropertiesDialog({
  title,
  confirmLabel,
  initialName,
  takenNames = [],
  onCancel,
  onConfirm,
}: {
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
  const panelRef = useFocusTrap<HTMLDivElement>(true, { onEscape: onCancel });

  // Select the seeded name so typing replaces it. A frame later: the focus
  // trap has just moved focus into the panel, and a select() before that
  // would be undone by it.
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.select());
    return () => cancelAnimationFrame(id);
  }, []);

  const trimmed = name.trim();
  const duplicate = trimmed !== '' && takenNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());
  const submit = () => {
    if (trimmed === '') return; // the empty name is the one thing we refuse
    onConfirm(trimmed);
  };

  return (
    <div
      className="dialog-overlay fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4"
      // This dialog is rendered INSIDE another overlay (the library's), so a
      // bare onCancel here would bubble and dismiss both at once.
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        ref={panelRef}
        className="dialog-panel w-full max-w-sm rounded-2xl bg-slate-900 p-6 ring-1 ring-white/10"
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

        {/* A duplicate name is allowed (designs are keyed by id, not name) but
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
