import { useTranslation } from 'react-i18next';
import { canRemove, pastePlace } from '../../services/design/clipboard';
import { findMounts, findNode } from '../../services/design/treeEdit';
import { partLabel } from '../../i18n/format';
import { useWorkspaceStore } from '../../state/store';
import { confirm } from '../../state/confirmStore';

/** One Edit command for the tree: whether it can run now, why not, and the run. */
export interface TreeCommand {
  enabled: boolean;
  /** The button's tooltip: its name and shortcut, or why it is off. */
  title: string;
  run: () => void;
}

/**
 * Cut, Copy, Paste and Duplicate for the parts tree, with desktop's shortcuts
 * (Ctrl+X, Ctrl+C, Ctrl+V, Ctrl+D). A command that cannot run says why in its
 * tooltip rather than disappearing.
 */
export function useTreeEdit(): { cut: TreeCommand; copy: TreeCommand; paste: TreeCommand; duplicate: TreeCommand } {
  const { t } = useTranslation();
  const tree = useWorkspaceStore((s) => s.tree);
  const selectedId = useWorkspaceStore((s) => s.selectedId);
  const clipboard = useWorkspaceStore((s) => s.clipboard);
  const copySelected = useWorkspaceStore((s) => s.copySelected);
  const cutSelected = useWorkspaceStore((s) => s.cutSelected);
  const pasteClipboard = useWorkspaceStore((s) => s.pasteClipboard);
  const duplicateSelected = useWorkspaceStore((s) => s.duplicateSelected);

  const node = selectedId ? findNode(tree, selectedId) : null;
  const named = (key: string, keys: string) => `${t(key)} (${keys})`;
  const noSelection = t('tree.selectFirst');

  const cutOk = !!node && !!selectedId && canRemove(tree, selectedId);
  const cut: TreeCommand = {
    enabled: cutOk,
    title: !node ? noSelection : cutOk ? named('tree.cut', 'Ctrl+X') : t('prop.lastStage'),
    run: () => {
      if (!cutOk) return;
      // Cutting is undoable and keeps the part on the clipboard, so it does not
      // ask, except for the last motor mount, which delete warns about too.
      const onlyMount = node.motorMount === true && findMounts(tree).length === 1;
      if (!onlyMount) return cutSelected();
      void confirm({ message: t('warn.lastMountCut'), confirmLabel: t('tree.cut'), danger: true }).then(
        (ok) => ok && cutSelected(),
      );
    },
  };

  const copy: TreeCommand = {
    enabled: !!node,
    title: node ? named('tree.copy', 'Ctrl+C') : noSelection,
    run: () => copySelected(),
  };

  const place = clipboard ? pastePlace(tree, clipboard, selectedId) : null;
  const paste: TreeCommand = {
    enabled: !!place,
    title: !clipboard
      ? t('tree.pasteEmpty')
      : place
        ? named('tree.paste', 'Ctrl+V')
        : t('tree.pasteNowhere', {
            part: partLabel(t, clipboard),
            target: node ? partLabel(t, node) : t('tree.theDesign'),
          }),
    run: () => pasteClipboard(),
  };

  const duplicate: TreeCommand = {
    enabled: !!node,
    title: node ? named('tree.duplicate', 'Ctrl+D') : noSelection,
    run: () => duplicateSelected(),
  };

  return { cut, copy, paste, duplicate };
}
