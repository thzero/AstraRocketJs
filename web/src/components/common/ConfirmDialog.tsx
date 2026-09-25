import { useTranslation } from 'react-i18next';
import { useConfirmStore } from '../../state/confirmStore';
import { AlertDialog } from './AlertDialog';

/**
 * The single app-wide confirmation modal, driven imperatively by the confirm
 * store (see {@link confirm}). Mounted once at the app root.
 *
 * Escape and the backdrop cancel; Enter activates whichever button has focus
 * (Confirm, by autoFocus), which is native button behavior and needs no
 * listener. A window-level Enter handler used to call `settle(true)` for every
 * target, so with focus resting on Cancel the destructive action still went
 * ahead.
 *
 * Everything else about the box - the overlay, the focus trap, the Escape, the
 * heading and the button pair - is {@link AlertDialog}, which it shares with the
 * work-in-progress notice.
 *
 * It renders NOTHING until there is a request, which is also what keeps the
 * focus trap honest: the trap's effect deps are `[active]`, so a permanently
 * mounted panel with a constant `true` ran once, found no element, returned
 * early and never ran again. That was this dialog's bug for a while - the one
 * modal mounted for the life of the app had no trap and no focus restore, while
 * every conditionally mounted sibling was fine. Mounting the panel with the
 * request makes the two the same thing.
 */
export function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request);
  const settle = useConfirmStore((s) => s.settle);
  const { t } = useTranslation();

  if (!request) return null;
  const { title, message, confirmLabel, cancelLabel, danger } = request;
  return (
    <AlertDialog
      title={title ?? t('common.confirmTitle')}
      message={message}
      danger={danger}
      confirmLabel={confirmLabel ?? t('common.confirm')}
      onConfirm={() => settle(true)}
      cancelLabel={cancelLabel}
      onCancel={() => settle(false)}
    />
  );
}
