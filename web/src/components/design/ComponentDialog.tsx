import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { Dialog } from '../common/Dialog';
import { PropertyPanel } from './PropertyPanel';
import { useSelectedComponent } from './useSelectedComponent';

/**
 * The component editor as a dialog, for a window too narrow to carry the Design
 * tab's property column: below `xl` the tree, the drawing and a third column do
 * not fit, so the editor opens over the drawing instead of beside it.
 *
 * Mounted ONLY at those widths and only on the Design tab (see App.tsx), which
 * is the same rule the sim editor follows and for the same reason: the panel has
 * to exist in exactly one place in the document, because rendering it in both
 * columns and hiding one leaves two elements answering to every field's label.
 * The mount is also what resets it, so arriving on the tab opens nothing and
 * leaving closes whatever was open.
 *
 * It opens on the SELECTION rather than on the selected id. `selectionSeq`
 * counts gestures, so closing the dialog and tapping the same part again opens
 * it again; keyed on the id, that second tap would be inert, since the store
 * already holds it and nothing would change.
 */
export function ComponentDialog() {
  const { t } = useTranslation();
  const seq = useWorkspaceStore((s) => s.selectionSeq);
  const sel = useSelectedComponent();

  // Adjusted during render rather than from an effect: an effect would paint one
  // frame with the part highlighted and the editor not yet open.
  const [seen, setSeen] = useState(seq);
  const [open, setOpen] = useState(false);
  if (seq !== seen) {
    setSeen(seq);
    setOpen(true);
  }

  // No node is how a delete closes this: `removeSelected` clears the selection,
  // and the dialog the part was deleted from goes with it.
  if (!open || !sel.node) return null;

  return (
    <Dialog id="component-editor" title={t('prop.editTitle')} onClose={() => setOpen(false)}>
      <PropertyPanel
        flush
        node={sel.node}
        onChange={sel.onChange}
        onCommit={sel.onCommit}
        onRemove={sel.onRemove}
        onMove={sel.onMove}
        canMoveUp={sel.canMoveUp}
        canMoveDown={sel.canMoveDown}
        canRemove={sel.canRemove}
        isFirstStage={sel.isFirstStage}
        parentRadius={sel.parentRadius}
        fit={sel.fit}
      />
    </Dialog>
  );
}
