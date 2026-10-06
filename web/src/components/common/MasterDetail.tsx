import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { confirm } from '../../state/confirmStore';

/**
 * The selection of a library dialog whose detail pane is an editor.
 *
 * The editor reports whether it holds unsaved edits (`onDirtyChange`), since
 * only the editor owns the draft, and `select` asks before a move would throw
 * them away. It resolves false when the user keeps editing.
 */
export function useGuardedSelection(discardMessage: string) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // Stable, because the editor passes it to an effect: a new function every
  // render would re-run that effect on every keystroke.
  const onDirtyChange = useCallback((d: boolean) => setDirty(d), []);

  const select = async (id: string | null): Promise<boolean> => {
    if (dirty && id !== selectedId) {
      const ok = await confirm({ message: discardMessage, confirmLabel: t('common.discard'), danger: true });
      if (!ok) return false;
      setDirty(false);
    }
    setSelectedId(id);
    return true;
  };

  /** Moves the selection after a save or a delete, which leaves nothing to discard. */
  const settle = (id: string | null) => {
    setDirty(false);
    setSelectedId(id);
  };

  return { selectedId, dirty, select, settle, onDirtyChange };
}

/**
 * The list beside the detail, each scrolling itself. On a phone the two panes
 * share the width, so only one shows at a time and the detail carries a back
 * control.
 */
export function MasterDetail({
  showsDetail,
  list,
  detail,
  hint,
}: {
  showsDetail: boolean;
  list: ReactNode;
  detail: ReactNode;
  /** What the detail pane says with nothing selected. */
  hint: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div
        className={`min-h-0 flex-col overflow-y-auto md:flex md:w-[300px] md:shrink-0 md:border-r md:border-white/10 ${
          showsDetail ? 'hidden md:flex' : 'flex'
        }`}
      >
        {list}
      </div>
      <div className={`min-h-0 min-w-0 flex-1 flex-col ${showsDetail ? 'flex' : 'hidden md:flex'}`}>
        {showsDetail ? (
          detail
        ) : (
          <div className="grid flex-1 place-items-center p-6 text-center text-sm text-slate-500">{hint}</div>
        )}
      </div>
    </div>
  );
}

/** One row of the list: a name line and a detail line under it. */
export function MasterRow({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`block w-full px-4 py-2.5 text-left ${
        selected ? 'bg-sky-600/25 ring-1 ring-inset ring-sky-500/50' : 'hover:bg-slate-800'
      }`}
    >
      {children}
    </button>
  );
}

/** The dialog footer line that reports a failed write. */
export function MasterStatus({ err }: { err: string | null }) {
  return err ? (
    <p role="status" aria-live="polite" className="px-4 py-2 text-xs text-amber-400">
      {err}
    </p>
  ) : null;
}

/**
 * The editor's action row, pinned under its scrolling fields. Delete sits
 * apart from Save, at the other end of the row, because they are not two
 * grades of the same action. `children` goes between them.
 */
export function EditorFooter({
  onDelete,
  dirty,
  onRevert,
  onSave,
  saveDisabled,
  saveTitle,
  children,
}: {
  onDelete?: () => void;
  dirty: boolean;
  onRevert: () => void;
  onSave: () => void;
  /** Beyond "nothing changed", which always disables Save. */
  saveDisabled?: boolean;
  saveTitle?: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-white/10 p-2">
      {onDelete && (
        <button
          onClick={onDelete}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/10"
        >
          {t('common.delete')}
        </button>
      )}
      {children}
      <button
        onClick={onRevert}
        disabled={!dirty}
        className="ml-auto rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700 disabled:opacity-40"
      >
        {t('common.discard')}
      </button>
      <button
        onClick={onSave}
        disabled={!dirty || saveDisabled}
        title={saveTitle}
        className="shrink-0 rounded-lg bg-sky-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
      >
        {t('common.save')}
      </button>
    </div>
  );
}
