import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { defaultDesignName } from '../../services/appInfo';
import { useWorkspaceStore } from '../../state/store';
import { DesignLibraryDialog } from './DesignLibraryDialog';
import { DesignPropertiesDialog } from './DesignPropertiesDialog';
import { ExamplesDialog } from './ExamplesDialog';
import { AboutDialog } from './AboutDialog';
import { ExportDialog } from '../report/ExportDialog';
import { PrintExportDialog } from '../report/PrintExportDialog';
import { PrivacyDialog } from './PrivacyDialog';
import { SettingsDialog } from './SettingsDialog';
import { MotorDashboard } from '../sim/MotorDashboard';
import { LocationsDialog } from '../sim/LocationsDialog';

/**
 * The header's dialog host: the open flag of every dialog the bar and its
 * menu can raise, and the block that mounts each one only while it is open.
 * `useHeaderDialogs()` returns the opener plus the element to render.
 */

export type HeaderDialog =
  'motors' | 'report' | 'about' | 'privacy' | 'settings' | 'library' | 'examples' | 'print' | 'locations' | 'saveAs';

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
  const saveDesignAs = useWorkspaceStore((s) => s.saveDesignAs);
  const designs = useWorkspaceStore((s) => s.designs);
  // Pre-fill Save As with the imported .ork's name when there is one.
  const loadedName = useWorkspaceStore((s) => s.loadedMeta?.name);

  return (
    <>
      {flags.motors && <MotorDashboard onClose={() => onClose('motors')} />}
      {flags.report && <ExportDialog onClose={() => onClose('report')} />}
      {flags.about && <AboutDialog onClose={() => onClose('about')} />}
      {flags.privacy && <PrivacyDialog onClose={() => onClose('privacy')} />}
      {flags.settings && <SettingsDialog onClose={() => onClose('settings')} />}
      {flags.library && <DesignLibraryDialog onClose={() => onClose('library')} />}
      {flags.examples && <ExamplesDialog onClose={() => onClose('examples')} />}
      {flags.print && <PrintExportDialog onClose={() => onClose('print')} />}
      {flags.locations && <LocationsDialog onClose={() => onClose('locations')} />}
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
