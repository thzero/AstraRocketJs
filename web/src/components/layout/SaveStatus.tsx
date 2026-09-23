import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';

/** How often the relative time is recomputed while the app sits idle. */
const TICK_MS = 30_000;

/**
 * "Saved just now" in the header: when the autosave last actually landed.
 *
 * This replaced the File menu's **Save** item. That item never stood between
 * the user and their work - editing autosaves on a 500 ms debounce and unload
 * writes a synchronous journal - so what it really offered was the reassurance
 * that saving was happening at all, and it charged a click for it. A status
 * says the same thing without being asked, and says it from the only place
 * that knows: the write's own success path (useWorkspaceEffects), not the
 * moment something requested one.
 *
 * Silent until the first write, because "Saved" over a design that has never
 * reached storage is the one thing it must not say. Silent under the storage
 * banner too: that banner says work is NOT being kept, it outlives any one
 * write, and two contradicting claims in the same header is worse than one.
 */
export function SaveStatus() {
  const { t, i18n } = useTranslation();
  const lastSavedAt = useWorkspaceStore((s) => s.lastSavedAt);
  const warning = useWorkspaceStore((s) => s.storageWarning);

  // The clock is STATE, read in render, rather than a `Date.now()` in the
  // markup: the interval is what makes "just now" become "5 minutes ago" on a
  // design nobody is touching, and a render that read the wall clock directly
  // would be at the mercy of whatever else happened to re-render the header.
  //
  // A save can land BEFORE the next tick, leaving `now` behind `lastSavedAt`.
  // That needs no extra set: the clamp below reads a negative age as zero,
  // which is "just now", which is what it is.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (lastSavedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [lastSavedAt]);

  if (lastSavedAt === null || warning) return null;

  const mins = Math.floor(Math.max(0, now - lastSavedAt) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
  const when =
    mins < 1 ? t('save.justNow') : mins < 60 ? rtf.format(-mins, 'minute') : rtf.format(-Math.floor(mins / 60), 'hour');

  return (
    <span
      // `status`, not `alert`: it is a background fact about the app, and a
      // polite live region is what lets a screen reader reach it on request
      // without interrupting whatever the user is doing.
      role="status"
      title={t('save.tip', {
        time: new Intl.DateTimeFormat(i18n.language, { timeStyle: 'medium' }).format(new Date(lastSavedAt)),
      })}
      className="text-[10px] font-medium text-slate-500"
    >
      {t('save.saved', { when })}
    </span>
  );
}
