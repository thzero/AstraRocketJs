import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_VERSION, helpUrlFor, isPreRelease } from '../../services/appInfo';
import { useWorkspaceStore } from '../../state/store';
import { LanguageSwitcher } from './LanguageSwitcher';
import { WorkbenchTabs } from './WorkbenchTabs';
import { EngineBadge } from './EngineBadge';
import { SaveStatus } from './SaveStatus';
import { UndoRedoButtons } from './UndoRedoButtons';
import { FileMenuButton } from './FileMenu';
import { useHeaderDialogs } from './HeaderDialogs';
import { useUndoShortcuts } from './useUndoShortcuts';

/** Top bar: title + version, the desktop workbench tabs, the save status,
 *  language, and a collapsible menu holding the New / Open (library) / Save As /
 *  Import / Export / About actions. Owns the hidden .ork / .rkt file inputs that
 *  Import triggers; the badge, the undo pair and the dialogs are their own
 *  modules. */
export function AppHeader() {
  const { t, i18n } = useTranslation();
  const canSave = useWorkspaceStore((s) => !!s.info);
  const onNew = useWorkspaceStore((s) => s.newWorkspace);
  const onOpenFile = useWorkspaceStore((s) => s.openOrkFile);
  const onSave = useWorkspaceStore((s) => s.saveOrk);
  const refreshDesigns = useWorkspaceStore((s) => s.refreshDesigns);
  const onSaveRasaero = useWorkspaceStore((s) => s.saveRasaero);
  const onSaveRkt = useWorkspaceStore((s) => s.saveRkt);
  const orkRef = useRef<HTMLInputElement>(null);
  // A second input for the same handler, differing only in its `accept`. One
  // input filtered to both would show `.ork` files to somebody who picked
  // RockSim from the menu; the reader sniffs the bytes either way
  // (services/designFile.ts), so a mislabeled file still opens.
  const rktRef = useRef<HTMLInputElement>(null);
  const { open, dialogs } = useHeaderDialogs();

  useUndoShortcuts();

  return (
    // flex-wrap, not a fixed row: the title, badges and action group together
    // need ~530px, so on a phone the row used to run off the right edge and
    // make the whole DOCUMENT scroll sideways, which slid the bottom tab bar
    // out of view with it. Wrapping keeps every control reachable and the page
    // exactly one viewport wide, at any width and in any language.
    <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3">
      <span className="text-xl">🚀</span>
      <h1 className="text-base font-semibold tracking-tight">{t('app.title')}</h1>
      <button
        onClick={() => open('about')}
        title={t('about.open')}
        className="rounded text-[10px] font-medium tabular-nums text-slate-500 hover:text-sky-400"
      >
        v{APP_VERSION}
      </button>
      {isPreRelease() && (
        <span
          title={t('about.wip')}
          className="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300 ring-1 ring-amber-400/30"
        >
          {t('wip.badge')}
        </span>
      )}
      <EngineBadge />
      <SaveStatus />

      {/* The desktop workbench tabs live in the header's dead middle rather than
          in a strip of their own below it. Hidden below lg, where the bottom
          TabBar takes over. */}
      <WorkbenchTabs />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <UndoRedoButtons />
        <LanguageSwitcher />
        <FileMenuButton
          canSave={canSave}
          helpHref={helpUrlFor(i18n.language)}
          actions={{
            onNew,
            onOpenLibrary: () => open('library'),
            onSaveAs: () => {
              // Names of existing designs drive the duplicate warning.
              void refreshDesigns();
              open('saveAs');
            },
            onImportOrk: () => orkRef.current?.click(),
            onImportRkt: () => rktRef.current?.click(),
            onImportExamples: () => open('examples'),
            onExportOrk: onSave,
            onExportRkt: onSaveRkt,
            onExportPrint: () => open('print'),
            onExportRasaero: onSaveRasaero,
            onReport: () => open('report'),
            onMotors: () => open('motors'),
            onLaunchLocations: () => open('locations'),
            onSettings: () => open('settings'),
            onPrivacy: () => open('privacy'),
            onAbout: () => open('about'),
          }}
        />
      </div>

      {(
        [
          [orkRef, '.ork'],
          [rktRef, '.rkt'],
        ] as const
      ).map(([ref, accept]) => (
        <input
          key={accept}
          ref={ref}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onOpenFile(f);
          }}
        />
      ))}
      {dialogs}
    </header>
  );
}
