import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import {
  canConvertToFreeform,
  canSplit,
  canSplitCluster,
  convertToFreeform,
  resetCluster,
  splitCluster,
  splitInstances,
  splitCount,
} from '../../services/design/componentActions';
import { num } from '../../tree/nodeProps';
import { isFinSet } from '../../tree/tubefins';
import { isAssembly } from '../../tree/assembly';
import { useWorkspaceStore } from '../../state/store';
import { partLabel } from '../../i18n/format';

/**
 * The buttons on OpenRocket's config dialogs that change the tree rather than a
 * field: Convert to freeform, Split fins, Split pods, Split boosters, Split
 * cluster and the cluster's Reset settings.
 *
 * One row at the foot of the panel rather than scattered through the sections
 * the desktop puts them in, because every one of them replaces the part being
 * edited - so they belong together and away from the rows that describe it.
 *
 * A button that cannot do anything is disabled with the reason in its tooltip,
 * not hidden: a one-fin set and a single tube are exactly the cases where
 * someone goes looking for Split and needs to know why it is not offered.
 */
export function ComponentActions({ node }: { node: ComponentNode }) {
  const { t } = useTranslation();
  const apply = useWorkspaceStore((s) => s.applyTreeAction);
  const id = node.id as string;
  // What the copies get numbered from. An unnamed part shows its type, which is
  // what the tree displays for it, so that is what a copy of it is called.
  const baseName = partLabel(t, node);

  const splitLabel =
    node.type === 'podset' ? 'splitPods' : node.type === 'parallelstage' ? 'splitBoosters' : 'splitFins';

  const buttons: { key: string; label: string; title: string; enabled: boolean; run: () => void }[] = [];

  if (canConvertToFreeform(node)) {
    buttons.push({
      key: 'convert',
      label: t('prop.convertToFreeform'),
      title: t('prop.convertToFreeformTip'),
      enabled: true,
      run: () => apply((tree) => convertToFreeform(tree, id)),
    });
  }
  if (isFinSet(node.type) || isAssembly(node.type)) {
    buttons.push({
      key: 'split',
      label: t(`prop.${splitLabel}`),
      title: canSplit(node) ? t('prop.splitTip', { n: splitCount(node) }) : t('prop.splitNoneTip'),
      enabled: canSplit(node),
      run: () => apply((tree, origins) => splitInstances(tree, id, baseName, origins)),
    });
  }
  if (node.type === 'innertube') {
    buttons.push({
      key: 'splitCluster',
      label: t('prop.splitCluster'),
      title: canSplitCluster(node) ? t('prop.splitClusterTip') : t('prop.splitNoneTip'),
      enabled: canSplitCluster(node),
      run: () => apply((tree, origins) => splitCluster(tree, id, baseName, origins)),
    });
    buttons.push({
      key: 'resetCluster',
      label: t('prop.resetCluster'),
      title: t('prop.resetClusterTip'),
      // Nothing to reset on a single tube, or on a cluster already at the
      // default spacing and roll.
      enabled: canSplitCluster(node) && (num(node, 'clusterScale', 1) !== 1 || num(node, 'clusterRotation', 0) !== 0),
      run: () => apply((tree) => resetCluster(tree, id)),
    });
  }

  if (!buttons.length) return null;
  return (
    <div className="flex flex-wrap gap-2 border-t border-line/5 pt-3">
      {buttons.map((b) => (
        <button
          key={b.key}
          onClick={b.run}
          disabled={!b.enabled}
          title={b.title}
          className="rounded-md bg-raised px-2 py-1 text-xs text-ink-soft ring-1 ring-line/10 hover:bg-elevated disabled:cursor-not-allowed disabled:text-ink-dim disabled:hover:bg-raised"
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
