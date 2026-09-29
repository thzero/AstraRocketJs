import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_VERSION, isPreRelease } from '../../services/appInfo';
import { useWorkspaceStore } from '../../state/store';
import { useHelpStore } from '../../state/helpStore';
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
  const { t } = useTranslation();
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
  const openHelp = useHelpStore((s) => s.openHelp);

  useUndoShortcuts();

  return (
    // flex-wrap, not a fixed row: the title, the live save state and the action
    // group together outrun a phone's width, and a fixed row would run off the
    // right edge and make the whole DOCUMENT scroll sideways, sliding the bottom
    // tab bar out of view. Wrapping keeps every control reachable and the page
    // exactly one viewport wide, at any width and in any language.
    <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3">
      <span className="text-xl">🚀</span>
      <h1 className="text-base font-semibold tracking-tight">{t('app.title')}</h1>
      {/* The three static badges - version, pre-release, engine backend - in one
          pill rather than three, and shown from the `badge` breakpoint up.

          They are the only things in this row that are neither a control nor
          live state, so they are what gives when the row runs out of width, and
          it does: from the lg breakpoint (1024) up the workbench tabs are in
          the header and the save status is showing, and with these three the
          row needs 1176px in the longest language (ru; pt-PT wants 1172, de
          1168, en 1120). `--breakpoint-badge` is 1180. Wrapping to two lines
          puts back the row the tabs were moved into the header to save, so they
          hide below the width where they fit rather than being allowed to push.
          Nothing is lost by that: the version and the backend are both in the
          About dialog, and the pre-release state has its own blocking notice on
          first visit.

          One pill rather than three because three cost two extra gaps and two
          extra sets of padding to say one thing, and because a row of small
          unrelated-looking chips reads as clutter where a single grouped one
          reads as a stamp. The colors still separate them: the backend is
          emerald for WebAssembly and slate for the JavaScript fallback, the
          pre-release word is amber. */}
      <span className="hidden items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-none ring-1 ring-white/10 badge:inline-flex">
        <button
          onClick={() => open('about')}
          title={t('about.open')}
          className="font-medium tabular-nums text-slate-500 hover:text-sky-400"
        >
          v{APP_VERSION}
        </button>
        {isPreRelease() && (
          <span title={t('about.wip')} className="text-[9px] font-semibold uppercase tracking-wide text-amber-300">
            {t('wip.badge')}
          </span>
        )}
        <EngineBadge />
      </span>
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
            onSavedParts: () => open('parts'),
            onSettings: () => open('settings'),
            // No argument is the docs index; Safety opens Help already ON its
            // own page, which is what addressing help by slug is for.
            onHelp: () => openHelp(),
            onSafety: () => openHelp('safety'),
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
