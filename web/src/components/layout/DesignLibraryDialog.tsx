import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { confirm } from '../../state/confirmStore';
import { useFocusTrap } from '../common/useFocusTrap';
import { DesignPropertiesDialog } from './DesignPropertiesDialog';

/**
 * The saved-designs library ("My Rockets").
 *
 * Designs live in IndexedDB (designLibrary.ts) and the open one autosaves, so
 * there is no explicit save here and nothing to lose by switching: opening
 * another design flushes the current one first.
 */
export function DesignLibraryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const designs = useWorkspaceStore((s) => s.designs);
  const activeId = useWorkspaceStore((s) => s.activeDesignId);
  const refresh = useWorkspaceStore((s) => s.refreshDesigns);
  const openDesign = useWorkspaceStore((s) => s.openDesign);
  const renameDesign = useWorkspaceStore((s) => s.renameDesign);
  const deleteDesign = useWorkspaceStore((s) => s.deleteDesign);
  const panelRef = useFocusTrap<HTMLDivElement>(open);

  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  // Deleting a saved design cannot be undone, and on a phone this button sits a
  // few millimeters from Rename in a full-screen dialog. Ask first -- the same
  // gate the far less destructive "close loaded design" already uses.
  const askDelete = async (id: string, name: string) => {
    const ok = await confirm({
      message: t('library.deleteConfirm', { name }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (ok) await deleteDesign(id);
  };

  // `onClose` is an inline arrow in AppHeader, so it gets a NEW identity on every
  // AppHeader render -- and `refresh()` writes a fresh `designs` array that
  // AppHeader subscribes to, which re-renders it. Listing onClose as a dep
  // therefore closed a loop: refresh -> re-render -> new onClose -> refresh.
  // Read it through a ref instead, so the keydown listener always calls the
  // current one without the effect depending on its identity.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Load the list, and drop any half-finished rename, ONCE per opening. Keyed on
  // `open` alone: re-running this on every render would re-close the rename
  // dialog a few ms after the user opened it.
  useEffect(() => {
    if (!open) return;
    void refresh();
    setRenaming(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, refresh]);

  if (!open) return null;

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('library.title')}
    >
      <div
        ref={panelRef}
        className="dialog-panel flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="font-semibold text-slate-100">{t('library.title')}</h2>
          <button onClick={onClose} className="px-2 text-slate-400 hover:text-slate-200" aria-label={t('common.close')}>
            ✕
          </button>
        </div>

        {designs.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">{t('library.empty')}</p>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto">
            {designs.map((d) => (
              <li key={d.id} className="flex items-center gap-2 px-4 py-2.5">
                <button
                  onClick={() => {
                    void openDesign(d.id);
                    onClose();
                  }}
                  className="flex-1 text-left"
                >
                  <span className={`text-sm ${d.id === activeId ? 'font-semibold text-sky-400' : 'text-slate-100'}`}>
                    {d.name}
                  </span>
                  <span className="ml-2 text-xs text-slate-500">
                    {new Date(d.updatedAt).toLocaleString()}
                    {d.id === activeId && ` · ${t('library.open')}`}
                  </span>
                </button>
                <button
                  onClick={() => setRenaming({ id: d.id, name: d.name })}
                  className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
                >
                  {t('library.rename')}
                </button>
                <button
                  onClick={() => void askDelete(d.id, d.name)}
                  className="rounded px-2 py-1 text-xs text-slate-400 hover:text-red-300"
                >
                  {t('common.delete')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <DesignPropertiesDialog
        open={renaming !== null}
        title={t('library.rename')}
        confirmLabel={t('library.rename')}
        initialName={renaming?.name ?? ''}
        takenNames={designs.filter((d) => d.id !== renaming?.id).map((d) => d.name)}
        onCancel={() => setRenaming(null)}
        onConfirm={(name) => {
          if (renaming) void renameDesign(renaming.id, name);
          setRenaming(null);
        }}
      />
    </div>
  );
}
