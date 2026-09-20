import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';

/**
 * The header's undo / redo button pair, enabled by the workspace history
 * stacks. The keyboard shortcuts are `useUndoShortcuts`, mounted by the bar.
 */

const iconBtn =
  'rounded-lg bg-slate-800 px-2.5 py-1.5 text-sm leading-none text-slate-200 ring-1 ring-white/10 hover:bg-slate-700 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-slate-800';

export function UndoRedoButtons() {
  const { t } = useTranslation();
  const onUndo = useWorkspaceStore((s) => s.undo);
  const onRedo = useWorkspaceStore((s) => s.redo);
  const canUndo = useWorkspaceStore((s) => s.past.length > 0);
  const canRedo = useWorkspaceStore((s) => s.future.length > 0);

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onUndo}
        disabled={!canUndo}
        title={`${t('edit.undo')} (Ctrl+Z)`}
        aria-label={t('edit.undo')}
        className={iconBtn}
      >
        ↶
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo}
        title={`${t('edit.redo')} (Ctrl+Shift+Z)`}
        aria-label={t('edit.redo')}
        className={iconBtn}
      >
        ↷
      </button>
    </div>
  );
}
