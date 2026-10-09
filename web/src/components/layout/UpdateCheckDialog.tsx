import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_VERSION } from '../../services/app/appInfo';
import { useUpdateStore } from '../../state/updateStore';
import { fireAction } from '../../state/fireAction';
import { Dialog } from '../common/Dialog';
import { DialogButton } from '../common/DialogButton';

/**
 * The menu's "Check for updates": checks the moment it opens and says what came
 * of it, including that this is the latest version, which the update banner's
 * own timer never says. A newer version also brings the banner up, which is
 * where it is applied.
 *
 * The menu disables its entry where there is nothing to ask (offline, or the
 * development server, which registers no service worker), so this always has
 * a check to run. Mounted only while open.
 */
export function UpdateCheckDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const stored = useUpdateStore((s) => s.result);
  const checkNow = useUpdateStore((s) => s.checkNow);
  // The store keeps the last answer between openings. Until this opening's
  // check has finished, the answer shown (and announced) is "checking", never
  // the previous one.
  const [answered, setAnswered] = useState(false);
  const result = answered ? stored : 'checking';

  useEffect(() => {
    let live = true;
    fireAction(
      checkNow().then(() => {
        if (live) setAnswered(true);
      }),
    );
    return () => {
      live = false;
    };
  }, [checkNow]);

  const message: Record<typeof result, string> = {
    idle: t('update.checking'),
    checking: t('update.checking'),
    upToDate: t('update.upToDate'),
    available: t('update.foundNew'),
    failed: t('update.checkFailed'),
  };
  return (
    <Dialog id="updateCheck" title={t('update.check')} onClose={onClose} layout="pad" size="sm" expandable={false}>
      <p className="text-xs text-ink-muted">{t('update.running', { version: APP_VERSION })}</p>
      {/* Mounted always, so the answer is announced when it lands. */}
      <p
        role="status"
        aria-live="polite"
        className={`mt-2 text-sm ${result === 'failed' ? 'text-warn-300' : 'text-ink-soft'}`}
      >
        {message[result]}
      </p>
      <div className="mt-5 flex justify-end">
        <DialogButton onClick={onClose} variant="primary">
          {t('common.close')}
        </DialogButton>
      </div>
    </Dialog>
  );
}
