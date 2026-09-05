import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { findMounts, findNode, siblingIndex } from '../../services/treeEdit';
import { useWorkspaceStore } from '../../state/store';
import { confirm } from '../../state/confirmStore';
import { ComponentTree } from './ComponentTree';
import { PropertyPanel } from './PropertyPanel';
import { BusyLock } from '../common/BusyLock';

/** Left pane: the component tree plus the selected part's property editor. */
export function EditorPanel() {
  const { t } = useTranslation();
  const tree = useWorkspaceStore((s) => s.tree);
  const selectedId = useWorkspaceStore((s) => s.selectedId);
  const onSelect = useWorkspaceStore((s) => s.setSelectedId);
  const onAdd = useWorkspaceStore((s) => s.addPartToTree);
  const onRenameDesign = useWorkspaceStore((s) => s.renameDesign);
  const patch = useWorkspaceStore((s) => s.patchSelected);
  const onCommit = useWorkspaceStore((s) => s.commitEdit);
  const remove = useWorkspaceStore((s) => s.removeSelected);
  const onMove = useWorkspaceStore((s) => s.moveSelected);

  const node = useMemo(() => (selectedId ? findNode(tree, selectedId) : null), [tree, selectedId]);
  const sib = useMemo(() => (selectedId ? siblingIndex(tree, selectedId) : null), [tree, selectedId]);

  // Guard the last motor mount: deleting it — or turning its motorMount off —
  // leaves nowhere to seat a motor, so the rocket can no longer be simulated.
  const isOnlyMount = !!node && node.motorMount === true && findMounts(tree).length === 1;
  const onRemove = async () => {
    if (!node) return;
    // Every deletion confirms; the last motor mount carries an extra warning
    // (it also loses simulate-ability). Name the part being removed.
    const label = (node.name as string) || t(`part.${node.type}`, { defaultValue: node.type });
    const message = isOnlyMount ? t('warn.lastMountDelete') : t('warn.deletePart', { name: label });
    if (!(await confirm({ message, confirmLabel: t('common.delete'), danger: true }))) return;
    remove();
  };
  const onChange = async (p: Partial<ComponentNode>) => {
    if (p.motorMount === false && isOnlyMount && !(await confirm({ message: t('warn.lastMountDisable'), danger: true }))) return;
    patch(p);
  };

  return (
    <div className="relative space-y-4 p-3">
      <BusyLock />
      <ComponentTree
        tree={tree}
        selectedId={selectedId}
        onSelect={onSelect}
        onAdd={onAdd}
        onRenameDesign={onRenameDesign}
        onCommit={onCommit}
      />
      <PropertyPanel
        node={node}
        onChange={onChange}
        onCommit={onCommit}
        onRemove={onRemove}
        onMove={onMove}
        canMoveUp={!!sib && sib.index > 0}
        canMoveDown={!!sib && sib.index < sib.count - 1}
      />
    </div>
  );
}
