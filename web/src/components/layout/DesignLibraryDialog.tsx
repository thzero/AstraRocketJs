import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { confirm } from '../../state/confirmStore';
import { Dialog } from '../common/Dialog';
import { DesignPropertiesDialog } from './DesignPropertiesDialog';
import { ExampleList } from './ExamplesDialog';

/**
 * The saved-designs library ("My Rockets"), and the bundled examples beside it.
 *
 * Designs live in IndexedDB (designLibrary.ts) and the open one autosaves, so
 * there is no explicit save here and nothing to lose by switching: opening
 * another design flushes the current one first.
 *
 * Mounted only while open (`{open && <DesignLibraryDialog />}`): the list is
 * refreshed once on mount, and a half-finished rename is dropped by unmount.
 */
export function DesignLibraryDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const designs = useWorkspaceStore((s) => s.designs);
  const activeId = useWorkspaceStore((s) => s.activeDesignId);
  const refresh = useWorkspaceStore((s) => s.refreshDesigns);
  const openDesign = useWorkspaceStore((s) => s.openDesign);
  const renameDesign = useWorkspaceStore((s) => s.renameDesign);
  const deleteDesign = useWorkspaceStore((s) => s.deleteDesign);
  // `onClose` is an inline arrow in AppHeader, so it gets a NEW identity on
  // every AppHeader render, and `refresh()` writes a fresh `designs` array
  // that AppHeader subscribes to. One effect that both refreshed and listened
  // for Escape, keyed on onClose, therefore looped: refresh -> re-render ->
  // new onClose -> refresh. The refresh runs once on mount (below); the Escape
  // listener is the focus trap's own effect, which re-subscribes harmlessly.

  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [tab, setTab] = useState<'mine' | 'examples'>('mine');

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The saved-at stamp in the app's language, not the browser's: a Spanish UI
  // over an en-US browser showed "9/20/2026, 3:04 PM" beside Spanish labels.
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

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

  return (
    <>
      <Dialog
        id="designLibrary"
        title={t('library.title')}
        onClose={onClose}
        size="lg"
        toolbar={
          // A real tablist, not two buttons that look like one: the settings
          // dialog sets the precedent and screen readers get the relationship.
          // It sits in the toolbar band so it stays put while the list scrolls.
          <div role="tablist" aria-label={t('library.title')} className="flex gap-1 px-2 pt-2">
            {(['mine', 'examples'] as const).map((key) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`rounded-t-md px-3 py-1.5 text-xs font-medium ${
                  tab === key ? 'bg-white/10 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {key === 'mine' ? t('library.mine') : t('library.examples')}
              </button>
            ))}
          </div>
        }
      >
        {tab === 'examples' ? (
          <ExampleList onClose={onClose} />
        ) : designs.length === 0 ? (
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
                    {when.format(new Date(d.updatedAt))}
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
      </Dialog>

      {renaming && (
        <DesignPropertiesDialog
          title={t('library.rename')}
          confirmLabel={t('library.rename')}
          initialName={renaming.name}
          takenNames={designs.filter((d) => d.id !== renaming.id).map((d) => d.name)}
          onCancel={() => setRenaming(null)}
          onConfirm={(name) => {
            void renameDesign(renaming.id, name);
            setRenaming(null);
          }}
        />
      )}
    </>
  );
}
