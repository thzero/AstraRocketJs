import { useEffect, useState } from 'react';
import { useTabs } from '../common/useTabs';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { confirm } from '../../state/confirmStore';
import { Dialog } from '../common/Dialog';
import { DesignPropertiesDialog } from './DesignPropertiesDialog';
import { ExampleList } from './ExamplesDialog';

const LIBRARY_TABS = ['mine', 'examples'] as const;

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
  // `onClose` is an inline arrow in AppHeader, so it gets a new identity on
  // every AppHeader render, and `refresh()` writes a fresh `designs` array
  // that AppHeader subscribes to. An effect keyed on onClose that refreshed
  // would loop: refresh -> re-render -> new onClose -> refresh. So the refresh
  // runs once on mount (below); the Escape listener is the focus trap's own
  // effect, which re-subscribes harmlessly.

  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [tab, setTab] = useState<'mine' | 'examples'>('mine');
  const tabs = useTabs(LIBRARY_TABS, tab, setTab);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The saved-at stamp in the app's language, not the browser's: otherwise a
  // Spanish UI over an en-US browser shows "9/20/2026, 3:04 PM" beside Spanish labels.
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  // Deleting a saved design cannot be undone, and on a phone this button sits a
  // few millimeters from Rename in a full-screen dialog. Ask first: the same
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
            {LIBRARY_TABS.map((key) => (
              <button
                key={key}
                {...tabs.tab(key)}
                className={`rounded-t-md px-3 py-1.5 text-xs font-medium ${
                  tab === key ? 'bg-line/10 text-ink-strong' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {key === 'mine' ? t('library.mine') : t('library.examples')}
              </button>
            ))}
          </div>
        }
      >
        <div {...tabs.panel} className="flex min-h-0 flex-1 flex-col">
          {tab === 'examples' ? (
            <ExampleList onClose={onClose} />
          ) : designs.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">{t('library.empty')}</p>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-line/5 overflow-y-auto">
              {designs.map((d) => (
                <li key={d.id} className="flex items-center gap-2 px-4 py-2.5">
                  <button
                    onClick={() => {
                      void openDesign(d.id);
                      onClose();
                    }}
                    className="flex-1 text-left"
                  >
                    <span
                      className={`text-sm ${d.id === activeId ? 'font-semibold text-accent-400' : 'text-ink-strong'}`}
                    >
                      {d.name}
                    </span>
                    <span className="ml-2 text-xs text-ink-faint">
                      {when.format(new Date(d.updatedAt))}
                      {d.id === activeId && ` · ${t('library.open')}`}
                    </span>
                  </button>
                  <button
                    onClick={() => setRenaming({ id: d.id, name: d.name })}
                    className="rounded px-2 py-1 text-xs text-ink-muted hover:text-ink"
                  >
                    {t('library.rename')}
                  </button>
                  <button
                    onClick={() => void askDelete(d.id, d.name)}
                    className="rounded px-2 py-1 text-xs text-ink-muted hover:text-danger-300"
                  >
                    {t('common.delete')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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
