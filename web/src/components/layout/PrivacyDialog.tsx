import { useTranslation } from 'react-i18next';
import { appName } from '../../services/app/appInfo';
import { Dialog } from '../common/Dialog';
import { DialogButton } from '../common/DialogButton';

/** Privacy policy modal: the app is client-only; nothing leaves the device
 *  except the optional fetches the dialog lists. Copy lives in i18n.
 *  Mounted only while open (`{open && <PrivacyDialog />}`). */
export function PrivacyDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog
      id="privacy"
      title={t('privacy.title')}
      onClose={onClose}
      layer="over"
      layout="pad"
      // A few short paragraphs. Widening them past a readable measure would make them
      // harder to read, not easier.
      expandable={false}
    >
      <div className="space-y-3 text-sm leading-relaxed text-ink-soft">
        <p>{t('privacy.intro', { name: appName() })}</p>
        <p>{t('privacy.storage')}</p>
        <p>{t('privacy.network')}</p>
        <p>{t('privacy.weather')}</p>
        <p className="text-xs text-ink-faint">{t('privacy.hosting')}</p>
      </div>

      <div className="mt-5 flex justify-end">
        <DialogButton onClick={onClose} variant="primary">
          {t('privacy.close')}
        </DialogButton>
      </div>
    </Dialog>
  );
}
