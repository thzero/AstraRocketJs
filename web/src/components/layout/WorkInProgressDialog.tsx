import { useTranslation } from 'react-i18next';
import { appName, isPreRelease } from '../../services/appInfo';
import { useSettings } from '../../state/SettingsProvider';
import { AlertDialog } from '../common/AlertDialog';

/**
 * A one-time "this is a work in progress" gate, shown on load while the app is
 * pre-1.0 (see {@link isPreRelease}) until the user accepts. The acceptance is
 * persisted as `wipAcknowledged` in the app settings store, so it survives
 * reloads and rides along with the rest of the user's preferences.
 *
 * It must be ACKNOWLEDGED: no Cancel, no Escape, no outside click. That is the
 * whole of the difference from the confirmation prompt it shares its shell with,
 * and in {@link AlertDialog} it is spelled as having no `onCancel` at all rather
 * than as three separate things this component remembers not to do.
 *
 * It sits a layer BELOW the confirmation, so a confirmation raised while it is up
 * would still be reachable. Nothing raises one there today; the ordering is free
 * and the alternative is a notice that can be buried.
 */
export function WorkInProgressDialog() {
  const { t } = useTranslation();
  const { settings, update } = useSettings();

  if (!isPreRelease() || settings.wipAcknowledged) return null;

  return (
    <AlertDialog
      title={t('wip.title')}
      message={t('wip.body', { name: appName() })}
      icon="🚧"
      size="md"
      layer="over"
      confirmLabel={t('wip.accept')}
      onConfirm={() => update({ wipAcknowledged: true })}
    />
  );
}
