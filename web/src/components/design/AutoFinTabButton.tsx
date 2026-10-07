import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { autoFinTab, canAutoFinTab } from '../../services/design/finTabAuto';
import { findParent, updateNode } from '../../services/design/treeEdit';
import { useWorkspaceStore } from '../../state/store';

/**
 * OpenRocket's **Calculate automatically** button, at the foot of the fin tab
 * section: work the tab out from what is inside the airframe under the fin.
 *
 * It reads the tree rather than taking a patch callback, because the answer
 * depends on the fin's NEIGHBORS - the mount tube it has to reach and the
 * centering rings it has to fit between - which the property panel does not
 * have. See services/design/finTabAuto.ts for the rule.
 *
 * Renders nothing for a fin set that is not on a symmetric body, because there
 * is nothing to measure against and the desktop does nothing there either.
 */
export function AutoFinTabButton({ node }: { node: ComponentNode }) {
  const { t } = useTranslation();
  const tree = useWorkspaceStore((s) => s.tree);
  const apply = useWorkspaceStore((s) => s.applyTreeAction);
  const id = node.id as string;
  if (!canAutoFinTab(node, findParent(tree, id))) return null;
  return (
    <button
      onClick={() =>
        apply((t0) => {
          const patch = autoFinTab(t0, id);
          return patch ? updateNode(t0, id, patch) : t0;
        })
      }
      title={t('prop.autoFinTabTip')}
      className="rounded-md bg-raised px-2 py-1 text-xs text-ink-soft ring-1 ring-line/10 hover:bg-elevated"
    >
      {t('prop.autoFinTab')}
    </button>
  );
}
