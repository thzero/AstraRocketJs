import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { findMounts, findNode, findParent, siblingIndex, stageNodes } from '../../services/treeEdit';
import { useWorkspaceStore } from '../../state/store';
import { confirm } from '../../state/confirmStore';
import { num } from '../../tree/nodeProps';

/**
 * Everything {@link PropertyPanel} needs about the current selection: the node,
 * the guarded edit/delete/move actions, and the few facts about its place in the
 * tree that the node itself doesn't carry.
 *
 * Its own hook because the tree and the property editor now sit in OPPOSITE
 * columns of the Design tab (see App.tsx) rather than stacked in one. The glue
 * used to live in the component that rendered both; with them apart, neither
 * pane should have to import the other to get it.
 */
export function useSelectedComponent() {
  const { t } = useTranslation();
  const tree = useWorkspaceStore((s) => s.tree);
  const selectedId = useWorkspaceStore((s) => s.selectedId);
  const patch = useWorkspaceStore((s) => s.patchSelected);
  const onCommit = useWorkspaceStore((s) => s.commitEdit);
  const remove = useWorkspaceStore((s) => s.removeSelected);
  const onMove = useWorkspaceStore((s) => s.moveSelected);

  const node = useMemo(() => (selectedId ? findNode(tree, selectedId) : null), [tree, selectedId]);
  // Tube fins ring a body, and whether their tubes collide depends on THAT
  // radius, which is not on the fin set itself.
  const parentRadius = useMemo(() => {
    if (node?.type !== 'tubefinset' || !selectedId) return 0;
    const parent = findParent(tree, selectedId);
    return parent ? num(parent, 'outerRadius') : 0;
  }, [tree, selectedId, node]);
  const sib = useMemo(() => (selectedId ? siblingIndex(tree, selectedId) : null), [tree, selectedId]);

  // Guard the last motor mount: deleting it — or turning its motorMount off —
  // leaves nowhere to seat a motor, so the rocket can no longer be simulated.
  const isOnlyMount = !!node && node.motorMount === true && findMounts(tree).length === 1;
  // A rocket needs at least one stage — the only remaining stage can't be deleted.
  const stages = stageNodes(tree);
  const isOnlyStage = !!node && node.type === 'stage' && stages.length <= 1;
  const isFirstStage = !!node && node.type === 'stage' && stages[0]?.id === node.id;

  const onRemove = async () => {
    if (!node || isOnlyStage) return;
    // Every deletion confirms; the last motor mount carries an extra warning
    // (it also loses simulate-ability). Name the part being removed.
    const label = (node.name as string) || t(`part.${node.type}`, { defaultValue: node.type });
    const message = isOnlyMount ? t('warn.lastMountDelete') : t('warn.deletePart', { name: label });
    if (!(await confirm({ message, confirmLabel: t('common.delete'), danger: true }))) return;
    remove();
  };
  const onChange = async (p: Partial<ComponentNode>) => {
    if (
      p.motorMount === false &&
      isOnlyMount &&
      !(await confirm({ message: t('warn.lastMountDisable'), danger: true }))
    )
      return;
    patch(p);
  };

  return {
    node,
    onChange,
    onCommit,
    onRemove,
    onMove,
    canMoveUp: !!sib && sib.index > 0,
    canMoveDown: !!sib && sib.index < sib.count - 1,
    canRemove: !isOnlyStage,
    isFirstStage,
    parentRadius,
  };
}
