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

/** The four Edit commands, on one part. */
export interface TreeCommands {
  cut: TreeCommand;
  copy: TreeCommand;
  paste: TreeCommand;
  duplicate: TreeCommand;
}

/**
 * Cut, Copy, Paste and Duplicate for the parts tree, with desktop's shortcuts
 * (Ctrl+X, Ctrl+C, Ctrl+V, Ctrl+D). A command that cannot run says why in its
 * tooltip rather than disappearing.
 *
 * The four commands act on the selected part, for the header buttons. `at(id)`
 * gives the same commands on one row, for a shortcut pressed on a focused row:
 * the arrow keys move focus without selecting, and desktop's tree, where the
 * selection follows the arrows, acts on the row the keys reached. Running one
 * selects that row first, so the editor shows the part the command touched.
 */
export function useTreeEdit(): TreeCommands & { at: (id: string) => TreeCommands } {
  const { t } = useTranslation();
  const tree = useWorkspaceStore((s) => s.tree);
  const selectedId = useWorkspaceStore((s) => s.selectedId);
  const clipboard = useWorkspaceStore((s) => s.clipboard);
  const setSelectedId = useWorkspaceStore((s) => s.setSelectedId);
  const copySelected = useWorkspaceStore((s) => s.copySelected);
  const cutSelected = useWorkspaceStore((s) => s.cutSelected);
  const pasteClipboard = useWorkspaceStore((s) => s.pasteClipboard);
  const duplicateSelected = useWorkspaceStore((s) => s.duplicateSelected);

  const named = (key: string, keys: string) => `${t(key)} (${keys})`;
  const noSelection = t('tree.selectFirst');

  const commandsFor = (id: string | null): TreeCommands => {
    const node = id ? findNode(tree, id) : null;
    // The store's actions read the selection, so a row other than the selected
    // one becomes the selection before the action runs.
    const target = () => {
      if (id !== selectedId) setSelectedId(id);
    };

    const cutOk = !!node && !!id && canRemove(tree, id);
    const cut: TreeCommand = {
      enabled: cutOk,
      title: !node ? noSelection : cutOk ? named('tree.cut', 'Ctrl+X') : t('prop.lastStage'),
      run: () => {
        if (!cutOk) return;
        target();
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
      run: () => {
        target();
        copySelected();
      },
    };

    const place = clipboard ? pastePlace(tree, clipboard, id) : null;
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
      run: () => {
        target();
        pasteClipboard();
      },
    };

    const duplicate: TreeCommand = {
      enabled: !!node,
      title: node ? named('tree.duplicate', 'Ctrl+D') : noSelection,
      run: () => {
        target();
        duplicateSelected();
      },
    };

    return { cut, copy, paste, duplicate };
  };

  return { ...commandsFor(selectedId), at: commandsFor };
}
