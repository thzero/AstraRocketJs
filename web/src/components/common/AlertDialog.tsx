import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from './useFocusTrap';
import { layerClass, widthClass, type DialogLayer, type DialogSize } from './dialogSize';
import { DialogButton } from './DialogButton';

/**
 * The one short-prompt shell: a heading, a sentence, and a button or two.
 *
 * `role="alertdialog"` rather than `dialog`, which is why this is not the
 * {@link Dialog} shell with a smaller body. An alertdialog interrupts to say
 * something or to ask one question, so it has no toolbar, no footer, no scrolling
 * body, no layout to choose and nothing to expand into: there is no content
 * behind the content. What it does need and a plain dialog does not is a
 * description: the message is what a screen reader should read out on arrival,
 * pointed at by `aria-describedby`.
 *
 * It is deliberately not full-bleed on a phone (no `.dialog-panel`, see
 * index.css): filling a screen with two lines and a button is all empty space,
 * and one of these opens on top of a dialog that is already full-screen there,
 * where full bleed would read as that dialog being replaced rather than as
 * something raised over it.
 *
 * One shell, because copies drift: backdrop opacity, heading scale, an
 * `aria-label` repeating the visible heading, a hardcoded element id, or a
 * window-level Escape listener beside the one `useFocusTrap` already provides.
 */
export function AlertDialog({
  title,
  message,
  icon,
  size = 'sm',
  layer = 'top',
  danger,
  confirmLabel,
  onConfirm,
  cancelLabel,
  onCancel,
}: {
  title: string;
  /** The question, or what is being announced. Becomes the accessible
   *  description, so it is read out with the dialog rather than only seen. */
  message: ReactNode;
  /** A single emoji beside the heading, where one says something the words
   *  cannot say as quickly. */
  icon?: string;
  size?: DialogSize;
  layer?: DialogLayer;
  /** Paint the confirm button as destructive. */
  danger?: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  /** Overrides the generic "Cancel". Ignored without `onCancel`. */
  cancelLabel?: string;
  /**
   * The way out, and the only thing that decides whether there is one: given, it
   * is the Cancel button, the Escape key and the backdrop alike. Omitted, the
   * prompt must be acknowledged - no button, and Escape and the backdrop do
   * nothing rather than dismissing something the app is waiting on.
   */
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  // Escape reaches the topmost open surface only, and a prompt with no way out
  // swallows it there rather than letting it through to whatever is underneath
  // (useFocusTrap), so no window-level listener is needed here.
  const panelRef = useFocusTrap<HTMLDivElement>(true, onCancel ? { onEscape: onCancel } : {});
  const titleId = useId();
  const messageId = useId();

  return (
    <div // eslint-disable-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions -- a backdrop click is the mouse twin of Escape, which the focus trap handles; the panel only stops that click
      className={`fixed inset-0 ${layerClass[layer]} grid place-items-center bg-shade/60 p-4`}
      onClick={(e) => {
        e.stopPropagation();
        onCancel?.();
      }}
    >
      <div // eslint-disable-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-noninteractive-element-interactions -- a backdrop click is the mouse twin of Escape, which the focus trap handles; the panel only stops that click
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        // A maximum height it will almost never reach: a one-sentence prompt
        // cannot overflow, but a confirmation quoting a long design name on a
        // short window could, and running off the bottom would take the buttons
        // with it.
        className={`w-full ${widthClass(size)} max-h-[85vh] overflow-y-auto rounded-2xl bg-surface p-6 ring-1 ring-line/10`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          {icon && (
            <span className="text-3xl" aria-hidden>
              {icon}
            </span>
          )}
          <h2 id={titleId} className="text-base font-semibold text-ink-strong">
            {title}
          </h2>
        </div>
        <p id={messageId} className="mt-3 text-sm leading-relaxed text-ink-soft">
          {message}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          {/* Cancel first in the DOM, with the focus on confirm (`autoFocus`).
              The focus trap must respect `autoFocus` rather than move focus to
              the first focusable child, or the focus ring sits on Cancel while
              Enter runs the destructive action. */}
          {onCancel && (
            <DialogButton onClick={onCancel} variant="secondary">
              {cancelLabel ?? t('common.cancel')}
            </DialogButton>
          )}
          <DialogButton autoFocus onClick={onConfirm} variant={danger ? 'danger' : 'primary'}>
            {confirmLabel}
          </DialogButton>
        </div>
      </div>
    </div>
  );
}
