import { useMemo } from 'react';
import { findNode, siblingIndex } from '../../services/treeEdit';
import { useWorkspaceStore } from '../../state/store';
import { ComponentTree } from './ComponentTree';
import { PropertyPanel } from './PropertyPanel';

/** Left pane: the component tree plus the selected part's property editor. */
export function EditorPanel() {
  const tree = useWorkspaceStore((s) => s.tree);
  const selectedId = useWorkspaceStore((s) => s.selectedId);
  const onSelect = useWorkspaceStore((s) => s.setSelectedId);
  const onAdd = useWorkspaceStore((s) => s.addPartToTree);
  const onRenameDesign = useWorkspaceStore((s) => s.renameDesign);
  const onChange = useWorkspaceStore((s) => s.patchSelected);
  const onRemove = useWorkspaceStore((s) => s.removeSelected);
  const onMove = useWorkspaceStore((s) => s.moveSelected);

  const node = useMemo(() => (selectedId ? findNode(tree, selectedId) : null), [tree, selectedId]);
  const sib = useMemo(() => (selectedId ? siblingIndex(tree, selectedId) : null), [tree, selectedId]);

  return (
    <div className="space-y-4 p-3">
      <ComponentTree tree={tree} selectedId={selectedId} onSelect={onSelect} onAdd={onAdd} onRenameDesign={onRenameDesign} />
      <PropertyPanel
        node={node}
        onChange={onChange}
        onRemove={onRemove}
        onMove={onMove}
        canMoveUp={!!sib && sib.index > 0}
        canMoveDown={!!sib && sib.index < sib.count - 1}
      />
    </div>
  );
}
