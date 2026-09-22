import { usePromptStore } from '../../state/promptStore';
import { DesignPropertiesDialog } from '../layout/DesignPropertiesDialog';

/**
 * The app-wide name prompt, driven imperatively by the prompt store (see
 * {@link prompt}). Mounted once at the app root, beside ConfirmDialog.
 *
 * It renders the SAME dialog File > Save As and the library's Rename use, so
 * the focus trap, the Escape handling, the select-on-open and the duplicate
 * warning are the ones already tested there rather than a second copy of them.
 * Mounted only while a request is open, which is what lets that dialog seed its
 * field once in a state initializer.
 */
export function PromptDialog() {
  const request = usePromptStore((s) => s.request);
  const settle = usePromptStore((s) => s.settle);
  if (!request) return null;
  return (
    <DesignPropertiesDialog
      // A fresh instance per request, or the second prompt of a session would
      // reuse the first one's seeded field.
      key={request.initialName}
      title={request.title}
      confirmLabel={request.confirmLabel}
      initialName={request.initialName}
      takenNames={request.takenNames}
      onCancel={() => settle(null)}
      onConfirm={(name) => settle(name)}
    />
  );
}
