import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserKeyStore } from '../../services/storage/userKey';

/**
 * A field for a key the user enters for a third-party service
 * (services/storage/userKey), with its label, placeholder and note.
 *
 * Writes only what the user typed: on blur, and on unmount too, since the
 * Settings dialog closing with Escape removes the field with no blur. A field
 * that was not edited writes nothing, so a key saved meanwhile in another tab
 * is never overwritten with this one's stale copy.
 */
export function UserKeyField({
  store,
  label,
  placeholder,
  note,
  notSaved,
}: {
  store: UserKeyStore;
  label: string;
  placeholder: string;
  note: string;
  notSaved: string;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(() => store.read() ?? '');
  const [failed, setFailed] = useState(false);
  const edited = useRef<string | null>(null);
  const save = () => {
    if (edited.current === null) return;
    const ok = store.write(edited.current);
    if (ok) edited.current = null;
    setFailed(!ok);
  };
  useEffect(
    () => () => {
      if (edited.current !== null) store.write(edited.current);
    },
    [store],
  );
  return (
    <div className="space-y-1 not-first:border-t not-first:border-line/10 not-first:pt-2">
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-muted">{t(label)}</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={t(placeholder)}
          onChange={(e) => {
            setValue(e.target.value);
            edited.current = e.target.value;
          }}
          onBlur={save}
          className="w-56 rounded-md bg-raised px-2 py-1 text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
        />
      </label>
      <p className="text-[11px] leading-snug text-ink-faint">{t(note)}</p>
      <p role="status" aria-live="polite" className="text-[11px] leading-snug text-warn-400">
        {failed ? t(notSaved) : ''}
      </p>
    </div>
  );
}
