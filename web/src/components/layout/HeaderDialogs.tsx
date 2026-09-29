import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { defaultDesignName } from '../../services/app/appInfo';
import { useWorkspaceStore } from '../../state/store';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { DesignLibraryDialog } from './DesignLibraryDialog';
import { DesignPropertiesDialog } from './DesignPropertiesDialog';
import { ExamplesDialog } from './ExamplesDialog';
import { AboutDialog } from './AboutDialog';
// Lazily loaded: it is the only eager holder of `services/report/reportModel`,
// which `store.saveDesign` already imports dynamically to keep the report model
// out of the main bundle. One static import from a dialog this host mounts
// eagerly pins the module and everything under it, and the build says so
// (INEFFECTIVE_DYNAMIC_IMPORT). Nothing needs the report until it is opened.
const ExportDialog = lazy(() => import('../report/ExportDialog').then((m) => ({ default: m.ExportDialog })));
import { PrintExportDialog } from '../report/PrintExportDialog';
import { HelpDialog } from './HelpDialog';
import { PrivacyDialog } from './PrivacyDialog';
import { SettingsDialog } from './SettingsDialog';
import { MotorDashboard } from '../sim/MotorDashboard';
import { LocationsDialog } from '../sim/LocationsDialog';
import { SavedPartsDialog } from '../design/SavedPartsDialog';
import { useHelpStore } from '../../state/helpStore';

/**
 * The header's dialog host: the open flag of every dialog the bar and its
 * menu can raise, and the block that mounts each one only while it is open.
 * `useHeaderDialogs()` returns the opener plus the element to render.
 *
 * Help is the one exception to the flag list. It is raised from all over the
 * app (the Safety card in the results panel, and anything else that wants to
 * open help ON its own topic), so which page it is showing lives in
 * {@link useHelpStore} instead, and it is mounted here only because the header
 * is where the app-wide dialogs already are.
 */

export type HeaderDialog =
  | 'motors'
  | 'report'
  | 'about'
  | 'privacy'
  | 'settings'
  | 'library'
  | 'examples'
  | 'print'
  | 'locations'
  | 'parts'
  | 'saveAs';

type OpenFlags = Record<HeaderDialog, boolean>;

const NONE_OPEN: OpenFlags = {
  motors: false,
  report: false,
  about: false,
  privacy: false,
  settings: false,
  library: false,
  examples: false,
  print: false,
  locations: false,
  parts: false,
  saveAs: false,
};

export function useHeaderDialogs() {
  const [flags, setFlags] = useState<OpenFlags>(NONE_OPEN);
  const open = (id: HeaderDialog) => setFlags((f) => ({ ...f, [id]: true }));
  const close = (id: HeaderDialog) => setFlags((f) => ({ ...f, [id]: false }));
  return { open, dialogs: <HeaderDialogs flags={flags} onClose={close} /> };
}

/* Mounted only while OPEN.
   Every one of these used to be mounted on every render of the header
   and merely `return null` when closed - which does not stop effects.
   That is what let MotorDashboard fetch the 1.6 MB motor catalog on app
   start despite its own comment saying the load was deferred, and it
   made every dialog's state outlive its own closing. */
function HeaderDialogs({ flags, onClose }: { flags: OpenFlags; onClose: (id: HeaderDialog) => void }) {
  const { t } = useTranslation();
  const helpPage = useHelpStore((s) => s.page);
  const closeHelp = useHelpStore((s) => s.closeHelp);
  const saveDesignAs = useWorkspaceStore((s) => s.saveDesignAs);
  const designs = useWorkspaceStore((s) => s.designs);
  // Pre-fill Save As with the imported .ork's name when there is one.
  const loadedName = useWorkspaceStore((s) => s.loadedMeta?.name);

  return (
    <>
      {flags.motors && <MotorDashboard onClose={() => onClose('motors')} />}
      {/* The boundary sits OUTSIDE the Suspense: it is the chunk FETCH that
          fails on a stale deploy, and Suspense re-throws that rejection during
          render. The fallback is nothing rather than an empty modal frame,
          since a dialog that arrives a beat late reads better than one that
          flashes a shell first. */}
      {flags.report && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <ExportDialog onClose={() => onClose('report')} />
          </Suspense>
        </ErrorBoundary>
      )}
      {flags.about && <AboutDialog onClose={() => onClose('about')} />}
      {flags.privacy && <PrivacyDialog onClose={() => onClose('privacy')} />}
      {/* '' is the docs index, so the null check is not a truthiness check.
          Keyed on the page so that opening Help again ON A DIFFERENT topic
          starts it over rather than leaving the previous page's back stack
          behind it. */}
      {helpPage !== null && <HelpDialog key={helpPage} page={helpPage} onClose={closeHelp} />}
      {flags.settings && <SettingsDialog onClose={() => onClose('settings')} />}
      {flags.library && <DesignLibraryDialog onClose={() => onClose('library')} />}
      {flags.examples && <ExamplesDialog onClose={() => onClose('examples')} />}
      {flags.print && <PrintExportDialog onClose={() => onClose('print')} />}
      {flags.locations && <LocationsDialog onClose={() => onClose('locations')} />}
      {flags.parts && <SavedPartsDialog onClose={() => onClose('parts')} />}
      {flags.saveAs && (
        <DesignPropertiesDialog
          title={t('file.saveAs')}
          confirmLabel={t('common.save')}
          initialName={loadedName ?? defaultDesignName()}
          takenNames={designs.map((d) => d.name)}
          onCancel={() => onClose('saveAs')}
          onConfirm={(name) => {
            onClose('saveAs');
            void saveDesignAs(name);
          }}
        />
      )}
    </>
  );
}
